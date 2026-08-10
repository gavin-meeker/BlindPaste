namespace BlindPaste.Api.Options;

/// Bound from the "Paste" configuration section. Every value has a usable default,
/// so an instance with no configuration at all is still a working deployment.
public sealed class PasteOptions
{
    public const string SectionName = "Paste";

    /// Ceiling on the stored payload, in characters. The payload is base64url, so
    /// this is roughly 3/4 as much plaintext. Bounding it here keeps a single
    /// request from filling the disk; Program.cs derives Kestrel's body limit from it.
    public int MaxPayloadCharacters { get; init; } = 4 * 1024 * 1024;

    /// Used when a request does not ask for a specific lifetime.
    public TimeSpan DefaultExpiry { get; init; } = TimeSpan.FromDays(1);

    /// Requests outside this range are rejected rather than clamped — silently
    /// storing a paste for longer than asked is the kind of surprise this app
    /// should never spring on someone.
    public TimeSpan MinExpiry { get; init; } = TimeSpan.FromMinutes(1);

    public TimeSpan MaxExpiry { get; init; } = TimeSpan.FromDays(30);

    /// How often the sweeper deletes rows past their expiry. Reads already filter on
    /// expires_at, so this bounds how long dead ciphertext sits on disk, not whether
    /// it can still be read.
    public TimeSpan SweepInterval { get; init; } = TimeSpan.FromMinutes(10);

    /// Rate limit on paste creation, per client address.
    public int CreatesPerWindow { get; init; } = 10;

    public TimeSpan RateLimitWindow { get; init; } = TimeSpan.FromMinutes(1);
}
