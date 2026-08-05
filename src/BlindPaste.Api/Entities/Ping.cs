namespace BlindPaste.Api.Entities;

/// Mirrors the `ping` table created by Liquibase changeset 0001_create_ping.sql.
/// Liquibase owns this shape — if the changeset changes, update this to match.
public class Ping
{
    public int Id { get; set; }
    public required string Message { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
