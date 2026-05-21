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
- **Realtime sync** uses an in-process SSE pub/sub hub (`src/lib/server/realtime/hub.ts`). REST handlers call `publish()` after mutations; clients subscribe via `/api/*/stream` endpoints. No separate process or port — one `node build/` runs everything.
- **Don't** delete the sqlite file in CI or scripts without a guard.
- **Don't** auto-summarize what just got committed in chat replies — the diff and commit message are the record.
- **Don't** hand-write request validation in `+server.ts` handlers — use the Zod schemas in `src/lib/server/api/schemas.ts` via `parseJson` / `parseParams` / `parseSearch`. Those same schemas back the OpenAPI spec; bypassing them breaks the docs.
- **Don't** add a route without also registering its path in `src/lib/server/api/spec.ts`. The spec is the public contract.
- **Don't** add a new field on `CharacterDocument` without also adding it to the `CharacterDocument` Zod schema in `schemas.ts`. Zod silently strips unknown keys on PATCH.
- **Don't** filter characters by `characters.campaignId = ?`. Characters belong to campaigns via the `campaign_characters` join table — `INNER JOIN` through it. The `characters.campaignId` column is a soft pointer only.
- **Don't** reproduce content from copyrighted sources (WotC books, 5etools, wikis) into pack files or commits. SRD 5.2 content (CC-BY 4.0) lives in `content-packs/srd-5.2/`; everything else belongs in the operator-supplied `$GRIMOIRE_PACKS_DIR` and is the user's responsibility to populate from their own legal copies. The engine is content-agnostic — homebrew packs with the same JSON shape work identically.
- **Don't** display pack `description` / flavor prose in UI you author. The monster statblock view, spell hover popup, and item hover popup deliberately render mechanical fields only (numbers, slugs, names) — the DM consults their own reference for full text.
- **Don't** shadow the DOM `document` global with a local variable named `document` (the page-local `CharacterDocument`) and then call `document.getElementById(...)`. TypeScript will catch it; if you need the DOM ref, use `globalThis.document.getElementById(...)`.
- **Don't** use `console.log/warn/error` in server-side code — import the Pino singleton from `$lib/server/logger` instead. Structured fields go in the first argument object (`logger.error({ err, userId }, 'message')`); raw string interpolation loses structure.
- **Don't** let database errors surface as raw 500s in routes where a constraint violation is plausible (unique slug, duplicate user, FK violation). Import `handleDbError` from `$lib/server/db/errors` and `.catch((err) => handleDbError(err, 'context'))` the insert/update call.
- **Client-side fetch errors** in the encounter channel are automatically shown to the user via the `toasts` store — the `send()` utility in `encounter-channel.ts` handles it. For other client-side fetch calls that need user feedback, import `toasts` from `$lib/client/errors` and call `toasts.add({ type: 'error', message: '...' })`.

