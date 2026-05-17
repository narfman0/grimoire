# grimoire

Collaborative D&D 5e campaign manager. Everyone at the table can edit
every character sheet in real time. Characters can be imported from
D&D Beyond via paste (no scraping).

Status: **M0 scaffold** — dev environment + bones only. No character
sheet UI or DDB importer yet.

## Stack

| Piece           | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Frontend        | SvelteKit + TypeScript + Tailwind v4                         |
| Web server      | `@sveltejs/adapter-node` (Vercel adapter swap noted in code) |
| DB              | SQLite via Drizzle ORM (`better-sqlite3`)                    |
| Realtime sync   | Hocuspocus (Y.js websocket server), separate process         |
| Hosting (now)   | `srv` via docker compose                                     |
| Hosting (later) | GCP App Engine or Vercel + a cloud DB                        |

Drizzle schema sticks to portable types (`text`, `integer`, `blob`) so a
later jump to Postgres is mostly an import swap.

## Layout

```
grimoire/
├── src/                # SvelteKit app
├── sync-server/        # Hocuspocus websocket server (own pnpm package)
├── drizzle/            # generated migrations
├── docs/               # data model + DDB import notes
├── Dockerfile          # multi-stage; targets `web` and `sync`
└── docker-compose.yml  # both services + shared sqlite volume
```

## Quickstart (local)

```bash
pnpm install                         # installs root + sync-server
pnpm db:generate                     # produces drizzle/0000_*.sql
pnpm migrate                         # applies it to ./grimoire.db
pnpm dev                             # SvelteKit on :5173
pnpm --filter @grimoire/sync-server dev   # Hocuspocus on :1234
```

If `better-sqlite3` fails to build, you'll need `python3`, `make`, and a
C++ toolchain. On Fedora: `sudo dnf install -y python3 make gcc-c++`.

## Deploy (srv)

```bash
docker compose build
docker compose up -d
```

The compose file exposes `${GRIMOIRE_PORT:-49300}` for the web service
and `${GRIMOIRE_SYNC_PORT:-49301}` for sync. Both write to a shared
named volume (`grimoire-data`) holding `grimoire.db`. Drizzle migrations
run on the web container's startup.

## API

The REST surface is described by an **OpenAPI 3.1** spec generated from Zod
schemas. The spec is the source of truth: the same schemas validate requests
at runtime and produce the spec — they can't drift.

- Spec JSON: `GET /api/openapi.json`
- Interactive docs: `/api` (rendered with [Scalar](https://scalar.com))
- Schema source: `src/lib/server/api/schemas.ts` (Zod)
- Path registrations: `src/lib/server/api/spec.ts`

| Method | Path                                       | Purpose                              |
| ------ | ------------------------------------------ | ------------------------------------ |
| POST   | `/api/campaigns`                           | Create a campaign                    |
| GET    | `/api/campaigns/{code}`                    | Fetch campaign metadata              |
| POST   | `/api/campaigns/{code}/join`               | Set `grimoire_name` cookie; 204      |
| GET    | `/api/characters?campaign=…`               | List characters (optionally filtered) |
| POST   | `/api/characters`                          | Create a character                   |
| GET    | `/api/characters/{id}`                     | Fetch a character                    |
| PATCH  | `/api/characters/{id}`                     | Update a character                   |
| DELETE | `/api/characters/{id}`                     | Delete a character; 204              |
| GET    | `/api/content`                             | List catalog rows (filter, paginate) |
| GET    | `/api/content/{kind}/{slug}`               | Latest public version                |
| GET    | `/api/content/{kind}/{slug}/v{version}`    | Pinned version                       |
| GET    | `/api/content/sources`                     | Public source slugs                  |
| GET    | `/api/openapi.json`                        | OpenAPI 3.1 spec (JSON)              |
| (page) | `/`                                        | Create or join                       |
| (page) | `/c/{code}`                                | Campaign room (character list)       |
| (page) | `/api`                                     | Scalar API reference                 |

Adding an endpoint = (1) add/extend the Zod schema in `schemas.ts`,
(2) `registry.registerPath({...})` in `spec.ts`, (3) write the handler using
`parseJson`/`parseParams`/`parseSearch` from `validate.ts`. Spec updates
automatically.

## Content layer

D&D content (species, classes, feats, items, spells…) lives in **packs**
on disk and is loaded into the `content` table at server boot. The pack
loader walks two roots:

- `./content-packs/` — packs shipped with this repo. **SRD only** (CC-BY 4.0).
- `$GRIMOIRE_PACKS_DIR` — operator-supplied packs from the separate
  [grimoire-packs](https://github.com/narfman0/grimoire-packs) repo (private).
  Non-SRD official content (post-2014 PHB, Tasha's, Wildemount, etc.) and
  homebrew live here.

Each pack is `{meta.json + any *.json files}`. Each JSON file is a row or
an array of rows. See `docs/pack-loader.md` and `docs/content-model.md`.

## Rules engine

`src/lib/rules/` — pure-function `derive(character, contentLookup) -> derived`.
Composes ability scores, AC, HP, saves, skills, spellcasting; assembles
weapon/spell actions; applies action-modifiers; registers triggers; runs
soft validations. Vitest fixtures (`pnpm test`) cover a Tortle Chronurgy
Wizard L5 and a Half-Orc Path of the Zealot Barbarian L3 end-to-end against
the real on-disk packs. See `docs/rules-engine.md`.

## Milestones

- **M0 ✅**: scaffold + landing page + join flow.
- **M1 ✅**: characters CRUD + per-campaign list page + OpenAPI docs.
- **M1.5 ✅**: pack loader, public `/api/content`, SRD 5.2 tier 1 seed,
  rules engine v0, vitest fixtures.
- **M1.6**: SRD 5.2 tier 2 (full species/class/feat/spell coverage, parallel PRs).
- **M2**: sheet UI + real-time edits via Hocuspocus / Y.js.
- **M3**: D&D Beyond paste-based importer + turn/encounter planner.

## Workflow

Commit and push **frequently** straight to `master`. One logical change per
commit, conventional-commit prefixes (`feat:` / `fix:` / `chore:` / `docs:` /
`refactor:`), and a `pnpm build` before every push. No long-lived branches for
solo work; branch + PR only for risky changes (schema migrations, infra spikes).

Full workflow and contributor expectations live in [AGENTS.md](./AGENTS.md).

## Notes

- No tests in M0; "it builds and boots" is the bar. Tests land with real
  logic in M1+.
- Don't deploy this to Vercel without first moving sync-server somewhere
  always-on; Vercel serverless can't host long-lived websockets.
