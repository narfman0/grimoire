# grimoire

Collaborative D&D 5e campaign manager. Everyone at the table can edit
every character sheet in real time.

Status: **active table use**.

## Features

- **Live character sheets** — HP, conditions, spell slots, and resources sync in real time across all players
- **Encounter runner** — initiative order, per-participant action economy foldout, spell casting with slot consumption, concentration tracking, damage saves
- **Rules engine** — derives AC, attack bonuses, save DCs, proficiencies, and resistances from class/subclass/feat/species/background content
- **Content packs** — SRD 5.2 ships in-repo; non-SRD content loaded from `$GRIMOIRE_PACKS_DIR` at boot; homebrew authored in-app
- **Homebrew editors** — structured forms for all 11 content kinds (spells, items, feats, classes, subclasses, species, subspecies, backgrounds, features, conditions, monsters)
- **Feat picker** — player-choice slots with prereq enforcement; subclass expanded spells auto-populate
- **Multi-campaign characters** — one character can belong to multiple campaigns via a join table

## Stack

| Piece           | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Frontend        | SvelteKit + TypeScript + Tailwind v4                         |
| Web server      | `@sveltejs/adapter-node`                                     |
| DB              | SQLite via Drizzle ORM (`better-sqlite3`)                    |
| Realtime sync   | SSE pub/sub hub in-process (`src/lib/server/realtime/hub.ts`) |
| Hosting (now)   | `srv` via docker compose                                     |

Drizzle schema stays portable (`text` / `integer`) so the Postgres swap is
mostly an import change.

## Getting started

```bash
pnpm install
pnpm migrate         # applies any pending drizzle migrations
pnpm dev             # SvelteKit on :5173
```

Open [http://localhost:5173](http://localhost:5173). Sign up, create a
campaign, share the 6-character code, play.

To play from another machine on your LAN, point your browser at
`http://<host>:5173`. If Vite blocks the host, set
`VITE_ALLOWED_HOSTS=host,laptop.local,…` in `.env.local` (gitignored).

If `better-sqlite3` fails to build, install a C++ toolchain. On Fedora:
`sudo dnf install -y python3 make gcc-c++`.

## Deploy

```bash
docker compose build && docker compose up -d
```

The compose file exposes `${GRIMOIRE_PORT:-49300}` (web), with a
`grimoire-data` volume holding `grimoire.db`. Migrations run on container
startup. Behind a reverse proxy, make sure `text/event-stream`
isn't buffered (nginx: `proxy_buffering off;`).

## More

- **Contributing & conventions** → [AGENTS.md](./AGENTS.md) — workflow,
  commit format, boundaries, verification before push.
- **API** → [`/api`](http://localhost:5173/api) (Scalar reference) or
  `GET /api/openapi.json`.
- **Architecture** → `docs/` (data model, rules engine, pack loader).
- **Content packs** → SRD 5.2 (CC-BY 4.0) ships in
  `content-packs/`. Non-SRD content goes in `$GRIMOIRE_PACKS_DIR`
  (private repo or any local path). See `docs/pack-loader.md`.
