using BlindPaste.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace BlindPaste.Api.Persistence;

/// Maps to the Liquibase-managed schema. EF never owns migrations here — the model
/// mirrors what the changesets create, and `dotnet ef migrations add` must never be
/// run against this context. Column names come from the snake_case convention;
/// tables are set explicitly.
///
/// Read-only by design: tracking is off by default, so this context is for querying.
/// Schema changes go through a new changeset in database/changelog/changesets/.
public class BlindPasteDbContext(DbContextOptions<BlindPasteDbContext> options) : DbContext(options)
{
    public DbSet<Ping> Pings => Set<Ping>();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        => optionsBuilder
            .UseSnakeCaseNamingConvention()
            .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking);

    protected override void OnModelCreating(ModelBuilder builder)
    {
        builder.Entity<Ping>(e =>
        {
            e.ToTable("ping");
            e.HasKey(x => x.Id);
        });
    }
}
