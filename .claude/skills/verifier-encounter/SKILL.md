---
name: verifier-encounter
description: >
  Drive the encounter REST surface end-to-end against the running dev server.
  Use during /verify of any change touching the encounter API
  (`/api/encounters/[id]/**`), the encounter page (`/c/[code]/encounters/[id]`),
  or anything downstream of the action log, participants, conditions, HP, or
  plan. Seeds a fresh DM user + campaign + encounter + monster participant,
  prints the IDs the agent needs, and exposes a clean step that purges every
  row it created.
---

# verifier-encounter

A scripted way to exercise the encounter surfaces of the grimoire dev server
without a browser. Mirrors the protocol the /verify skill expects — drive
the running app, capture evidence, clean up after.

## When to use

The /verify skill says: drive the surface, don't import-and-call. For
changes to:

- `src/routes/api/encounters/**/+server.ts`
- `src/routes/c/[code]/encounters/[id]/+page.svelte`
- `src/lib/realtime/resolve.ts`, `encounter-channel.ts`
- the action log
- any participant HP / condition / concentration / plan mutation

…this skill bootstraps the cheapest path: signup → campaign → encounter →
participant → log entry, all real, all via fetch against `localhost:5173`.

## Prerequisites

- `pnpm dev` (or `npm run dev`) running on port 5173 — check first with
  `curl -sI http://localhost:5173/` and start it via Bash with
  `run_in_background: true` if it isn't up.
- `node` available (used for JSON parsing in the scripts).

## Quick usage

```bash
# Seed a fresh DM session + everything you need. Prints ID env-exports.
bash .claude/skills/verifier-encounter/scripts/seed.sh

# Source the exports so subsequent curls have them:
source <(bash .claude/skills/verifier-encounter/scripts/seed.sh)

# Or capture to a file and source:
bash .claude/skills/verifier-encounter/scripts/seed.sh > /tmp/verify-env
source /tmp/verify-env

# After verifying, clean every verify_* user and the rows they own:
bash .claude/skills/verifier-encounter/scripts/clean.sh
```

## What seed.sh exports

```
COOKIE_JAR=/tmp/verifier-encounter-<pid>.txt
DM_USERNAME=verify_<random>
DM_PASSWORD=verify-pass-123
CAMPAIGN_ID=<uuid>
CAMPAIGN_CODE=<6-char>
ENCOUNTER_ID=<uuid>
MONSTER_ID=<uuid>  # NPC participant named "Goblin"
```

You then drive the API like:

```bash
# POST a log entry
curl -sX POST "http://localhost:5173/api/encounters/$ENCOUNTER_ID/log" \
  -H 'Content-Type: application/json' -b "$COOKIE_JAR" \
  -d "{\"participantId\":\"$MONSTER_ID\",\"actionId\":\"slash\",\"actionLabel\":\"Slash\",\"round\":1,\"damageRoll\":5,\"hit\":\"hit\"}"

# PATCH it (the amend flow)
curl -sX PATCH "http://localhost:5173/api/encounters/$ENCOUNTER_ID/log/<LOG_ID>" \
  -H 'Content-Type: application/json' -b "$COOKIE_JAR" \
  -d '{"actionLabel":"Slash (corrected)","damageRoll":9,"hit":"crit"}'

# DELETE it
curl -sX DELETE "http://localhost:5173/api/encounters/$ENCOUNTER_ID/log/<LOG_ID>" \
  -b "$COOKIE_JAR"
```

For role-gated probes, run `seed.sh --with-player` and you also get
`PLAYER_USERNAME=verify_player_<random>` + `PLAYER_COOKIE_JAR=...` (a second
authenticated session, member of the same campaign with role=player).

## Cleanup

`scripts/clean.sh` deletes every user whose `username` starts with `verify_`,
the campaigns they DM, all encounters under those campaigns, and all their
participants + action_log + sessions. Leaves anything else untouched (no
`DELETE FROM users` without the WHERE). Per the project's smoke-test
convention — prefix and target, never nuke.

Run it after every verification session, in your final cleanup step before
reporting the verdict. The scripts are idempotent: cleanup with nothing to
clean is a no-op.

## What NOT to verify with this

This skill drives the HTTP surface. If the change is *purely visual* — a
template tweak, CSS, copy — you still need the browser. There is no
browser-automation tool in this repo (Playwright was rejected as too slow).
In that case, report SKIP or note that the visual aspect was unverified.
