# data model

Schema lives in `src/lib/server/db/schema.ts`. Only portable column types (`text`, `integer`, `blob`) are used so a Postgres swap is mechanical.

## Tables

### `campaigns`
Campaign rooms. Identified publicly by a short `code` shared with players.

### `characters`
Character records. The mutable state (HP, conditions, spells, inventory) lives in `characters.document` as a JSON blob, mutated via REST PATCH. The `campaign_id` column is a soft home-pointer; actual campaign membership is tracked in `campaign_characters`.

### `campaign_characters`
M:N join between campaigns and characters. A character can belong to multiple campaigns. Always join through this table to determine membership — do not filter by `characters.campaign_id`.

### `content`
The game-content catalog: species, classes, feats, spells, items, etc. Each row has a `kind`, `slug`, `version`, and a `data` JSON blob whose shape depends on `kind`. Rows are immutable once referenced by a character — edits create a new version. See `docs/content-model.md`.

### `packs`
Metadata for each loaded content pack (`slug`, `name`, `version`, `author`). Populated at server boot by the pack loader.

### `users`, `sessions`
Auth. Users sign up with a username/password; sessions are server-side.

### `encounters`, `participants`, `action_log`
Encounter state. `encounters` owns the initiative list; `participants` are the combatants; `action_log` is append-only and records every resolved turn.

### `notes`
Shared campaign notes scoped to a campaign.

### `homebrew_subscriptions`, `content_reports`, `notifications`
Marketplace scaffolding. Not yet surfaced in UI.

## Portability

When moving to Postgres: `drizzle-orm/sqlite-core` → `drizzle-orm/pg-core`. `integer timestamp_ms` → `timestamp with timezone`. `blob` → `bytea`. No SQLite-specific features, triggers, or joins are used.
