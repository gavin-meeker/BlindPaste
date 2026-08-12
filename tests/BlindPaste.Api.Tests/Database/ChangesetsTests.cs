using System.Text;
using BlindPaste.Api.Tests.Infrastructure;
using Npgsql;

namespace BlindPaste.Api.Tests.Database;

/// Guards the rule documented in changelog-master.xml: a changeset must survive being
/// applied to a database that already has it.
///
/// Liquibase's tracking table normally stops that happening, so this covers the cases
/// where the tracking is not in play — a restored database, a hand-run file, a cleared
/// checksum, and the fixture below, which applies these files directly.
[Collection(PostgresCollection.Name)]
public sealed class ChangesetsTests(PostgresFixture fixture)
{
    /// The fixture applied every changeset once when the container started, so this is
    /// a real second application, not a first one in disguise.
    [Fact]
    public async Task Applying_every_changeset_again_succeeds_and_changes_nothing()
    {
        var before = await SnapshotSchemaAsync();

        await fixture.ApplyChangesetsAsync();

        Assert.Equal(before, await SnapshotSchemaAsync());
    }

    /// Columns, types, nullability and indexes, as one comparable string.
    private async Task<string> SnapshotSchemaAsync()
    {
        var snapshot = new StringBuilder();

        await AppendAsync(
            snapshot,
            """
            SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position;
            """);

        await AppendAsync(
            snapshot,
            """
            SELECT indexname || ' ' || indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY indexname;
            """);

        return snapshot.ToString();
    }

    private async Task AppendAsync(StringBuilder snapshot, string sql)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            snapshot.AppendLine(reader.GetString(0));
        }
    }
}
