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
pnpm build                  # SvelteKit must build clean
pnpm --filter @grimoire/sync-server build   # if you touched sync-server
```

If you touched the schema:

```bash
pnpm db:generate            # produces a new drizzle/NNNN_*.sql
pnpm migrate                # apply locally and sanity-check
```

Commit the generated migration in the same commit as the schema change.

Tests will arrive with M1. Until then, "builds + boots" is the bar.

## Boundaries

- **Don't** add Postgres-specific column types — Drizzle schema stays portable so the eventual cloud-DB migration is mechanical.
- **Don't** put long-lived websocket logic in SvelteKit server routes — that's what `sync-server/` (Hocuspocus) is for. Vercel serverless can't host it.
- **Don't** delete the sqlite file in CI or scripts without a guard.
- **Don't** auto-summarize what just got committed in chat replies — the diff and commit message are the record.
- **Don't** hand-write request validation in `+server.ts` handlers — use the Zod schemas in `src/lib/server/api/schemas.ts` via `parseJson` / `parseParams` / `parseSearch`. Those same schemas back the OpenAPI spec; bypassing them breaks the docs.
- **Don't** add a route without also registering its path in `src/lib/server/api/spec.ts`. The spec is the public contract.

## Milestones at a glance

| Milestone | Scope                                                               |
| --------- | ------------------------------------------------------------------- |
| M0 ✅      | Scaffold (SvelteKit + Drizzle + Hocuspocus stub + Docker)           |
| M1 ✅     | Characters CRUD + per-campaign list page + OpenAPI 3.1 spec at `/api` |
| M1.5 ✅   | Pack loader, `/api/content`, SRD 5.2 tier 1, rules engine v0, vitest |
| M1.6      | SRD 5.2 tier 2 — fill out species/classes/feats/spells in parallel PRs |
| M2        | Sheet UI + real-time edits via Y.js / Hocuspocus                    |
| M3        | D&D Beyond paste-based importer + turn/encounter planner            |
| M4        | Shared notes, NPCs, dice roller broadcast                           |
| M5        | Polish (presence, undo, export)                                     |
