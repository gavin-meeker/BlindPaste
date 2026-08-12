using System.Diagnostics;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Networks;
using Npgsql;
using Testcontainers.PostgreSql;

namespace BlindPaste.Api.Tests.Database;

/// Runs the actual `liquibase` CLI, through the actual Dockerfile
public sealed class LiquibaseMigrationTests : IAsyncLifetime
{
    private const string ImageTag = "blindpaste-liquibase-test";

    private INetwork network = null!;
    private PostgreSqlContainer postgres = null!;

    public async ValueTask InitializeAsync()
    {
        network = new NetworkBuilder().Build();
        await network.CreateAsync();

        postgres = new PostgreSqlBuilder("postgres:18")
            .WithNetwork(network)
            .WithNetworkAliases("postgres")
            .WithDatabase("blindpaste")
            .WithUsername("blindpaste")
            .WithPassword("blindpaste")
            .Build();
        await postgres.StartAsync();

        // Built once here rather than per-test: this is the same image Railway and
        // docker-builds.yml build, and building it is the slow part.
        var (exitCode, output) = await RunAsync(
            "docker",
            $"build -f database/liquibase.Dockerfile -t {ImageTag} .",
            FindRepoRoot(),
            TimeSpan.FromMinutes(5));

        if (exitCode != 0)
        {
            throw new InvalidOperationException($"docker build failed (exit {exitCode}):\n{output}");
        }
    }

    public async ValueTask DisposeAsync()
    {
        await postgres.DisposeAsync();
        await network.DisposeAsync();
    }

    [Fact]
    public async Task Liquibase_applies_every_changeset_to_a_fresh_database()
    {
        var (exitCode, output) = await RunMigrationAsync();

        Assert.True(exitCode == 0, $"liquibase exited {exitCode}:\n{output}");
        Assert.Contains("Liquibase command 'update' was executed successfully", output);

        await using var connection = new NpgsqlConnection(postgres.GetConnectionString());
        await connection.OpenAsync(TestContext.Current.CancellationToken);

        // The tables the changesets are supposed to create, plus Liquibase's own
        // tracking table — proof this ran through Liquibase and not some other path.
        foreach (var table in new[] { "paste", "databasechangelog" })
        {
            Assert.True(
                await TableExistsAsync(connection, table),
                $"expected table \"{table}\" to exist after migrating.");
        }

        // ping is created by 0001 and dropped by 0004 — this asserts the drop actually
        // took effect, not just that the migration ran without error.
        Assert.False(
            await TableExistsAsync(connection, "ping"),
            "expected table \"ping\" to have been dropped.");
    }

    private static async Task<bool> TableExistsAsync(NpgsqlConnection connection, string table)
    {
        await using var command = new NpgsqlCommand("SELECT to_regclass(@table) IS NOT NULL;", connection);
        command.Parameters.AddWithValue("table", table);

        return (bool)(await command.ExecuteScalarAsync(TestContext.Current.CancellationToken))!;
    }

    /// Exercises Liquibase's own tracking table, not the SQL-level idempotence
    /// ChangesetsTests already checks — a real redeploy re-runs `liquibase update`
    /// against a database that already has everything applied, and this is what that
    /// looks like: Liquibase should recognize it has nothing left to do and exit 0,
    /// not re-execute anything or fail.
    [Fact]
    public async Task Liquibase_reports_nothing_to_do_the_second_time()
    {
        var first = await RunMigrationAsync();
        Assert.True(first.ExitCode == 0, $"first run exited {first.ExitCode}:\n{first.Output}");

        var second = await RunMigrationAsync();

        Assert.True(second.ExitCode == 0, $"second run exited {second.ExitCode}:\n{second.Output}");
        Assert.Contains("no changesets to execute", second.Output, StringComparison.OrdinalIgnoreCase);
    }

    private Task<(int ExitCode, string Output)> RunMigrationAsync() =>
        RunAsync(
            "docker",
            "run --rm --network " + network.Name +
            " -e PGHOST=postgres -e PGPORT=5432 -e PGDATABASE=blindpaste" +
            " -e PGUSER=blindpaste -e PGPASSWORD=blindpaste " + ImageTag,
            workingDirectory: null,
            TimeSpan.FromMinutes(2));

    private static async Task<(int ExitCode, string Output)> RunAsync(
        string fileName, string arguments, string? workingDirectory, TimeSpan timeout)
    {
        var startInfo = new ProcessStartInfo(fileName, arguments)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };

        if (workingDirectory is not null)
        {
            startInfo.WorkingDirectory = workingDirectory;
        }

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Failed to start {fileName}.");

        using var cts = new CancellationTokenSource(timeout);

        var stdout = process.StandardOutput.ReadToEndAsync(cts.Token);
        var stderr = process.StandardError.ReadToEndAsync(cts.Token);
        await process.WaitForExitAsync(cts.Token);

        return (process.ExitCode, await stdout + await stderr);
    }

    private static string FindRepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null &&
               !Directory.Exists(Path.Combine(directory.FullName, "database", "changelog", "changesets")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName
            ?? throw new InvalidOperationException($"No repo root above {AppContext.BaseDirectory}.");
    }
}
