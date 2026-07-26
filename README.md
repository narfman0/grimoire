# grimoire

[![CI](https://github.com/narfman0/grimoire/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/narfman0/grimoire/actions/workflows/ci.yml)
[![Uptime](https://img.shields.io/uptimerobot/status/m803125314-109ad927be8519fff77a1fc8)](https://stats.uptimerobot.com/haG9yph32j)

Collaborative D&D 5e campaign manager. Everyone at the table can edit
every character sheet in real time.

Status: **active table use**.

## Features

- **Live character sheets** — HP, conditions, spell slots, and resources sync in real time across all players
- **Encounter runner** — initiative order, per-participant action economy foldout, spell casting with slot consumption, concentration tracking, damage saves
- **Rules engine** — derives AC, attack bonuses, save DCs, proficiencies, and resistances from class/subclass/feat/species/background content
- **Content packs** — SRD 5.2 ships in-repo and is seeded on first boot; non-SRD content imported per-user via `POST /api/homebrew/import`; homebrew authored in-app
- **Homebrew editors** — structured forms for all 11 content kinds (spells, items, feats, classes, subclasses, species, subspecies, backgrounds, features, conditions, monsters)
- **Feat picker** — player-choice slots with prereq enforcement; subclass expanded spells auto-populate
- **Multi-campaign characters** — one character can belong to multiple campaigns via a join table

## Stack

| Piece           | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Frontend        | SvelteKit + TypeScript + Tailwind v4                         |
| Web server      | `@sveltejs/adapter-node`                                     |
| DB              | SQLite via Drizzle ORM (`better-sqlite3`)                    |
| Realtime sync   | Short-polling (2s) via `src/lib/realtime/*-channel.ts`       |
| Hosting         | Fly.io (`grimoire-wispy-fog-2051`), auto-deployed from `master` |

Drizzle schema stays portable (`text` / `integer`) so the Postgres swap is
mostly an import change.

## Getting started

```bash
cp .env.example .env   # fill in RESEND_API_KEY and ORIGIN at minimum
pnpm install
pnpm migrate           # applies any pending drizzle migrations
pnpm dev               # SvelteKit on :5173
```

Open [http://localhost:5173](http://localhost:5173). Sign up, create a
campaign, share the 6-character code, play.

To play from another machine on your LAN, point your browser at
`http://<host>:5173`. If Vite blocks the host, set
`VITE_ALLOWED_HOSTS=host,laptop.local,…` in `.env.local` (gitignored).

If `better-sqlite3` fails to build, install a C++ toolchain. On Fedora:
`sudo dnf install -y python3 make gcc-c++`.

## Deploy

**Production is Fly.io, and every push to `master` deploys it.** CI
(`.github/workflows/ci.yml`) runs `pnpm check` + `pnpm test` + `pnpm build`,
and on success runs `flyctl deploy` against the app
`grimoire-wispy-fog-2051` (single machine, one `grimoire_data` volume
holding `grimoire.db`, migrations run on container startup). There is no
staging environment — treat a green merge as shipped.

Self-hosting via docker compose also works:

```bash
ORIGIN=https://grimoire.example.com docker compose build && docker compose up -d
```

The compose file exposes `${GRIMOIRE_PORT:-49300}` (web), with a
`grimoire-data` volume holding `grimoire.db`.

### Backups

Two layers, both automatic once configured:

1. **Pre-migration snapshots (always on).** `scripts/migrate.mjs` runs
   `VACUUM INTO` next to the DB file before applying any pending migration
   and keeps the last 3 snapshots (`grimoire.db.pre-migrate-*`). If a
   migration goes wrong, the restore point is already on the volume:
   `fly ssh console` → copy the snapshot over `grimoire.db` → restart.
2. **Offsite streaming replication (needs a bucket).** The image ships
   [Litestream](https://litestream.io); it activates when
   `LITESTREAM_REPLICA_URL` is set and is inert otherwise:

   ```bash
   fly secrets set \
     LITESTREAM_REPLICA_URL=s3://your-bucket/grimoire.db \
     LITESTREAM_ACCESS_KEY_ID=... \
     LITESTREAM_SECRET_ACCESS_KEY=...
   ```

   (For Cloudflare R2/Backblaze B2 also set `AWS_ENDPOINT_URL_S3` /
   region vars per the Litestream docs.) Restore to an empty volume with
   `litestream restore -o /data/grimoire.db s3://your-bucket/grimoire.db`.

**Required env vars for production:**

| Variable | Required | Description |
|---|---|---|
| `ORIGIN` | yes | Public URL — required for SvelteKit CSRF origin check (e.g. `https://grimoire.example.com`) |
| `ADMIN_USERNAME` | no | Username promoted to admin on each boot (default: `narfman0`) |
| `RESEND_API_KEY` | no | Transactional email via Resend; falls back to structured log output when unset |
| `SENTRY_DSN` | no | Server-side error monitoring (unhandled exceptions, 500s); Sentry is disabled when unset |
| `PUBLIC_SENTRY_DSN` | no | Client-side error monitoring; typically the same DSN as `SENTRY_DSN` |
| `LOG_LEVEL` | no | Structured log level (`trace`/`debug`/`info`/`warn`/`error`/`fatal`); defaults to `info` in production |
| `ANTHROPIC_API_KEY` | no | Enables AI features (map/statblock ingestion, turn suggestions); when unset, `/api/ai/*` returns 501 and the UI hides AI entry points |

**Single-instance only:** Grimoire uses SQLite and an in-process rate-limit store. Run one container. Multiple replicas would conflict on the SQLite file. The path to horizontal scaling is Postgres + a distributed rate-limit store — the Drizzle schema is intentionally kept portable for that migration.

## More

- **Contributing & conventions** → [AGENTS.md](./AGENTS.md) — workflow,
  commit format, boundaries, verification before push.
- **API** → [`/api`](http://localhost:5173/api) (Scalar reference) or
  `GET /api/openapi.json`.
- **Architecture** → `docs/` (data model, rules engine, content distribution).
- **Content packs** → SRD 5.2 (CC-BY 4.0) ships in
  `content-packs/` and is seeded on first boot. Non-SRD content is
  imported per-user via `POST /api/homebrew/import` (use
  `scripts/dump-packs-to-import-tarball.mjs` to dump a `grimoire-packs`
  checkout into an import-ready manifest). See
  `docs/content-distribution.md`.
