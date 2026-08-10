namespace BlindPaste.Api.Options;

/// Policy names shared between the registration in Program.cs and the
/// [EnableRateLimiting] attributes that reference them. A typo in either place would
/// otherwise fail at runtime, when the endpoint is first hit.
public static class RateLimiterPolicies
{
    public const string CreatePaste = "create-paste";
}
