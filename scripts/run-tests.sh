#!/bin/sh
#
# run-tests.sh — run both test suites and report once.
#
# WHAT IT DOES
#   Delegates to scripts/test-backend.sh and scripts/test-frontend.sh, runs both even
#   if the first one fails, and prints a single summary. Exits non-zero if either
#   suite failed. Takes no arguments — to filter tests, or to run only one suite, call
#   the script for that suite directly:
#
#     ./scripts/test-backend.sh --filter FullyQualifiedName~PasteStoreTests
#     ./scripts/test-frontend.sh tests/lib/crypto.test.ts
#
# WHAT IT UNLOCKS
#   One command for "is everything still green", which is what you want before opening
#   a PR. Both suites run in isolation — the backend one starts its own throwaway
#   PostgreSQL — so this is safe to run at any time, whatever your dev database is
#   doing. It needs Docker for the backend half; see scripts/test-backend.sh.
#
#   Running both regardless of the first result is deliberate: one command should tell
#   you everything that is broken, not just the first thing.
#
# USAGE
#   ./scripts/run-tests.sh
#
set -e

cd "$(git rev-parse --show-toplevel)"

if [ "$#" -ne 0 ]; then
  echo "run-tests: takes no arguments — call scripts/test-backend.sh or" >&2
  echo "           scripts/test-frontend.sh directly to pass arguments through." >&2
  exit 2
fi

failed=0

echo '── backend'
if ./scripts/test-backend.sh; then
  backend_status='passed'
else
  backend_status='FAILED'
  failed=1
fi
echo

echo '── frontend'
if ./scripts/test-frontend.sh; then
  frontend_status='passed'
else
  frontend_status='FAILED'
  failed=1
fi
echo

printf 'run-tests: backend %s, frontend %s.\n' "$backend_status" "$frontend_status"
exit "$failed"
