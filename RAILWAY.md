# Deploying to Railway

Three services, each config-as-code in this repo, each built from a `Dockerfile`
(Railpack doesn't support .NET, so the API needed one regardless — the other two
follow it for consistency):

| Service | Config file | Dockerfile | Builds |
|---|---|---|---|
| `api` | `src/BlindPaste.Api/railway.json` | `src/BlindPaste.Api/Dockerfile` | The ASP.NET Core API |
| `ui` | `web/railway.json` | `web/Dockerfile` | The Vite build, served by Caddy |
| `liquibase` | `database/railway.json` | `database/liquibase.Dockerfile` | Runs the schema migration once per deploy |

Postgres is provisioned separately from Railway's own template — that part isn't
config-as-code, there's nothing in this repo to point at for it.

Every Dockerfile builds with the **repo root as its context**, not the service's own
directory. That's deliberate, not incidental: the API's `Directory.Build.props` lives
one level above the project file (`src/Directory.Build.props`), and MSBuild finds it
by walking up from there — a build scoped to `src/BlindPaste.Api/` alone would leave it
unreachable. Keeping all three on the same convention means there's one rule to
remember, not a different one per service. This is also why none of the three services
use Railway's **Root Directory** setting — leave it unset (default = repo root) for
all three.

## Architecture: the API has no public domain

Only `ui` gets a public domain. `api` is reached exclusively over Railway's private
network — `ui`'s Caddy reverse-proxies `/api/*` to it — the same relationship
`vite.config.ts`'s dev-server proxy already has to the API locally, just running as a
static Caddy config instead of a dev server. Two things fall out of this:

- The browser never talks to `api` directly, so there is no CORS to configure and the
  frontend's existing `fetch('/api/pastes')` calls stay same-origin, unchanged, in
  production exactly as they are in dev.
- `api` binds a **fixed** internal port (`8080`) rather than Railway's dynamic `$PORT`
  — nothing public ever needs to detect it, only `ui`'s Caddyfile needs to know it, and
  it's already baked into both. `ui` itself does use `$PORT`, since it's the one
  service Railway's edge actually routes to.

## One-time setup, per service

Config-as-code covers build and deploy settings, but three things are inherently
outside a repo file: which GitHub repo/branch a service tracks, which of its `.json`
files to read, and how services address each other by name. Do these once per service,
in the Railway dashboard (or the equivalent `railway` CLI commands).

**Name the services exactly `api`, `ui`, and `liquibase`.** The variables below
reference them by name (`${{api.RAILWAY_PRIVATE_DOMAIN}}`) — if you name them
differently, use your own names in the reference variables everywhere below.

### 1. Connect the source

For each of the three services: **Settings → Source → Connect Repo**, select this
repo and branch.

### 2. Point each service at its config file

Railway's default config-as-code discovery looks for `railway.json` at the **repo
root** — it does not follow a service's own directory. Each service needs its config
file's path set explicitly, as an absolute path from the repo root, regardless of
anything else:

- `api` → **Settings → Config-as-code Path** → `/src/BlindPaste.Api/railway.json`
- `ui` → `/web/railway.json`
- `liquibase` → `/database/railway.json`

### 3. Variables — `api`

Build the Npgsql connection string from Postgres's own individual variables, rather
than parsing `DATABASE_URL` (Npgsql wants `Key=Value;Key=Value`, not a `postgres://`
URI):

```
ConnectionStrings__Postgres=Host=${{Postgres.PGHOST}};Port=${{Postgres.PGPORT}};Database=${{Postgres.PGDATABASE}};Username=${{Postgres.PGUSER}};Password=${{Postgres.PGPASSWORD}}
```

Replace `Postgres` with whatever you actually named the database service if it isn't
that.

### 4. Variables — `ui`

```
API_PRIVATE_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080
```

The `:8080` has to match the API's fixed internal port from `src/BlindPaste.Api/Dockerfile`
— if that ever changes, this has to change with it.

### 5. Variables — `liquibase`

The Dockerfile's `CMD` reads these individually (see the comment in
`database/liquibase.Dockerfile` for why — in short, using them lets the same image work
both under `docker compose`, which overrides the command outright, and standalone on
Railway, which doesn't):

```
PGHOST=${{Postgres.PGHOST}}
PGPORT=${{Postgres.PGPORT}}
PGDATABASE=${{Postgres.PGDATABASE}}
PGUSER=${{Postgres.PGUSER}}
PGPASSWORD=${{Postgres.PGPASSWORD}}
```

### 6. Generate a public domain

`ui` only. **Settings → Networking → Generate Domain.** Leave `api` and `liquibase`
without one.

## First deploy: migrate before the API takes traffic

Railway has no built-in "wait for this other service to finish" dependency between
services (unlike `docker-compose.yml`'s `depends_on`, which this repo's local setup
does use). On the very first deploy, nothing stops `api` from starting before
`liquibase` has created the schema — its `/health` endpoint doesn't touch the
database, so it will report healthy regardless, and only the first paste
create/read request would fail (as a 500) until the migration completes.

Deploy `liquibase` first — or at least trigger and confirm it separately before
sending real traffic at `api` for the first time. After that first deploy, this stops
mattering: every changeset in `database/changelog/changesets/` is idempotent by
project convention (enforced by `ChangesetsTests`), so `liquibase` redeploying
alongside `api` on every subsequent push is safe — it either applies something new or
reports "up to date" and exits 0.

## Verifying this locally before you deploy

Every Dockerfile here was built and run standalone against a real Postgres during
development, not just written and assumed correct — worth knowing if you want to
re-verify after changing one:

```bash
# API, against a running blindpaste-db:
docker build -f src/BlindPaste.Api/Dockerfile -t blindpaste-api .
docker run --rm --network blindpaste_default -p 18080:8080 \
  -e ConnectionStrings__Postgres="Host=blindpaste-db;Port=5432;Database=blindpaste;Username=blindpaste;Password=blindpaste" \
  blindpaste-api

# UI, proxying to a running API container:
docker build -f web/Dockerfile -t blindpaste-web .
docker run --rm --network blindpaste_default -p 18000:3000 \
  -e API_PRIVATE_URL="http://<api-container-name>:8080" \
  blindpaste-web

# Liquibase, standalone (not through docker compose's command override):
docker build -f database/liquibase.Dockerfile -t blindpaste-liquibase-standalone .
docker run --rm --network blindpaste_default \
  -e PGHOST=blindpaste-db -e PGPORT=5432 -e PGDATABASE=blindpaste -e PGUSER=blindpaste -e PGPASSWORD=blindpaste \
  blindpaste-liquibase-standalone
```

`blindpaste_default` is the network `docker compose up -d` creates for the `postgres`
service — start that first.
