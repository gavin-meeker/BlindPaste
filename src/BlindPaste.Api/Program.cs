using BlindPaste.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// Keeps [controller]-derived routes lowercase, so the published contract reads
// /api/ping rather than /api/Ping.
builder.Services.AddRouting(options =>
{
    options.LowercaseUrls = true;
});
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

builder.Services.AddHealthChecks();
builder.WebHost.UseKestrel(options => options.AddServerHeader = false);

// --- Persistence: EF maps to the Liquibase-owned schema (no EF migrations). ---
// Never run `dotnet ef migrations add` against this context; schema changes are new
// changesets under database/changelog/changesets/.
// Development reads this from appsettings.Development.json, which carries the local
// docker-compose credentials so a fresh clone needs no setup. Every other environment
// must supply it — via the ConnectionStrings__Postgres environment variable, or
// user-secrets locally — and fails fast here rather than at the first query.
var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException(
        "ConnectionStrings:Postgres is not configured. Set the environment variable " +
        "ConnectionStrings__Postgres, or for local overrides run: " +
        "dotnet user-secrets --project src/BlindPaste.Api set \"ConnectionStrings:Postgres\" <value>");

builder.Services.AddDbContext<BlindPasteDbContext>(options => options.UseNpgsql(connectionString));

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    // Serves the OpenAPI document at /openapi/v1.json, which Scalar reads to render
    // its interactive reference at /scalar. Development-only — neither should be
    // exposed in production without deliberately deciding to.
    app.MapOpenApi();
    app.MapScalarApiReference(options => options.WithTitle("BlindPaste API"));
}

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/health");

app.Run();
