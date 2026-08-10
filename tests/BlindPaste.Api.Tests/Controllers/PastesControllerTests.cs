using System.Net;
using System.Net.Http.Json;
using BlindPaste.Api.Controllers;
using BlindPaste.Api.Tests.Infrastructure;

namespace BlindPaste.Api.Tests.Controllers;

[Collection(PostgresCollection.Name)]
public sealed class PastesControllerTests : IAsyncLifetime
{
    private const string Payload = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8w";
    private const int MaxPayloadCharacters = 512;

    private readonly PostgresFixture fixture;
    private readonly BlindPasteApiFactory factory;
    private readonly HttpClient client;

    public PastesControllerTests(PostgresFixture fixture)
    {
        this.fixture = fixture;

        factory = new BlindPasteApiFactory(
            fixture.ConnectionString,
            ("Paste:MaxPayloadCharacters", MaxPayloadCharacters.ToString()),
            ("Paste:MinExpiry", "00:00:01"),

            // Every test here shares one rate-limit partition, because TestServer gives
            // no remote address. Set high enough that only the test that means to trip
            // the limiter does.
            ("Paste:CreatesPerWindow", "1000"));

        client = factory.CreateClient();
    }

    public async ValueTask InitializeAsync() => await fixture.ResetAsync();

    public ValueTask DisposeAsync()
    {
        client.Dispose();
        return factory.DisposeAsync();
    }

    private Task<HttpResponseMessage> PostAsync(string payload, int? expiresInSeconds = 3600, bool burn = false)
        => client.PostAsJsonAsync("/api/pastes", new PastesController.CreatePasteRequest(payload, expiresInSeconds, burn));

    private async Task<PastesController.CreatePasteResponse> CreateAsync(bool burn = false, int expiresInSeconds = 3600)
    {
        var response = await PostAsync(Payload, expiresInSeconds, burn);
        response.EnsureSuccessStatusCode();

        return (await response.Content.ReadFromJsonAsync<PastesController.CreatePasteResponse>(
            TestContext.Current.CancellationToken))!;
    }

    [Fact]
    public async Task Post_returns_201_and_the_new_id()
    {
        var response = await PostAsync(Payload);
        var created = await response.Content.ReadFromJsonAsync<PastesController.CreatePasteResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(created);
        Assert.Equal(22, created.Id.Length);
        Assert.False(created.BurnAfterReading);
        Assert.True(created.ExpiresAt > DateTimeOffset.UtcNow);
    }

    /// Regression test. RouteOptions.LowercaseUrls lowercases generated links whole,
    /// route values included, so a Location built by CreatedAtAction pointed at a
    /// lowercased id that no longer matched the case-sensitive one stored.
    [Fact]
    public async Task Post_returns_a_location_that_preserves_id_case_and_resolves()
    {
        var response = await PostAsync(Payload);
        var created = await response.Content.ReadFromJsonAsync<PastesController.CreatePasteResponse>(
            TestContext.Current.CancellationToken);

        var location = response.Headers.Location;
        Assert.NotNull(location);
        Assert.NotNull(created);
        Assert.EndsWith($"/{created.Id}", location.ToString(), StringComparison.Ordinal);

        var followed = await client.GetAsync(location, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, followed.StatusCode);
    }

    [Fact]
    public async Task Get_round_trips_the_payload()
    {
        var created = await CreateAsync();

        var paste = await client.GetFromJsonAsync<PastesController.PasteResponse>(
            $"/api/pastes/{created.Id}", TestContext.Current.CancellationToken);

        Assert.NotNull(paste);
        Assert.Equal(Payload, paste.Payload);
        Assert.False(paste.BurnAfterReading);
    }

    [Fact]
    public async Task Get_asks_not_to_be_indexed_or_cached()
    {
        var created = await CreateAsync();

        var response = await client.GetAsync($"/api/pastes/{created.Id}", TestContext.Current.CancellationToken);

        Assert.Contains("noindex", string.Join(' ', response.Headers.GetValues("X-Robots-Tag")));
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task Get_burns_the_paste_after_one_read()
    {
        var created = await CreateAsync(burn: true);

        var first = await client.GetAsync($"/api/pastes/{created.Id}", TestContext.Current.CancellationToken);
        var second = await client.GetAsync($"/api/pastes/{created.Id}", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, second.StatusCode);
        Assert.Equal(0, await fixture.CountPastesAsync(created.Id));
    }

    [Fact]
    public async Task Get_returns_404_for_an_unknown_id()
    {
        var response = await client.GetAsync("/api/pastes/nosuchpaste0000000000", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Get_returns_404_once_a_paste_has_expired()
    {
        var created = await CreateAsync(expiresInSeconds: 1);

        await Task.Delay(TimeSpan.FromMilliseconds(1200), TestContext.Current.CancellationToken);

        var response = await client.GetAsync($"/api/pastes/{created.Id}", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("not valid base64!!")]
    [InlineData("")]
    public async Task Post_rejects_a_payload_that_is_not_base64url(string payload)
    {
        var response = await PostAsync(payload);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_rejects_a_payload_over_the_size_limit()
    {
        var response = await PostAsync(new string('A', MaxPayloadCharacters + 1));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-60)]
    [InlineData(99_999_999)]
    public async Task Post_rejects_an_expiry_outside_the_configured_range(int expiresInSeconds)
    {
        var response = await PostAsync(Payload, expiresInSeconds);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_falls_back_to_the_default_expiry_when_none_is_given()
    {
        var response = await PostAsync(Payload, expiresInSeconds: null);
        var created = await response.Content.ReadFromJsonAsync<PastesController.CreatePasteResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(created);

        // The default is one day; allow slack for the round trip.
        Assert.InRange(created.ExpiresAt - DateTimeOffset.UtcNow, TimeSpan.FromHours(23), TimeSpan.FromHours(25));
    }

    [Fact]
    public async Task Post_is_rate_limited()
    {
        const int Limit = 3;

        await using var limited = new BlindPasteApiFactory(
            fixture.ConnectionString,
            ("Paste:CreatesPerWindow", Limit.ToString()),
            ("Paste:RateLimitWindow", "00:05:00"));

        using var limitedClient = limited.CreateClient();

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < Limit + 2; i++)
        {
            var response = await limitedClient.PostAsJsonAsync(
                "/api/pastes",
                new PastesController.CreatePasteRequest(Payload, 3600, false),
                TestContext.Current.CancellationToken);

            statuses.Add(response.StatusCode);
        }

        Assert.Equal(Limit, statuses.Count(status => status == HttpStatusCode.Created));
        Assert.Equal(2, statuses.Count(status => status == HttpStatusCode.TooManyRequests));
    }
}
