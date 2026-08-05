# BlindPaste

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | ASP.NET Core Web API (.NET 10, controllers), EF Core 10 (query layer only) |
| Database | PostgreSQL 18 |
| Schema   | Liquibase 5 (plain-SQL changesets, run via Docker) |
| Frontend | React 19 + Vite 8 + TypeScript, Tailwind CSS 4 |
| API docs | Scalar at `/scalar` (Development only) |

The SDK is pinned in `global.json` (10.0.300, `rollForward: latestMinor`).

## Layout

```
BlindPaste/
├─ BlindPaste.slnx        # solution at the repo root (spans backend + frontend)
├─ src/
│  ├─ BlindPaste.Api/     # the API — controllers, DbContext, entities
│  └─ Directory.Build.props  # solution-wide build settings (warnings as errors)
├─ web/                   # Vite React TS app
├─ database/
│  ├─ changelog/          # Liquibase master + plain-SQL changesets (owns the schema)
│  └─ liquibase.Dockerfile
├─ scripts/               # developer setup / maintenance scripts (see below)
├─ docker-compose.yml     # postgres + liquibase (one-shot migration)
├─ .nvmrc                 # pins Node (nvm use)
├─ .editorconfig          # shared formatting rules
└─ global.json            # pins the .NET SDK
```

## Prerequisites

| Tool     | Required version |
|----------|------------------|
| .NET SDK | 10.x (project pins **10.0.300**) |
| Node.js  | 24 LTS or newer |
| Docker   | current — runs Postgres **and** Liquibase, so no local Postgres, Java, or Liquibase install is needed |

## Running it

```bash
# 1. Start Postgres and apply the schema.
#    The liquibase service runs automatically once the db reports healthy, then exits.
docker compose up -d

# 2. Backend  →  http://localhost:5013
dotnet run --project src/BlindPaste.Api

# 3. Frontend →  http://localhost:5173
cd web && npm install && npm run dev
```

No local setup step is required: the dev connection string and dev-server settings are
committed (see [Configuration](#configuration)). `.env` is optional — `docker-compose.yml`
falls back to the same defaults `.env.example` documents, so copy it only if you want to
change the Postgres credentials or port.

Node is pinned in `.nvmrc`, so `nvm use` in the repo root picks the right version.

## Scripts

`scripts/` holds developer setup and maintenance scripts. Each one documents at the top
what it does and what it unlocks, so start there rather than here.

| Script | What it's for |
|--------|---------------|
| `scripts/setup-env.sh` | Copies every committed `*.example` template to its real filename (`.env.example` → `.env`), never overwriting an existing file. Gives you local, gitignored files to edit instead of the tracked defaults. Safe to re-run after a pull that adds a template. |

## Configuration

| Setting | Source | Override |
|---------|--------|----------|
| Postgres connection | `src/BlindPaste.Api/appsettings.Development.json` | `ConnectionStrings__Postgres` env var, or user-secrets |
| Postgres credentials / port | `docker-compose.yml` defaults | `.env` (see `.env.example`) |
| Dev-server port, API URL | `web/.env.development` | `web/.env.development.local` (gitignored) |

Two ports are coupled across files: `API_URL` in `web/.env.development` must match
`applicationUrl` in `src/BlindPaste.Api/Properties/launchSettings.json`.

## Resetting the database

```bash
docker compose down -v     # -v drops the volume, so migrations reapply from scratch
docker compose up -d
```
