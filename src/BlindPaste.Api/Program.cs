using System.Threading.RateLimiting;
using BlindPaste.Api.BackgroundServices;
using BlindPaste.Api.Options;
using BlindPaste.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

// Read once up front: Kestrel's body limit and the rate limiter are both configured
// below, before the container is built and IOptions is resolvable.
var pasteOptions = builder.Configuration
    .GetSection(PasteOptions.SectionName)
    .Get<PasteOptions>() ?? new PasteOptions();

builder.Services.Configure<PasteOptions>(builder.Configuration.GetSection(PasteOptions.SectionName));

// Keeps [controller]-derived routes lowercase, so the published contract reads
// /api/ping rather than /api/Ping.
builder.Services.AddRouting(options =>
{
    options.LowercaseUrls = true;
});
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

builder.Services.AddHealthChecks();

// A paste body is one base64url string, so its character count is also its byte count
// in UTF-8; the slack covers the surrounding JSON. Bounding it at the server means an
// oversized request is refused before it is buffered, not after.
builder.WebHost.UseKestrel(options =>
{
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = pasteOptions.MaxPayloadCharacters + (8 * 1024);
});

// Paste creation is the only endpoint that writes, so it is the only one worth
// limiting. Partitioned by remote address — behind a reverse proxy that is the proxy
// unless forwarded headers are configured, which would make this one shared bucket.
builder.Services.AddRateLimiter(limiter =>
{
    limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    limiter.AddPolicy(RateLimiterPolicies.CreatePaste, context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = pasteOptions.CreatesPerWindow,
                Window = pasteOptions.RateLimitWindow,
                QueueLimit = 0,
            }));
});

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
builder.Services.AddScoped<PasteStore>();

// Nothing else deletes expired pastes, so this is what makes an expiry date mean
// anything on disk rather than only at read time.
builder.Services.AddHostedService<ExpiredPasteSweeper>();

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

else
{
    // Without HTTPS the browser cannot be trusted to have received the real encryption
    // code, which is the assumption the whole design rests on. HSTS stops a returning
    // visitor from being downgraded to plain HTTP on a later visit.
    app.UseHsts();
}

app.UseHttpsRedirection();

// A paste link carries its decryption key in the fragment, so a crawler that reaches
// one and indexes it has published the paste. robots.txt asks the well-behaved ones to
// stay away; this says the same thing to anything that reads headers instead.
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";
    await next();
});

app.UseRateLimiter();

app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/health");

app.Run();

/// Named so WebApplicationFactory can boot this pipeline in tests; top-level statements
/// otherwise compile to an internal entry point it cannot reach.
public partial class Program;
