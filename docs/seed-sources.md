# seed sources

Where the v1 content catalog comes from, and the attribution we owe each
source. Read alongside [content-model.md](./content-model.md), which defines
the `content.source` column this doc enumerates.

D&D 5e content is open, but not freely — every source carries license terms
and attribution requirements. We track this per row so attribution can't
silently drift.

## Sources

| `source` value | License | Content covered                                            | Lives in |
| -------------- | ------- | ---------------------------------------------------------- | -------- |
| `srd-5.2`      | CC-BY 4.0 | **Primary v1 seed.** 9 species, 12 classes (one subclass each), ~48 feats incl. GWM, all SRD spells, weapons, armor, magic items, conditions, basic backgrounds. Released April 2025 by WotC. | This repo, `content-packs/srd-5.2/`. |
| `srd-5.1`      | OGL 1.0a | Older SRD; broadly similar coverage but **only one feat (Grappler)** and an older rules baseline. Available locally at `~/workspace/dnd-5e-srd` as prose JSON. | This repo if used; preferred to use 5.2 wherever possible. |
| Non-SRD official | proprietary | Content from PHB, Xanathar's, Tasha's, Wildemount, and other published sourcebooks beyond the SRD. | **`grimoire-packs` (separate private repo).** Never this repo. |
| `homebrew`     | none    | DM- or player-authored content, scoped to a campaign or user. | `grimoire-packs` or operator's local pack dir. |
| Third-party SRD-equivalent | varies | Future: Kobold Press CC-BY content, Level Up A5E, etc. Each gets its own `source` slug like `kobold-tob-cc-by`. | This repo only if openly licensed; otherwise `grimoire-packs`. |

## Rule: non-SRD content never enters this repo

The public grimoire repo and any public deployment of its API ship **only**
openly-licensed content (`srd-5.2`, possibly `srd-5.1`, future CC-BY
third-party). Anything else — official WotC content beyond SRD, the
operator's homebrew, third-party paid content — lives in
**[grimoire-packs](https://github.com/narfman0/grimoire-packs)** (a separate
private repo) and is loaded at runtime via `GRIMOIRE_PACKS_DIR`.

Reasons:

- Once non-SRD content lands in git history, removing it is messy. Keeping
  this repo SRD-only means it stays publishable open source indefinitely.
- The public API can be advertised as a clean CC-BY 4.0 SRD service; no
  asterisks needed.
- Operators with rights to additional content (e.g., they own the books)
  load their packs into their own deploy without anyone else seeing them.
- Each operator decides what they have rights to. We don't.

CI on this repo should fail if any file under `content-packs/` references a
`source` slug not in the public allow-list (`srd-5.2`, `srd-5.1`, and any
explicitly-permitted CC-BY third-party). Worth adding once the pack loader
lands.

## Per-source attribution

### `srd-5.2` (CC-BY 4.0)

Required: visible attribution to the original work and license. We include
this in the footer of every page that displays SRD content (campaign room,
character sheet, API docs):

> Portions of this content are from the System Reference Document 5.2.1 © 2025
> Wizards of the Coast LLC, available at <https://dnd.wizards.com/resources/systems-reference-document>
> under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode).
> Wizards of the Coast endorsement is not implied.

No further per-row attribution needed. Modifications are allowed; we don't
need to flag modified rows specifically, though the row's `version` history
in the `content` table documents any edits we make.

### `srd-5.1` (OGL 1.0a)

Required: include the full Open Game License v1.0a in a `LICENSES.md` (or
similar) shipped with the application, plus a Section 15 entry naming "System
Reference Document 5.1 Copyright 2023, Wizards of the Coast LLC."

Also: no use of the Product Identity terms listed in the SRD 5.1 OGL
section. The local `~/workspace/dnd-5e-srd` repo includes the full text;
copy it verbatim into `LICENSES.md` if/when we ingest 5.1 rows.

**Preference:** use `srd-5.2` over `srd-5.1` for any overlapping row. Treat
`srd-5.1` as a fallback source for prose continuity, not a default.

### `homebrew`

No attribution required. The author is implicitly the campaign owner.

### Third-party (future)

Must satisfy whatever license that publisher ships with. Plan: a `sources`
table (or hardcoded map in `src/lib/server/content/sources.ts`) keyed by the
source slug, listing:

