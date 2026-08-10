using BlindPaste.Api.BackgroundServices;
using BlindPaste.Api.Options;
using BlindPaste.Api.Persistence;
using BlindPaste.Api.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

// BlindPaste.Api.Options shadows Microsoft.Extensions.Options, so Options.Create needs
// a name of its own.
using MicrosoftOptions = Microsoft.Extensions.Options.Options;

namespace BlindPaste.Api.Tests.BackgroundServices;

[Collection(PostgresCollection.Name)]
public sealed class ExpiredPasteSweeperTests(PostgresFixture fixture) : IAsyncLifetime
{
    private const string Payload = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8w";

    private static readonly TimeSpan SweepInterval = TimeSpan.FromMilliseconds(250);

    public async ValueTask InitializeAsync() => await fixture.ResetAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    [Fact]
    public async Task Sweeps_expired_pastes_and_leaves_live_ones_alone()
    {
        await using var db = fixture.CreateDbContext();
        var store = new PasteStore(db);

        var expired = await store.CreateAsync(Payload, false, DateTimeOffset.UtcNow.AddMinutes(-1), TestContext.Current.CancellationToken);
        var live = await store.CreateAsync(Payload, false, DateTimeOffset.UtcNow.AddHours(1), TestContext.Current.CancellationToken);

        using var sweeper = CreateSweeper();
        await sweeper.StartAsync(TestContext.Current.CancellationToken);

        await WaitUntilGoneAsync(expired.Id);
        Assert.Equal(1, await fixture.CountPastesAsync(live.Id));

        await sweeper.StopAsync(TestContext.Current.CancellationToken);
    }

    /// The first sweep runs at startup; this covers the ones after it, which are what
    /// keep a long-running instance clean.
    [Fact]
    public async Task Keeps_sweeping_on_the_interval_after_the_first_pass()
    {
        using var sweeper = CreateSweeper();
        await sweeper.StartAsync(TestContext.Current.CancellationToken);

        // Created after startup, so only a later tick can remove it.
        await using var db = fixture.CreateDbContext();
        var expired = await new PasteStore(db).CreateAsync(
            Payload, false, DateTimeOffset.UtcNow.AddMinutes(-1), TestContext.Current.CancellationToken);

        await WaitUntilGoneAsync(expired.Id);

        await sweeper.StopAsync(TestContext.Current.CancellationToken);
    }

    private ExpiredPasteSweeper CreateSweeper()
    {
        var services = new ServiceCollection();
        services.AddDbContext<BlindPasteDbContext>(options => options.UseNpgsql(fixture.ConnectionString));
        services.AddScoped<PasteStore>();

        var provider = services.BuildServiceProvider();

        return new ExpiredPasteSweeper(
            provider.GetRequiredService<IServiceScopeFactory>(),
            MicrosoftOptions.Create(new PasteOptions { SweepInterval = SweepInterval }),
            NullLogger<ExpiredPasteSweeper>.Instance);
    }

    private async Task WaitUntilGoneAsync(string id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);

        while (DateTime.UtcNow < deadline)
        {
            if (await fixture.CountPastesAsync(id) == 0)
            {
                return;
            }

            await Task.Delay(SweepInterval, TestContext.Current.CancellationToken);
        }

        Assert.Fail($"Paste {id} was still present after 15s of sweeping.");
    }
}
