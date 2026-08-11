#!/bin/sh
#
# test-api.sh — run the Bruno collection against a live API.
#
# WHAT IT DOES
#   Starts the API, waits for it to answer, runs bruno/ end to end with the Bru CLI, then
#   shuts the API down again — whether the run passed, failed, or you pressed Ctrl-C. Any
#   arguments are passed through to `bru run`:
#
#     ./scripts/test-api.sh --exclude-tags slow      # skip the 4 MB oversize request
#     ./scripts/test-api.sh --reporter-html out.html # write a report
#     ./scripts/test-api.sh --bail                   # stop at the first failure
#
# WHAT IT UNLOCKS
#   The other suites stop at the edges of the process: xUnit drives the pipeline through
#   WebApplicationFactory with no socket involved, and Vitest never leaves the browser
#   code. This is the one that goes over the wire — real Kestrel, real JSON, real status
#   codes and headers — so it is what catches things that only exist in transit, like a
#   Location header that does not resolve.
#
#   It starts the API with the creation rate limit raised, which a full run would
#   otherwise trip: the limiter sits ahead of validation, so the Validation folder's
#   rejected requests spend permits too, and the default is 10 per minute.
#
#   Unlike the other suites this one needs a database, because the API it starts is the
#   real one. Bring it up first with `docker compose up -d`.
#
# USAGE
#   docker compose up -d
#   ./scripts/test-api.sh [bru run args...]
#
set -e

cd "$(git rev-parse --show-toplevel)"

PORT="${BLINDPASTE_TEST_PORT:-5013}"
URL="http://localhost:$PORT"
BRU="${BRU_CLI:-@usebruno/cli@latest}"

if ! command -v npx >/dev/null 2>&1; then
  echo "test-api: npx not found — the Bru CLI runs through it. Install Node (see .nvmrc)." >&2
  exit 1
fi

# Refuse rather than reuse: an API someone else started is on unknown settings, and the
# rate limit alone would make the results a coin toss.
if curl -sf -o /dev/null "$URL/health" 2>/dev/null; then
  echo "test-api: something is already serving $URL. Stop it first, or set" >&2
  echo "          BLINDPASTE_TEST_PORT to a free port." >&2
  exit 1
fi

api_pid=''
cleanup() {
  if [ -n "$api_pid" ] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

log="$(mktemp -t blindpaste-api)"
echo "test-api: starting the API on $URL"

ASPNETCORE_ENVIRONMENT=Development \
ASPNETCORE_URLS="$URL" \
Paste__CreatesPerWindow=1000 \
  dotnet run --project src/BlindPaste.Api --no-launch-profile >"$log" 2>&1 &
api_pid=$!

waited=0
until curl -sf -o /dev/null "$URL/health" 2>/dev/null; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "test-api: the API exited before it started serving. Its output:" >&2
    tail -30 "$log" >&2
    exit 1
  fi

  waited=$((waited + 1))
  if [ "$waited" -gt 60 ]; then
    echo "test-api: the API never answered $URL/health. Its output:" >&2
    tail -30 "$log" >&2
    exit 1
  fi

  sleep 1
done

# /health does not touch the database, so prove reachability with a request that does —
# otherwise every paste request fails with an opaque 500 and the report blames the API.
if ! curl -sf -o /dev/null -X POST "$URL/api/pastes" \
  -H 'Content-Type: application/json' -d '{"payload":"AQIDBAUGBwgJCgsMDQ4PEBES"}'; then
  echo "test-api: the API is up but cannot store a paste — the database is probably not." >&2
  echo "          Run 'docker compose up -d' and try again. Its output:" >&2
  tail -30 "$log" >&2
  exit 1
fi

echo "test-api: running the Bruno collection"
cd bruno
exec_status=0
npx --yes "$BRU" run --env Local -r "$@" || exec_status=$?

exit "$exec_status"
