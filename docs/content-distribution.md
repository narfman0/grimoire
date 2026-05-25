# content distribution

How content rows reach the `content` table at runtime. Supersedes the
file-walk-everything spec in [pack-loader.md](./pack-loader.md).

Companion to [content-model.md](./content-model.md) (what a row is) and
[seed-sources.md](./seed-sources.md) (where rows come from / attribution).

## Overview

Two on-ramps, scoped by licensing model:

1. **First-boot SRD seed.** The server walks the in-repo
   `./content-packs/` directory once, on the first start against a fresh
   database. Idempotent — subsequent boots see the `srd-5.2` row in
   `packs` and skip the walk entirely. CC-BY content only; everything
   under this path is publishable open source.

2. **POST /api/homebrew/import.** Authenticated users upload pack-shaped
   JSON manifests; every row is stamped `owner_user_id = <caller>`,
   `pack_slug = 'homebrew'`, `visibility = 'unlisted'`. This is the
   sole entry point for non-SRD content (book imports, third-party,
   per-instance homebrew). The old `$GRIMOIRE_PACKS_DIR` filesystem walk
   has been removed.

A companion `GET /api/homebrew/export` emits the same manifest shape so
import → export is a true roundtrip.

## First-boot SRD seed

`seedSrdIfMissing()` in `src/lib/server/content/loader.ts`:

```ts
const result = await seedSrdIfMissing();
// { loaded: 717, skipped: false }   ← fresh DB
// { loaded: 0,   skipped: true }    ← srd-5.2 already in `packs`
```

Wired into `src/hooks.server.ts` at boot. Per-pack transaction inside; a
malformed file rolls back the pack's row + content insertions and leaves
the DB clean.

The probe is `SELECT slug FROM packs WHERE slug IN ('srd-5.2','srd-5.1')`.
Once at least one of those rows exists, the seed is treated as done. To
force a re-seed (e.g., after editing the in-repo pack files):

```sql
DELETE FROM packs WHERE slug = 'srd-5.2';
DELETE FROM content WHERE pack_slug = 'srd-5.2';
-- then restart the server
```

This is operator-explicit cleanup, never automatic.

## POST /api/homebrew/import

Body shape:

```jsonc
{
  "meta": {
    "slug": "my-pack",                 // pack identifier — informational
    "name": "Display name",
    "version": "1.0",
    "default_source": "my-pack",       // applied to rows without `source`
    "author": "narfman0"               // optional
  },
  "rows": [
    {
      "kind": "feature",
      "slug": "foo",
      "version": 1,
      "name": "Foo",
      "source": "my-pack",             // optional; falls back to meta.default_source
      "data": { /* kind-specific payload */ }
    }
    // … up to HOMEBREW_IMPORT_MAX_ROWS (2000) per request
  ]
}
```

Response:

```jsonc
{
  "created": 12,
  "updated": 3,
  "skipped": 1,
  "errors": [
    { "kind": "feat", "slug": "bad-feat", "reason": "data.foo: unknown key" }
  ]
}
```

Semantics:

- **Auth required.** Unauthenticated requests get `401`.
- **Per-row validation.** Each row's `data` is validated against the
  kind-specific schema in `src/lib/server/content/schemas.ts`. Failures
  go into `errors[]` and the row is skipped — sibling rows continue.
- **Upsert key.** `(kind, slug, version, owner_user_id)`. Re-importing
  the same manifest as the same user updates that user's rows in place;
  it never touches SRD content (which has `owner_user_id IS NULL`) or
  another user's rows.
- **Atomicity.** The whole batch runs in one `db.transaction`. A
  catastrophic DB error rolls everything back; per-row validation errors
  do not.
- **Bulk cap.** Requests above `HOMEBREW_IMPORT_MAX_ROWS` (2000) get
  `413`. Split larger uploads into multiple requests.
- **Cross-user coexistence.** Two users can each own a `feat:fireball`
  with no conflict — the DB unique index includes `owner_user_id`.

## GET /api/homebrew/export

Returns the caller's owned content in the same manifest shape POST
`/api/homebrew/import` accepts.

```bash
GET /api/homebrew/export
GET /api/homebrew/export?kind=feature
GET /api/homebrew/export?source=my-pack
```

When the user has no rows the response is `{ "meta": null, "rows": [] }`.
Otherwise `meta.slug` and `meta.default_source` are inferred from the most
common `source` slug across the user's rows. Rows whose source matches
`meta.default_source` omit the field in the export; rows that differ keep
their explicit `source` so the manifest is roundtrip-faithful.

Example roundtrip:

```bash
curl -b cookies.txt http://localhost:5173/api/homebrew/export > backup.json
# ... wipe DB, fresh boot, re-login ...
curl -b cookies.txt -X POST -H 'content-type: application/json' \
  --data-binary @backup.json http://localhost:5173/api/homebrew/import
```

## Bootstrap recipe — operator-owned grimoire-packs

A fresh deploy now has the SRD pack only. To load the operator's
private grimoire-packs content:

```bash
# 1. Dump the pack tree into one JSON manifest:
node scripts/dump-packs-to-import-tarball.mjs \
  --packs-dir ../grimoire-packs \
  --output grimoire-packs-import.json

# 2. Log in once and capture the session cookie (the homebrew API requires
#    the same auth as the web UI):
curl -c cookies.txt -X POST -H 'content-type: application/json' \
  -d '{"username":"narfman0","password":"…"}' \
  http://localhost:5173/api/auth/login

# 3. Upload:
curl -b cookies.txt -X POST -H 'content-type: application/json' \
  --data-binary @grimoire-packs-import.json \
  http://localhost:5173/api/homebrew/import
# {"created":N,"updated":0,"skipped":0,"errors":[]}
```

The script accepts `--pack <slug>` to limit to one top-level pack
directory; without it every pack under `--packs-dir` is concatenated
into one manifest, with each row's `source` stamped explicitly so the
merged upload roundtrips cleanly.

For large pack trees split across multiple POSTs (the 2000-row cap):

```bash
node scripts/dump-packs-to-import-tarball.mjs \
  --packs-dir ../grimoire-packs --pack phb-2014 --output phb-2014.json
node scripts/dump-packs-to-import-tarball.mjs \
  --packs-dir ../grimoire-packs --pack phb-2024 --output phb-2024.json
# upload each independently
```

## Loss of `GRIMOIRE_PACKS_DIR`

The environment variable previously read by the loader is gone. A
deployment that relied on it will continue to boot — the loader simply
won't pick up the directory anymore. Migrate by dumping the pack tree
to a manifest and uploading via the import endpoint (see above).

The `./content-packs/` directory in this repo is still file-shipped (in
the Dockerfile, in `fly.toml`) for the SRD seed.

## What got dropped vs the old pack-loader spec

- Filesystem walk of `$GRIMOIRE_PACKS_DIR` at boot.
- Cross-pack alphabetical ordering (only one pack ships now).
- Orphan-detection warnings for grimoire-packs.
- Conflict policy across multiple disk packs.

What survived:

- Per-pack transaction inside `loadAllPacks` (kept as `@deprecated`).
- The Zod row shape (`ContentRowFile`) — re-used by `/api/homebrew/import`.
- The `packs` table schema. The `homebrew` row in that table is the FK
  target for every user-owned content row, including imported ones.

## Related

- [content-model.md](./content-model.md) — what a row looks like.
- [seed-sources.md](./seed-sources.md) — which sources exist and where.
- [pack-loader.md](./pack-loader.md) — historical spec for the
  multi-root walker (superseded by this doc).
