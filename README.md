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

## Endpoints (M0/M1 boundary)

| Method | Path                            | Purpose                                                 |
| ------ | ------------------------------- | ------------------------------------------------------- |
| POST   | `/api/campaigns`                | Create a campaign; returns `{id, code}` (6-char base32) |
| GET    | `/api/campaigns/:code`          | Fetch campaign metadata                                 |
| POST   | `/api/campaigns/:code/join`     | Set `grimoire_name` cookie; 204                         |
| (page) | `/`                             | Create or join                                          |
| (page) | `/c/:code`                      | Campaign room (placeholder until M1)                    |

## Milestones

- **M0** (this commit): scaffold + landing page + join flow.
- **M1**: characters CRUD + per-campaign character list page.
- **M2**: real-time character sheet edits via Hocuspocus / Y.js.
- **M3**: D&D Beyond paste-based importer.

## Notes

- No tests in M0; "it builds and boots" is the bar. Tests land with real
  logic in M1+.
- Don't deploy this to Vercel without first moving sync-server somewhere
  always-on; Vercel serverless can't host long-lived websockets.
