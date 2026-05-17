# pack loader

How content gets from JSON files on disk into the `content` table at
runtime. This is the spec; implementation lands in M1.5.

Companion to [content-model.md](./content-model.md) (what a row is) and
[seed-sources.md](./seed-sources.md) (where rows come from / attribution).

## Overview

A **pack** is a directory of JSON files. At server boot, the loader walks
two roots:

1. `./content-packs/` — packs shipped with this repo. SRD-only.
2. `$GRIMOIRE_PACKS_DIR` — operator-supplied. Typical value: a checkout of
   [grimoire-packs](https://github.com/narfman0/grimoire-packs) (private,
   non-SRD content).

Both feed the same loader. Rows persist in the `content` table; the boot
walk keeps the DB in sync with what's on disk.

## Pack format

```
my-pack/
  meta.json                     # pack-level metadata
  races.json                    # bundled: array of rows
  classes/wizard.json           # split: one row per file
  classes/barbarian.json
  spells/cantrips.json          # bundled by some convention
  spells/1st-level.json
  feats/great-weapon-master.json
```

The loader is **layout-agnostic**: every `*.json` file under the pack root
(except `meta.json`) is read and parsed. Each file's content is either a
single row or an array of rows. The loader normalizes both shapes.

### `meta.json`

```jsonc
{
  "slug": "srd-5.2",                     // pack identifier; primary key in `packs` table
  "name": "System Reference Document 5.2.1",
  "version": "5.2.1",                    // informational; row versions are independent
  "default_source": "srd-5.2"            // applied to rows that omit `source`
}
```

Fields deliberately omitted for now: `license`, `publisher`, `attribution`,
`visibility`. They'll come back when we ship the public API (these gate
what `/api/content` returns and what UI footers show). Adding fields to
`meta.json` later is a non-breaking change.

### Content row file

Each non-`meta.json` file contains either:

```jsonc
// single-row form
{ "kind": "race", "slug": "half-orc", "version": 1, "name": "Half-Orc", "data": {...} }

// array form
[
  { "kind": "race", "slug": "half-orc",  "version": 1, "name": "Half-Orc",  "data": {...} },
  { "kind": "race", "slug": "dragonborn", "version": 1, "name": "Dragonborn", "data": {...} }
]
```

A pack has **no kind restriction** — `feats/foo.json` is a convention for
authors, not a rule. The row's own `kind` field is authoritative.

A row's `source` field, if omitted, defaults to the pack's `default_source`.
This avoids `"source": "srd-5.2"` repeating on every row in the SRD pack.

## Pack location

| Path | Contents | Versioned in |
| ---- | -------- | ------------ |
| `./content-packs/srd-5.2/` | SRD 5.2 (CC-BY 4.0) | this repo |
| `./content-packs/srd-5.1/` (optional) | SRD 5.1 fallback (OGL 1.0a) | this repo |
| `$GRIMOIRE_PACKS_DIR/*/` | non-SRD content: official-beyond-SRD, homebrew, paid third-party | the `grimoire-packs` separate repo (recommended layout: a symlink from `./grimoire-packs` to the checkout, with `GRIMOIRE_PACKS_DIR=./grimoire-packs`) |

**Hard rule** (from [seed-sources.md](./seed-sources.md)): non-SRD content
never enters this repo. CI on this repo will enforce it once the loader
exists.

## Schema additions

Two changes to the Drizzle schema (a Postgres-portable migration when M1.5
lands):

### New `packs` table

```sql
CREATE TABLE packs (
  slug            TEXT PRIMARY KEY,        -- matches meta.json `slug`
  name            TEXT NOT NULL,
  version         TEXT NOT NULL,
  default_source  TEXT NOT NULL,
  loaded_at       INTEGER NOT NULL         -- unix ms of last successful load
);
```

### New column on `content`

```sql
ALTER TABLE content ADD COLUMN pack_slug TEXT NOT NULL REFERENCES packs(slug);
CREATE INDEX content_pack ON content (pack_slug);
```

