# grimoire

Collaborative D&D 5e campaign manager. Everyone at the table can edit
every character sheet in real time. Characters can be imported from
D&D Beyond via paste (no scraping).

Status: **active table use**. Sheet, encounter builder with live turn /
HP sync, planner + resolve + append-only action log, slots and resources,
feat picker with player-choice slots, multi-campaign characters via a
join table. See [Milestones](#milestones).

## Stack

| Piece           | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Frontend        | SvelteKit + TypeScript + Tailwind v4                         |
| Web server      | `@sveltejs/adapter-node`                                     |
| DB              | SQLite via Drizzle ORM (`better-sqlite3`)                    |
| Realtime sync   | REST mutations + SSE fan-out from an in-memory hub           |
| Hosting (now)   | `srv` via docker compose                                     |

Drizzle schema stays portable (`text` / `integer`) so the Postgres swap is
mostly an import change.

## Getting started

```bash
pnpm install
pnpm migrate         # applies any pending drizzle migrations
pnpm dev             # SvelteKit (:5173) — SSE rides the same port
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
startup. The live channel is plain SSE on the same port — no separate
sync process. Behind a reverse proxy, make sure `text/event-stream`
isn't buffered (nginx: `proxy_buffering off;`).

## More

- **Contributing & conventions** → [AGENTS.md](./AGENTS.md) — workflow,
  commit format, boundaries, verification before push.
- **API** → [`/api`](http://localhost:5173/api) (Scalar reference) or
  `GET /api/openapi.json`. Spec is generated from `src/lib/server/api/spec.ts`
  + the Zod schemas in `schemas.ts`; runtime validation and docs can't drift.
- **Architecture** → `docs/` (data model, rules engine, pack loader).
  Code layout follows from `src/lib/` (rules, server, components) and
  `src/routes/` (api handlers + pages); both are short directory trees,
  not worth duplicating here.
- **Content packs** → SRD 5.2 (CC-BY 4.0) ships in
  `content-packs/`. Non-SRD content goes in `$GRIMOIRE_PACKS_DIR`
  (private repo or any local path). The engine is pack-agnostic; homebrew
  uses the same shape. See `docs/pack-loader.md`.

## Milestones

| | Scope |
|---|---|
| M0 ✅ | Scaffold |
| M1 ✅ | Characters CRUD + per-campaign page + OpenAPI 3.1 |
| M1.5 ✅ | Pack loader, `/api/content`, SRD 5.2, rules engine v0, vitest |
| M1.6 ✅ | SRD 5.2 fill-out + content authoring |
| M2 ✅ | Editable sheet + Y.js HP/condition/toggle sync |
| M3 ✅ | Encounters, monster picker, live turn sync, planner, resolve + amend, action log |
| M3.5 ✅ | Multi-target save, reaction/concentration, slots/resources, action-economy, monster derive, feat picker (8 choice slots), hover popups |
| M3.6 ✅ | Character ↔ campaign decoupling: `campaign_characters` M:N, `/characters` library, link/unlink |
| M4 | Notes/NPC polish, dice broadcast, presence, undo, exporters |
