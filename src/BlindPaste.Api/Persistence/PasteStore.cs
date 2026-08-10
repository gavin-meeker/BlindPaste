using System.Buffers.Text;
using System.Security.Cryptography;
using BlindPaste.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace BlindPaste.Api.Persistence;

/// All paste data access. This exists as its own type rather than sitting in the
/// controller because reading a burn-after-reading paste has a correctness argument
/// attached to it (see ReadOnceAsync) that deserves somewhere to live.
public sealed class PasteStore(BlindPasteDbContext db)
{
    /// 16 bytes — 128 bits, encoding to 22 base64url characters. The id is the only
    /// secret gating retrieval on the server side, so it is sized against guessing
    /// rather than against collision.
    private const int IdBytes = 16;

    public async Task<Paste> CreateAsync(
        string payload,
        bool burnAfterReading,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken)
    {
        var paste = new Paste
        {
            Id = NewId(),
            Payload = payload,
            BurnAfterReading = burnAfterReading,
            CreatedAt = DateTimeOffset.UtcNow,
            ExpiresAt = expiresAt,
        };

        db.Pastes.Add(paste);
        await db.SaveChangesAsync(cancellationToken);

        return paste;
    }

    /// Returns the paste, or null if it does not exist, has expired, or was a
    /// burn-after-reading paste that another request got to first.
    ///
    /// The burn case is the one worth reading carefully. Two requests arriving
    /// together must not both receive the ciphertext, and a SELECT followed by a
    /// DELETE does not guarantee that on its own — both would see the row. What makes
    /// it safe is that the DELETE, not the SELECT, decides the winner: Postgres
    /// serialises the two statements on the row, so exactly one reports a deleted
    /// row and the loser gets zero and is turned away. Serving the payload read
    /// before the DELETE is sound only because a paste is never updated, so the row
    /// the winner deleted held exactly what it had already read.
    public async Task<Paste?> ReadOnceAsync(string id, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;

        var paste = await db.Pastes
            .Where(p => p.Id == id && p.ExpiresAt > now)
            .FirstOrDefaultAsync(cancellationToken);

        if (paste is null || !paste.BurnAfterReading)
        {
            return paste;
        }

        var deleted = await db.Pastes
            .Where(p => p.Id == id && p.BurnAfterReading && p.ExpiresAt > now)
            .ExecuteDeleteAsync(cancellationToken);

        return deleted == 1 ? paste : null;
    }

    /// Deletes everything already past its expiry. Reads filter on expires_at too, so
    /// this controls how long unreadable ciphertext lingers, not whether it is served.
    public Task<int> PurgeExpiredAsync(DateTimeOffset asOf, CancellationToken cancellationToken)
        => db.Pastes
            .Where(p => p.ExpiresAt <= asOf)
            .ExecuteDeleteAsync(cancellationToken);

    private static string NewId()
    {
        Span<byte> bytes = stackalloc byte[IdBytes];
        RandomNumberGenerator.Fill(bytes);

        return Base64Url.EncodeToString(bytes);
    }
}