`pack_slug` is what campaign-enablement filters read; deleting a `packs`
row cascades-deletes its `content` rows (operator-explicit cleanup only,
not driven by the loader).

## Loader behavior

### When

**Boot-time only, for now.** The server's `init()` step walks both roots,
loads all packs, then accepts requests. Filesystem watcher is deferred.

A CLI to trigger a re-sweep without restart is also deferred. If you edit
a pack file during dev, restart the dev server.

### Order

Packs load in **alphabetical order by `meta.slug`**. Deterministic logs,
predictable behavior when packs reference rows from earlier packs (e.g., a
subclass row depending on its parent class existing). No formal dependency
system; alphabetical-plus-FK-checks catches the common case.

### Conflict policy

Conflict = a row from disk has the same `(kind, slug, version, scope_id)`
as a row already in the DB, but different content.

- **If no character references the existing `(slug, version)`**: overwrite
  the DB row with the disk row. Free iteration while authoring.
- **If any character references it**: refuse. Log an error naming the file
  and the count of referencing characters. The author must either revert
  the file edit or bump the row's `version` (and write a migration story
  separately, out of scope for the loader).

This is one SELECT per row at load time. Trivially fast at our scale.

### Removal (DB has a row the pack no longer ships)

**Keep + warn.** The loader emits:

```
WARN pack=srd-5.2 orphaned row: race/aasimar@v1 (referenced by 0 characters)
```

Operators decide whether to clean up. A separate `content:prune` command
may land later. The loader never auto-deletes.

### Transactions

**Per-pack transaction.** A malformed file inside `srd-5.2` rolls back the
entire `srd-5.2` pack — but `grimoire-packs/tashas-2020` (loaded
independently) is unaffected. Atomic per pack, partial across packs.

Within a transaction:

1. Upsert the `packs` row from `meta.json`.
2. Walk content files; for each row: validate (Zod), apply conflict
   policy, upsert into `content`.
3. Detect orphans (DB rows for this `pack_slug` not seen in the walk) and
   emit warnings.
4. Update `packs.loaded_at`.
5. Commit.

If any step throws, the txn rolls back and the loader continues to the
next pack with a logged error.

### Logging

Production summary:

```
[grimoire] pack srd-5.2 loaded: 9 races, 12 classes, 48 feats, 312 spells, 89 items, 0 warnings (87ms)
[grimoire] pack tashas-2020 loaded: 11 subclasses, 2 races, 14 feats, 0 warnings (12ms)
[grimoire] content layer ready (3 packs, 545 rows, 99ms)
```

Dev (`NODE_ENV !== 'production'`): one line per row loaded, prefixed with
file path, useful for tracking down validation errors.

Errors always include: pack slug, file path, row key (`kind/slug@version`),
and the underlying Zod or DB error.

## Performance

SQLite + ~500 rows in one transaction is sub-100ms. Postgres concerns
(blocking server start, parallelizing packs) are deferred to the cloud
migration.

## Deferred

- **Filesystem watcher** for live reload during pack authoring.
- **CLI commands** (`content:sync`, `content:import`, `content:list`,
  `content:enable`) — none ship at M1.5. The likely first to land is
  `content:validate` for CI, once the validator exists.
- **`license` / `publisher` / `attribution` / `visibility`** on `meta.json`.
  Returns when the public API + UI attribution surfaces are built.
- **Content hashing** for skip-if-unchanged optimization. Don't need it at
  this scale.
- **Pack-to-pack dependency declarations**. Alphabetical + FK validation
  is enough for v1.
- **`content:prune`** explicit-cleanup command. Add when first orphan-warn
  becomes actionable.

## Related

- [content-model.md](./content-model.md) — what a row looks like.
- [seed-sources.md](./seed-sources.md) — which packs exist and where.
- [rules-engine.md](./rules-engine.md) — what reads `content` after it's loaded.
