# AGENTS.md

Operating guide for AI agents (and humans) contributing to grimoire.

## Workflow: commit and push frequently

This project favors **many small commits pushed straight to `master`** over long-lived branches. There is no separate dev branch and no PR ceremony for solo work.

- Commit after each logical change. If you can describe what changed in one sentence, that's a commit.
- Push every commit. Don't accumulate local commits.
- Pull before you start a session (`git pull --ff-only`) in case another agent or device pushed.
- Branches + PRs are reserved for risky changes (schema migrations that need review, infra spikes). Use them when in doubt; default is straight to `master`.

## Commit message format

[Conventional Commits](https://www.conventionalcommits.org/) prefixes, lowercase, no scope unless it clarifies:

```
feat: add character sheet skeleton
fix: handle empty campaign code in join form
chore: bump drizzle-orm
docs: clarify hocuspocus port
refactor: extract code generator
```

Subject ≤ 72 chars, imperative mood. Body only if the *why* isn't in the diff.

Do **not** include Claude / agent attribution trailers in commits for this repo.

## Verification before pushing

Run before each push:

```bash
pnpm check                  # svelte-check (no TS / Svelte errors)
pnpm build                  # SvelteKit must build clean
pnpm test                   # vitest — rules engine + items fixtures
```

If you touched the schema:

```bash
pnpm db:generate            # produces a new drizzle/NNNN_*.sql
pnpm migrate                # apply locally and sanity-check
```

Commit the generated migration in the same commit as the schema change.
If the new columns need defaults for existing rows (NOT NULL adds, etc.),
hand-edit the generated SQL to add `DEFAULT (unixepoch() * 1000)` or
similar — drizzle-kit doesn't infer those.

Run `pnpm gaps` after touching pack content; it reports subclass-feature
slugs that don't resolve to feature rows (transcription gaps).

## Boundaries

- **Don't** add Postgres-specific column types — Drizzle schema stays portable so the eventual cloud-DB migration is mechanical.
- **Live updates** push from `src/lib/server/realtime/hub.ts` over SSE (`/api/encounters/<id>/stream`, `/api/characters/<id>/stream`). Mutations all go through REST handlers; the hub fans out one event per write. No CRDT, no Y.Doc, no separate sync process — keep it that way unless you have a real concurrent-edit use case.
- **Don't** delete the sqlite file in CI or scripts without a guard.
- **Don't** auto-summarize what just got committed in chat replies — the diff and commit message are the record.
- **Don't** hand-write request validation in `+server.ts` handlers — use the Zod schemas in `src/lib/server/api/schemas.ts` via `parseJson` / `parseParams` / `parseSearch`. Those same schemas back the OpenAPI spec; bypassing them breaks the docs.
- **Don't** add a route without also registering its path in `src/lib/server/api/spec.ts`. The spec is the public contract.
- **Don't** add a new field on `CharacterDocument` without also adding it to the `CharacterDocument` Zod schema in `schemas.ts`. Zod silently strips unknown keys on PATCH — `feat: persist action-economy + concentration + favorites through PATCH` (`c93b943`) fixed exactly that class of bug.
- **Don't** filter characters by `characters.campaignId = ?`. Since M3.6 the M:N truth lives in `campaign_characters` — `INNER JOIN` through it. The `campaignId` column is a soft home pointer only; reads must not rely on it for membership.
- **Don't** reproduce content from copyrighted sources (WotC books, 5etools, wikis) into pack files or commits. SRD 5.2 content (CC-BY 4.0) lives in `content-packs/srd-5.2/`; everything else belongs in the operator-supplied `$GRIMOIRE_PACKS_DIR` and is the user's responsibility to populate from their own legal copies. The engine is content-agnostic — homebrew packs with the same JSON shape work identically.
- **Don't** display pack `description` / flavor prose in UI you author. The monster statblock view, spell hover popup, and item hover popup deliberately render mechanical fields only (numbers, slugs, names) — the DM consults their own reference for full text.
- **Don't** shadow the DOM `document` global with a local variable named `document` (the page-local `CharacterDocument`) and then call `document.getElementById(...)`. TypeScript will catch it; if you need the DOM ref, use `globalThis.document.getElementById(...)`.

## Milestones at a glance

| Milestone | Scope                                                                                  |
| --------- | -------------------------------------------------------------------------------------- |
| M0 ✅      | Scaffold (SvelteKit + Drizzle + Docker)                                                |
| M1 ✅      | Characters CRUD + per-campaign list page + OpenAPI 3.1 spec at `/api`                  |
| M1.5 ✅    | Pack loader, `/api/content`, SRD 5.2 tier 1, rules engine v0, vitest fixtures           |
| M1.6 ✅    | SRD 5.2 tier 2 — species/class/feat/spell fill-out                                     |
| M2 ✅      | Editable sheet + REST + SSE HP/condition/toggle sync                                   |
| M3 ✅      | Encounter builder, monster picker, live turn sync, planner, resolve + amend, action log |
| M3.5 ✅    | Multi-target save, reaction + concentration, slots/resources, action-economy, monster derive, feat picker, hover popups |
| M3.6 ✅    | Character ↔ campaign decoupling (M:N join table, /characters library, link/unlink)    |
| M3.7 ✅    | Structured homebrew editors for all 11 content kinds; merged spell panel; encounter action-economy foldout with spell casting; pack `author` field + content upserted as `unlisted` (marketplace foundation) |
| M4        | Shared notes / NPC tracker polish, dice roller broadcast, presence, undo, exporters     |
