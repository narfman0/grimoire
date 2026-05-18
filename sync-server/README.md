# sync-server

Hocuspocus websocket server for grimoire. Brokers Y.Doc updates between
players editing the same character sheet and persists them to the shared
sqlite file.

## Why it's a separate package

Hocuspocus keeps long-lived websocket connections, which won't survive on
Vercel or other serverless platforms. On srv it runs as its own container
next to the SvelteKit web app, sharing the sqlite file via a named volume.

## Run

```bash
pnpm install            # from the repo root, installs both packages
pnpm --filter @grimoire/sync-server dev
```

Defaults: listens on `:47474`, persists to `../grimoire.db` (override with
`DATABASE_URL` and `SYNC_PORT`).

## Notes

- `@hocuspocus/extension-sqlite` may need `better-sqlite3` rebuilt against
  the local Node version. If you see "NODE_MODULE_VERSION" errors, run
  `pnpm rebuild better-sqlite3`.
- Document names follow `character:<uuid>` and `note:<uuid>` — the web
  client picks these. The schema in the main app's `yjs_updates` /
  `yjs_state` columns mirrors this; expect to consolidate or document the
  overlap before M2 ships.
