using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace BlindPaste.Api.Tests.Infrastructure;

/// Boots the real Program.cs pipeline against the test container, so middleware the
/// endpoints depend on — the rate limiter, the response headers — is under test too.
public sealed class BlindPasteApiFactory(string connectionString, params (string Key, string Value)[] settings)
    : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);

        // UseSetting, not ConfigureAppConfiguration. Program.cs reads the connection
        // string and the paste options straight off builder.Configuration, before
        // builder.Build() — by which point ConfigureAppConfiguration has not run, so
        // those overrides arrive too late and appsettings.Development.json wins.
        builder.UseSetting("ConnectionStrings:Postgres", connectionString);

        // Long enough that the sweeper never fires mid-test; it has its own test, and a
        // surprise deletion here would look like an endpoint bug.
        builder.UseSetting("Paste:SweepInterval", "01:00:00");

        foreach (var (key, value) in settings)
        {
            builder.UseSetting(key, value);
        }
    }
}
