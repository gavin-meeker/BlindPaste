#!/bin/sh
#
# test-backend.sh — run the backend test suite (tests/BlindPaste.Api.Tests, xUnit).
#
# WHAT IT DOES
#   Runs the API's xUnit suite: the paste store, the pastes endpoints driven through
#   the real Program.cs pipeline, and the expiry sweeper. Any arguments are passed
#   straight through to `dotnet test`, so filtering works as usual:
#
#     ./scripts/test-backend.sh --filter FullyQualifiedName~PasteStoreTests
#
# WHAT IT UNLOCKS
#   These tests talk to a real PostgreSQL, because the behaviour most worth testing —
#   two readers racing for the same burn-after-reading paste — is decided by the
#   database, and an in-memory provider would answer for it instead. Testcontainers
#   starts that database itself, on a random port, and applies the changesets from
#   database/changelog/changesets before handing it over, so the schema under test is
#   the one the app actually ships rather than a second copy that can drift.
#
#   So this needs Docker running, but it does NOT need `docker compose up`, and it
#   does not care what is on port 5432 or what state your dev database is in. The
#   suite brings its own throwaway database and removes it afterwards. Nothing it does
#   can touch your local data.
#
# USAGE
#   ./scripts/test-backend.sh [dotnet test args...]
#
set -e

cd "$(git rev-parse --show-toplevel)"

# Checked up front: without Docker the failure surfaces as a Testcontainers stack
# trace partway through the run, which reads like a broken test rather than a missing
# prerequisite.
if ! docker info >/dev/null 2>&1; then
  echo "test-backend: Docker is not running, and these tests need it to start their"
  echo "              throwaway PostgreSQL. Start Docker and try again."
  exit 1
fi

exec dotnet test tests/BlindPaste.Api.Tests/BlindPaste.Api.Tests.csproj --nologo "$@"
