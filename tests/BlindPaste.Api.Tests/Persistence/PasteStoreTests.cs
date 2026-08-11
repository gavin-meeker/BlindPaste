using BlindPaste.Api.Persistence;
using BlindPaste.Api.Tests.Infrastructure;

namespace BlindPaste.Api.Tests.Persistence;

[Collection(PostgresCollection.Name)]
public sealed class PasteStoreTests(PostgresFixture fixture) : IAsyncLifetime
{
    private const string Payload = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8w";

    private static readonly DateTimeOffset FarFuture = DateTimeOffset.UtcNow.AddHours(1);
    private static readonly DateTimeOffset AlreadyPast = DateTimeOffset.UtcNow.AddMinutes(-1);

    public async ValueTask InitializeAsync() => await fixture.ResetAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    [Fact]
    public async Task CreateAsync_generates_a_128_bit_base64url_id()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var paste = await store.CreateAsync(Payload, burnAfterReading: false, FarFuture, TestContext.Current.CancellationToken);

        // 16 random bytes encode to 22 base64url characters.
        Assert.Equal(22, paste.Id.Length);
        Assert.Matches("^[A-Za-z0-9_-]+$", paste.Id);
    }

    [Fact]
    public async Task CreateAsync_generates_a_distinct_id_every_time()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var ids = new List<string>();
        for (var i = 0; i < 50; i++)
        {
            ids.Add((await store.CreateAsync(Payload, false, FarFuture, TestContext.Current.CancellationToken)).Id);
        }

        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Fact]
    public async Task ReadOnceAsync_round_trips_the_payload_untouched()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var created = await store.CreateAsync(Payload, false, FarFuture, TestContext.Current.CancellationToken);
        var read = await store.ReadOnceAsync(created.Id, TestContext.Current.CancellationToken);

        Assert.NotNull(read);
        Assert.Equal(Payload, read.Payload);
    }

    [Fact]
    public async Task ReadOnceAsync_leaves_an_ordinary_paste_readable()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var created = await store.CreateAsync(Payload, false, FarFuture, TestContext.Current.CancellationToken);

        Assert.NotNull(await store.ReadOnceAsync(created.Id, TestContext.Current.CancellationToken));
        Assert.NotNull(await store.ReadOnceAsync(created.Id, TestContext.Current.CancellationToken));
        Assert.Equal(1, await fixture.CountPastesAsync(created.Id));
    }

    [Fact]
    public async Task ReadOnceAsync_returns_null_for_an_unknown_id()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        Assert.Null(await store.ReadOnceAsync("nosuchpaste0000000000", TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task ReadOnceAsync_refuses_an_expired_paste_before_the_sweeper_runs()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var created = await store.CreateAsync(Payload, false, AlreadyPast, TestContext.Current.CancellationToken);

        Assert.Null(await store.ReadOnceAsync(created.Id, TestContext.Current.CancellationToken));

        // Still on disk — expiry is enforced at read time, and the sweeper cleans up
        // separately. Both halves matter, so this asserts they are in fact separate.
        Assert.Equal(1, await fixture.CountPastesAsync(created.Id));
    }

    [Fact]
    public async Task ReadOnceAsync_deletes_a_burn_paste_once_it_has_been_read()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var created = await store.CreateAsync(Payload, burnAfterReading: true, FarFuture, TestContext.Current.CancellationToken);

        var first = await store.ReadOnceAsync(created.Id, TestContext.Current.CancellationToken);
        Assert.NotNull(first);
        Assert.Equal(Payload, first.Payload);

        Assert.Null(await store.ReadOnceAsync(created.Id, TestContext.Current.CancellationToken));
        Assert.Equal(0, await fixture.CountPastesAsync(created.Id));
    }

    /// The reason this suite talks to a real Postgres. A read that selected the row and
    /// then deleted it would hand the ciphertext to every concurrent caller; only the
    /// DELETE's row count can pick a single winner.
    [Fact]
    public async Task ReadOnceAsync_serves_a_burn_paste_to_exactly_one_concurrent_reader()
    {
        const int Readers = 12;

        await using var db = fixture.CreateDbContext();
        var created = await new PasteStore(db).CreateAsync(Payload, burnAfterReading: true, FarFuture, TestContext.Current.CancellationToken);

        // Each reader gets its own DbContext. DbContext is not thread-safe and EF
        // refuses concurrent use outright — sharing one here would throw "a second
        // operation was started on this context" instead of racing.
        var contexts = Enumerable.Range(0, Readers).Select(_ => fixture.CreateDbContext()).ToList();
        try
        {
            var reads = contexts.Select(context =>
                Task.Run(() => new PasteStore(context).ReadOnceAsync(created.Id, TestContext.Current.CancellationToken)));

            var results = await Task.WhenAll(reads);

            Assert.Equal(1, results.Count(paste => paste is not null));
            Assert.Equal(Readers - 1, results.Count(paste => paste is null));
            Assert.Equal(Payload, results.Single(paste => paste is not null)!.Payload);
            Assert.Equal(0, await fixture.CountPastesAsync(created.Id));
        }
        finally
        {
            foreach (var context in contexts)
            {
                await context.DisposeAsync();
            }
        }
    }

    [Fact]
    public async Task CreateAsync_accepts_a_null_expiry_meaning_never()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var paste = await store.CreateAsync(Payload, false, expiresAt: null, TestContext.Current.CancellationToken);

        Assert.Null(paste.ExpiresAt);
    }

    [Fact]
    public async Task ReadOnceAsync_serves_a_never_expiring_paste()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var created = await store.CreateAsync(Payload, false, expiresAt: null, TestContext.Current.CancellationToken);
        var read = await store.ReadOnceAsync(created.Id, TestContext.Current.CancellationToken);

        Assert.NotNull(read);
        Assert.Equal(Payload, read.Payload);
        Assert.Null(read.ExpiresAt);
    }

    [Fact]
    public async Task ReadOnceAsync_still_burns_a_never_expiring_paste_on_its_one_read()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var created = await store.CreateAsync(
            Payload, burnAfterReading: true, expiresAt: null, TestContext.Current.CancellationToken);

        Assert.NotNull(await store.ReadOnceAsync(created.Id, TestContext.Current.CancellationToken));
        Assert.Null(await store.ReadOnceAsync(created.Id, TestContext.Current.CancellationToken));
        Assert.Equal(0, await fixture.CountPastesAsync(created.Id));
    }

    [Fact]
    public async Task PurgeExpiredAsync_never_deletes_a_paste_with_no_expiry()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var neverExpires = await store.CreateAsync(
            Payload, false, expiresAt: null, TestContext.Current.CancellationToken);

        // asOf a century out is the strongest version of this claim: no asOf, however
        // large, should ever match a null ExpiresAt.
        var deleted = await store.PurgeExpiredAsync(
            DateTimeOffset.UtcNow.AddYears(100), TestContext.Current.CancellationToken);

        Assert.Equal(0, deleted);
        Assert.Equal(1, await fixture.CountPastesAsync(neverExpires.Id));
    }

    [Fact]
    public async Task PurgeExpiredAsync_deletes_expired_pastes_and_spares_live_ones()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var expired = await store.CreateAsync(Payload, false, AlreadyPast, TestContext.Current.CancellationToken);
        var live = await store.CreateAsync(Payload, false, FarFuture, TestContext.Current.CancellationToken);
        var neverExpires = await store.CreateAsync(Payload, false, null, TestContext.Current.CancellationToken);

        var deleted = await store.PurgeExpiredAsync(DateTimeOffset.UtcNow, TestContext.Current.CancellationToken);

        Assert.Equal(1, deleted);
        Assert.Equal(0, await fixture.CountPastesAsync(expired.Id));
        Assert.Equal(1, await fixture.CountPastesAsync(live.Id));
        Assert.Equal(1, await fixture.CountPastesAsync(neverExpires.Id));
    }
}
