# AGENTS.md

Operating guide for AI agents (and humans) contributing to grimoire.

## Workflow: commit and push frequently

This project favors **many small commits pushed straight to `master`** over long-lived branches. There is no separate dev branch and no PR ceremony for solo work.

- Commit after each logical change. If you can describe what changed in one sentence, that's a commit.
- Push every commit. Don't accumulate local commits.
- Pull before you start a session (`git pull --ff-only`) in case another agent or device pushed.
- Branches + PRs are reserved for risky changes (schema migrations that need review, infra spikes). Use them when in doubt; default is straight to `master`.

## Parallel workstreams

The codebase is partitioned so 2–4 agents can work concurrently without
colliding. The stable split:

- **A — Rules engine + content**: `src/lib/rules/**` (pure, isomorphic — a
  purity test pins the no-non-relative-imports invariant) and
  `content-packs/**` (per-class/species files). No schema or route deps.
- **B — API/server**: `src/routes/api/**` + `src/lib/server/**`. Contract-first
  via the Zod schemas + `_openapi` exports.
- **C — UI**: `src/lib/components/**` + page routes. The big pages are single
  shared components (`CharacterSheetPage`, `EncounterPage`, `CampaignPage`)
  with thin route wrappers per URL scheme — **never re-fork them**; add
  behavior behind data-driven conditionals.

Hard serialization points (one owner at a time, coordinate before touching):
- **Schema/migrations** (`src/lib/server/db/schema.ts` + `drizzle/`): the
  journal makes concurrent `db:generate` runs collide. Migrations are also
  the one thing that must not go straight to master unrehearsed (see the
  boundary below).
- `src/lib/server/api/schemas.ts` and `derive.ts` have high fan-in — fine to
  edit, but only one workstream at a time.
- `src/lib/realtime/**` belongs to whichever stream is touching sync.

Verification stack agents are expected to keep green: `pnpm check` (includes
migration integrity + populated-data migration rehearsal), `pnpm test`
(vitest, per-worker in-memory DBs), `pnpm build`, and `pnpm test:e2e`
(Playwright two-client smoke — runs in CI as a non-blocking job).

## Commit message format

