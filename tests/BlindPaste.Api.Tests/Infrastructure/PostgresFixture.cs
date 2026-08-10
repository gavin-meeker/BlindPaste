using BlindPaste.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;

namespace BlindPaste.Api.Tests.Infrastructure;

/// A throwaway Postgres with the real changesets applied, shared by every test.
///
/// Tests run against Postgres rather than an in-memory provider because the behaviour
/// most worth testing here — two readers racing for one burn-after-reading paste —
/// is decided by the database, and a fake would answer for it instead.
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgres:18")
        .WithDatabase("blindpaste")
        .WithUsername("blindpaste")
        .WithPassword("blindpaste")
        .Build();

    public string ConnectionString => container.GetConnectionString();

    public async ValueTask InitializeAsync()
    {
        await container.StartAsync();
        await ApplyChangesetsAsync();
    }

    public async ValueTask DisposeAsync() => await container.DisposeAsync();

    /// A fresh DbContext. Each one is independent, which is what lets a test drive
    /// several concurrent readers.
    public BlindPasteDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<BlindPasteDbContext>()
            .UseNpgsql(ConnectionString)
            .Options;

        return new BlindPasteDbContext(options);
    }

    public async Task ResetAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand("TRUNCATE paste;", connection);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<int> CountPastesAsync(string id)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand("SELECT count(*) FROM paste WHERE id = @id;", connection);
        command.Parameters.AddWithValue("id", id);

        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    /// Runs the Liquibase changesets straight at Postgres.
    ///
    /// Their directives (`--changeset`, `--rollback`) are SQL line comments, so the
    /// files execute as written — which keeps the schema under test the one the app
    /// actually ships, rather than a second copy that can drift away from it. Public
    /// because ChangesetTests calls it a second time to prove the files are idempotent.
    public async Task ApplyChangesetsAsync()
    {
        var changesets = Directory
            .GetFiles(Path.Combine(FindRepoRoot(), "database", "changelog", "changesets"), "*.sql")
            .OrderBy(path => path, StringComparer.Ordinal);

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        foreach (var changeset in changesets)
        {
            await using var command = new NpgsqlCommand(await File.ReadAllTextAsync(changeset), connection);
            await command.ExecuteNonQueryAsync();
        }
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

/// One shared container for the whole suite; xUnit runs a collection's tests in
/// sequence, so tests can safely truncate the table between them.
[CollectionDefinition(Name)]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>
{
    public const string Name = "postgres";
}
