using BlindPaste.Api.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BlindPaste.Api.Controllers;

/// Smoke test for the whole stack: a row that only exists because Liquibase applied
/// its changeset, read back through EF. If this returns 200 the database is up,
/// migrated, and reachable from the API.
[ApiController]
[Route("api/[controller]")]
public class PingController(BlindPasteDbContext db) : ControllerBase
{
    public record PingResponse(int Id, string Message, DateTimeOffset CreatedAt);

    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PingResponse>> Get(CancellationToken cancellationToken)
    {
        var ping = await db.Pings
            .OrderBy(p => p.Id)
            .Select(p => new PingResponse(p.Id, p.Message, p.CreatedAt))
            .FirstOrDefaultAsync(cancellationToken);

        // A missing row means the schema is there but unseeded — a real signal, not an error.
        return ping is null ? NotFound() : Ok(ping);
    }
}