[Conventional Commits](https://www.conventionalcommits.org/) prefixes, lowercase, no scope unless it clarifies:

```
feat: add character sheet skeleton
fix: handle empty campaign code in join form
chore: bump drizzle-orm
docs: clarify encounter poll interval
refactor: extract code generator
```

Subject ≤ 72 chars, imperative mood. Body only if the *why* isn't in the diff.

Do **not** include Claude / agent attribution trailers in commits for this repo.

## Regression tests for bug fixes

Every `fix:` commit that touches rules engine logic, `derive()`, content pack data, or server-side handlers **must include a regression test** that would have caught the bug. No exceptions for "obvious" one-liners.

What counts:
- A new `it(...)` in the appropriate `src/lib/rules/__tests__/` test file that fails before the fix and passes after.
- For new trigger events added to `KNOWN_TRIGGER_EVENTS`: a fixture feat in `fixtures/extras/` using that event + a C.8-style test asserting no `unknown-trigger-event` warning fires.
- For derive() numeric fixes (AC, damage, spell slots, ASI): a character fixture that asserts the correct output value.

What's exempt:
- Pure UI/Svelte component fixes (layout, CSS, click handlers) — no rules engine surface.
- Type-only fixes (`as`, return-type annotations, non-null assertions) where the bug was TS inference, not runtime logic.
- Schema migration fixes (no engine logic changed).

If you're unsure whether a test is needed, write one. A test that never fails is cheap; a regression that ships to prod is not.

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
- **Realtime sync** is short-polling, not push. Clients poll `GET /api/encounters/[id]/state` and `GET /api/characters/[id]` every 2s via `src/lib/realtime/encounter-channel.ts` / `character-channel.ts`. There is no SSE hub, no `publish()`, and no `/api/*/stream` endpoints — that architecture was removed (`1abf266`, `7d1dbe3`). The encounter poll snapshot carries round, encounter status, HP, plans, and the role-redacted participant list (membership, order, names, reveal flags — see `src/lib/realtime/participants.ts`); heavy per-participant data (statblocks, derived PC stats) stays on SSR page data, and `EncounterPage` re-runs the load functions when the poll surfaces a row it has no heavy data for. Mutating a resource is enough; the next poll picks it up. No separate process or port — one `node build/` runs everything.
- **Don't** delete the sqlite file in CI or scripts without a guard.
- **Schema migrations never go straight to `master`.** Pushing `master` auto-deploys to Fly, and migrations run at boot against the only prod database. Migrations take a branch + PR, and must be rehearsed against a copy of prod data first (pull via `fly ssh`, run `DATABASE_URL=copy.db pnpm migrate`, compare row counts). Don't put `PRAGMA foreign_keys` inside migration SQL — drizzle wraps migrations in a transaction where that pragma is a no-op; `scripts/migrate.mjs` manages FKs outside the transaction and runs `foreign_key_check` after (see the 2026-07-26 failed 0007 deploy).
- **Don't** auto-summarize what just got committed in chat replies — the diff and commit message are the record.
- **Don't** hand-write request validation in `+server.ts` handlers — use the Zod schemas in `src/lib/server/api/schemas.ts` via `parseJson` / `parseParams` / `parseSearch`. Those same schemas back the OpenAPI spec; bypassing them breaks the docs.
- **Don't** add a route without also exporting an `_openapi` const from its `+server.ts` file. The spec is auto-generated by `GET /api/openapi.json` via `import.meta.glob` — each route participates by exporting `export const _openapi: RouteOpenApi = { METHOD: { summary, body?, response? } }` (import `RouteOpenApi` from `$lib/server/api/openapi`). The underscore prefix is required — SvelteKit rejects unknown non-prefixed exports from `+server.ts` (`ef532ea`). The spec is the public contract.
- **Don't** add a new field on `CharacterDocument` without also adding it to the `CharacterDocument` Zod schema in `schemas.ts`. Zod silently strips unknown keys on PATCH.
- **Don't** filter characters by `characters.campaignId = ?`. Characters belong to campaigns via the `campaign_characters` join table — `INNER JOIN` through it. The `characters.campaignId` column is a soft pointer only.
- **Don't** reproduce content from copyrighted sources (WotC books, 5etools, wikis) into pack files or commits. SRD 5.2 content (CC-BY 4.0) lives in `content-packs/srd-5.2/`; everything else is uploaded per-user via `POST /api/homebrew/import` (see `docs/content-distribution.md`) and stays in the operator's database, never in git history. The engine is content-agnostic — imported homebrew with the same JSON shape works identically.
- **Don't** display pack `description` / flavor prose in UI you author. The monster statblock view, spell hover popup, and item hover popup deliberately render mechanical fields only (numbers, slugs, names) — the DM consults their own reference for full text.
- **Don't** shadow the DOM `document` global with a local variable named `document` (the page-local `CharacterDocument`) and then call `document.getElementById(...)`. TypeScript will catch it; if you need the DOM ref, use `globalThis.document.getElementById(...)`.
- **Don't** use `console.log/warn/error` in server-side code — import the Pino singleton from `$lib/server/logger` instead. Structured fields go in the first argument object (`logger.error({ err, userId }, 'message')`); raw string interpolation loses structure.
- **Don't** let database errors surface as raw 500s in routes where a constraint violation is plausible (unique slug, duplicate user, FK violation). Import `handleDbError` from `$lib/server/db/errors` and `.catch((err) => handleDbError(err, 'context'))` the insert/update call.
- **Client-side fetch calls** go through the `api` helper in `$lib/client/api.ts` (`api.get/post/patch/del`) — it parses `ApiError` (message + requestId + status), shows a toast, and rethrows; call sites catch only to roll back optimistic state, never to re-toast. Don't hand-roll `fetch` in `.svelte` files. The encounter channel keeps its internal `send()` (same semantics).
- **Character document writes** use optimistic concurrency: PATCH `/api/characters/[id]` with `baseUpdatedAt`; stale tokens 409 with the current character for rebase. Any new sheet mutation goes through `patchDocument` in `CharacterSheetPage.svelte` — don't add parallel write paths.

