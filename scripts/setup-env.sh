#!/bin/sh
#
# setup-env.sh — create local env files from their committed *.example templates.
#
# WHAT IT DOES
#   Walks the repo for files ending in .example (currently just .env.example) and
#   copies each one to the same path with the suffix stripped — .env.example becomes
#   .env. Existing files are never overwritten, so re-running is safe: newly added
#   templates get created, and anything you have already edited is left untouched.
#   Re-run it after a pull that adds a new template.
#
# WHAT IT UNLOCKS
#   Nothing here *requires* a .env — docker-compose.yml and vite.config.ts both fall
#   back to the same defaults their templates document, which is why a fresh clone
#   runs with no setup at all. What this gives you is a file you can actually edit:
#   somewhere to change the Postgres credentials, port, or dev-server settings for
#   your machine without touching tracked files, and without the risk of committing
#   them, because the generated files are gitignored. In short — it turns the
#   committed defaults into your own local overrides.
#
# USAGE
#   ./scripts/setup-env.sh
#
set -e

cd "$(git rev-parse --show-toplevel)"

templates=$(find . -name '*.example' \
  -not -path './.git/*' \
  -not -path '*/node_modules/*' \
  -not -path '*/bin/*' \
  -not -path '*/obj/*' \
  -not -path '*/dist/*' | sort)

if [ -z "$templates" ]; then
  echo "setup-env: no *.example templates found — nothing to do."
  exit 0
fi

# Split on newlines only, so paths containing spaces survive.
IFS='
'

created=0
skipped=0

for template in $templates; do
  target=${template%.example}
  if [ -e "$target" ]; then
    printf '  skip    %s (already exists)\n' "${target#./}"
    skipped=$((skipped + 1))
  else
    cp "$template" "$target"
    printf '  create  %s\n' "${target#./}"
    created=$((created + 1))
  fi
done

printf '\nsetup-env: %d created, %d left alone.\n' "$created" "$skipped"
