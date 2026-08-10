#!/bin/sh
#
# test-frontend.sh — run the frontend test suite (web/tests, Vitest).
#
# WHAT IT DOES
#   Runs Vitest once over web/tests, installing web/node_modules first if it is
#   missing. Any arguments are passed straight through to `vitest run`, so filtering
#   and reporters work as usual:
#
#     ./scripts/test-frontend.sh tests/lib/crypto.test.ts
#
# WHAT IT UNLOCKS
#   Needs no Docker, no database and no running API — the code under test is the
#   browser crypto in web/src/lib, which touches neither the network nor the DOM. This
#   is the suite to reach for while working on the payload format or the encryption
#   path, because it runs in a couple of seconds with nothing else started.
#
#   Note that tests live in web/tests, mirroring web/src by path — web/src/lib/crypto.ts
#   is covered by web/tests/lib/crypto.test.ts — so a path you pass is relative to web/.
#
# USAGE
#   ./scripts/test-frontend.sh [vitest args...]
#
set -e

cd "$(git rev-parse --show-toplevel)/web"

if [ ! -d node_modules ]; then
  echo 'test-frontend: node_modules is missing — installing first.'
  npm install
fi

exec npx vitest run "$@"
