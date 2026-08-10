using BlindPaste.Api.Options;
using BlindPaste.Api.Persistence;
using Microsoft.Extensions.Options;

namespace BlindPaste.Api.BackgroundServices;

/// Deletes pastes past their expiry on a timer.
public sealed class ExpiredPasteSweeper(
    IServiceScopeFactory scopeFactory,
    IOptions<PasteOptions> options,
    ILogger<ExpiredPasteSweeper> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = options.Value.SweepInterval;
        using var timer = new PeriodicTimer(interval);

        logger.LogInformation("Expired paste sweeper started; interval {Interval}.", interval);

        // Sweeps immediately on startup, then on the timer. A deployment that had been
        // down past several intervals should not wait another one to catch up.
        do
        {
            await SweepAsync(stoppingToken);
        }
        while (await SafeWaitAsync(timer, stoppingToken));
    }

    private async Task SweepAsync(CancellationToken cancellationToken)
    {
        try
        {
            // BackgroundService is a singleton; the store and its DbContext are scoped.
            await using var scope = scopeFactory.CreateAsyncScope();
            var store = scope.ServiceProvider.GetRequiredService<PasteStore>();

            var deleted = await store.PurgeExpiredAsync(DateTimeOffset.UtcNow, cancellationToken);
            if (deleted > 0)
            {
                logger.LogInformation("Swept {Deleted} expired paste(s).", deleted);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Shutting down — not a failure.
        }
        catch (Exception ex)
        {
            // A sweep that throws must not take the loop down with it: an unreachable
            // database for one tick is temporary, but a dead sweeper is permanent and
            // silent. Log and let the next tick try again.
            logger.LogError(ex, "Sweeping expired pastes failed; retrying next interval.");
        }
    }

    private static async Task<bool> SafeWaitAsync(PeriodicTimer timer, CancellationToken cancellationToken)
    {
        try
        {
            return await timer.WaitForNextTickAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