```ts
type SourceMetadata = {
  slug: string;
  name: string;          // "System Reference Document 5.2.1"
  publisher: string;
  license: 'CC-BY-4.0' | 'OGL-1.0a' | 'proprietary' | 'homebrew';
  attribution: string;   // text to render in UI footers
  licenseText?: string;  // for OGL/proprietary, full text to include in LICENSES.md
};
```

Adding a new source = add an entry there before any row references it.

## How a content row records its source

```jsonc
{
  "kind": "feat",
  "slug": "great-weapon-master",
  "version": 1,
  "source": "srd-5.2",      // ← source slug, matches a SourceMetadata entry
  "scope_id": null,
  ...
}
```

The source slug is **immutable** for a given `(slug, version, scope_id)`.
If we re-derive a feat from a different source (e.g., rewriting a homebrew
feat to match SRD 5.2 wording), it becomes a new row in `srd-5.2`, not an
update to the homebrew row.

## UI surface

Two places attribution appears:

1. **Footer of every public page that renders SRD content.** Auto-built
   from the set of `source` slugs touched by content rendered on that page.
   For campaign rooms this is effectively constant ("SRD 5.2 + homebrew");
   for API docs (`/api`) it's whatever sources the schema-defined examples
   pull from.
2. **A `/legal` or `/licenses` page** (link in the global footer) listing
   every active source, full license texts where the license requires it
   (OGL 1.0a; proprietary), and our Section 15-style ancestry.

Per-content-row badges (e.g., "SRD 5.2" pill on the Greatsword card) are
nice-to-have, deferred to UI polish.

## Pack loading at runtime

A pack is a directory of JSON files (one per row, or batched per kind) under
a top-level slug:

```
content-packs/srd-5.2/
  meta.json          # {slug, license, attribution, ...}
  species/orc.json
  classes/barbarian.json
  classes/wizard.json
  ...
```

At boot, the server walks two directories:

1. `./content-packs/` — packs shipped with this repo (SRD only).
2. `$GRIMOIRE_PACKS_DIR` — operator-supplied packs (default unset; typical
   value `/srv/grimoire/packs/` or a symlink to a checkout of
   `grimoire-packs`).

Both feed the same loader, which upserts rows into the `content` table.
Rows persist across boots (the table is the source of truth at query time);
the boot walk is for keeping the DB in sync with what's on disk.

Campaign enablement: a campaign carries `enabled_packs: string[]` (pack
slugs). The content resolver filters rows by
`scope_id IS NULL AND pack_slug IN campaign.enabled_packs`. SRD 5.2 is
always enabled. Packs added at runtime require the DM to opt in via the
campaign settings UI before their content appears in pickers.

## v1 seeding plan

1. Download SRD 5.2.1 (already CC-BY); parse into structured rows. Ship
   under `content-packs/srd-5.2/` in this repo.
2. Hand-write modifier/activity data for each row. The SRD ships prose;
   `{type:'bonus', target:'ability.str', value:2}` doesn't extract
   automatically. Budget this honestly — it's hundreds of small JSON
   blobs, not a script run.
3. For non-SRD content, author pack files in **the grimoire-packs repo**, not here.
4. Use `~/workspace/dnd-5e-srd` (SRD 5.1) prose as a sanity-check source
   for SRD 5.2 rows, but tag the rows themselves `source: 'srd-5.2'`.
5. Stub `src/lib/server/content/sources.ts` with `srd-5.2` and
   `homebrew` only; defer 5.1 ingestion until needed.
6. Add a CI check that rejects any `content-packs/**/*.json` referencing a
   `source` slug not in the public allow-list.

## Why not pull from Foundry's `dnd5e` compendium?

The Foundry dnd5e system code is MIT, but its bundled JSON compendiums mix
SRD content (CC-BY-able) with system-specific keys and conventions. Schema
ideas are unprotectable and we mirror several of them, but we don't import
their JSON wholesale. Re-seeding from SRD 5.2 directly avoids any
license-laundering question and gives us a row shape that matches our model
without translation glue.

## Related

- [content-model.md](./content-model.md) — what each content row looks like.
- [rules-engine.md](./rules-engine.md) — how the engine reads them.
