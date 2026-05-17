# data model

Drizzle schema lives in `src/lib/server/db/schema.ts`. Only portable column
types are used (`text`, `integer`, `blob`) so a Postgres swap stays mechanical.

## Tables

### `campaigns`

| Column       | Type        | Notes                                                       |
| ------------ | ----------- | ----------------------------------------------------------- |
| `id`         | text PK     | UUID                                                        |
| `code`       | text UNIQUE | 6-char base32 (no `0/O/1/I/L`). Shared with players.        |
| `name`       | text        | Display name                                                |
| `created_at` | integer     | Unix ms                                                     |

### `characters`

| Column        | Type    | Notes                                              |
| ------------- | ------- | -------------------------------------------------- |
| `id`          | text PK | UUID                                               |
| `campaign_id` | text FK | → `campaigns.id`                                   |
| `name`        | text    | Character name (also lives inside the Y.Doc).      |
| `yjs_state`   | blob    | Latest compacted Y.Doc snapshot (for cold reads).  |
| `updated_at`  | integer | Unix ms                                            |

### `yjs_updates`

Append-only journal of Y.Doc deltas. Hocuspocus's sqlite extension manages
its own tables today; this column exists so the web app can persist the
**compacted** snapshot on its side independently of Hocuspocus's internal
storage. M2 will reconcile these into one source of truth.

| Column         | Type           | Notes                          |
| -------------- | -------------- | ------------------------------ |
| `id`           | integer PK AI  |                                |
| `character_id` | text FK        | → `characters.id`              |
| `update`       | blob           | Raw `Y.encodeStateAsUpdateV2`  |
| `created_at`   | integer        | Unix ms                        |

### `notes`

Shared campaign notes (DM-side journal, shared lore, etc.). Same CRDT
flow as characters but scoped to a campaign rather than a character.

| Column        | Type    | Notes                  |
| ------------- | ------- | ---------------------- |
| `id`          | text PK | UUID                   |
| `campaign_id` | text FK | → `campaigns.id`       |
| `title`       | text    |                        |
| `yjs_state`   | blob    | Latest Y.Doc snapshot. |

## CRDT flow (M2 sketch)

1. Client opens `/c/:code/character/:id`, the page subscribes to the
   websocket at `ws://srv:49301/character/<id>`.
2. Hocuspocus loads any persisted state for that document name from sqlite
   (its own table), pushes it to the client, and applies subsequent updates.
3. On disconnect (or on a periodic flush) Hocuspocus compacts and persists.
4. Independently, the web app reads the compacted snapshot from the
   `characters.yjs_state` column for non-realtime reads (e.g. campaign
   index page showing party HP totals). M2 decides whether the web app
   computes that snapshot from Hocuspocus's table or whether Hocuspocus
   writes to ours directly via a custom extension.

## Portability notes

When moving to Postgres:

- `drizzle-orm/sqlite-core` → `drizzle-orm/pg-core`
- `integer('...', { mode: 'timestamp_ms' })` → `timestamp('...', { withTimezone: true })`
- `blob('...')` → `bytea('...')`
- `integer().primaryKey({ autoIncrement: true })` → `serial().primaryKey()`

No schema-level joins, triggers, or SQLite-only features are used.
