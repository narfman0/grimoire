# Roadmap workstreams

Five workstreams, planned 2026-07-26. Each section is self-contained: goal,
current state, phased plan, parallelization notes, definition of done. They
map onto the AGENTS.md workstream boundaries (A = rules/content, B =
API/server, C = UI); a phase marked [A]/[B]/[C] can run concurrently with
phases in other lanes.

Sequencing constraints (everything else is parallel):

- WS3 phases 1–2 (position model + schema) before WS4 phase 2 (map → graph
  ingestion) — the zone-graph schema is the contract the LLM fills.
- WS2 phase 1 (realtime completeness) before WS3 phase 3 UI — positions ride
  the same poll snapshot.
- WS5 is deliberately last: it rewrites the character-state data model that
  WS2/WS3 read.

---

## WS1 — Full grimoire-packs parity, no placeholders

**Goal.** Every actionable row in `../grimoire-packs` (87 packs) is
mechanically wired: `derive()` produces the effects the source book
describes. No stub rows that render flavor text and do nothing.

**Current state** (from `node scripts/audit.mjs` in grimoire-packs,
2026-07-26):

- 7,220 rows audited across 5 kinds (subclass, feature, feat, species,
  background): **2,359 T3-FULL (33%) · 315 T2-PARTIAL (4%) · 4,391 T1-STUB
  (62%)** · 153 OUT-FLUFF · 2 OUT-ENGINE.
- The audit infrastructure is excellent and already automated:
  `scripts/audit.mjs` regenerates `docs/support-matrix.md` + per-kind TSV
  inventories; `debug-pack.py` validates a pack against the live API;
  `pnpm gaps` (grimoire) catches unresolved subclass-feature slugs.
- Spells, monsters, and items are **not in the audit** — parity can't be
  claimed until the audit covers all content kinds.
- Engine side: SRD support matrix is 194 Full / 69 Partial / 0 Missing / 11
  out-of-scope; `docs/engine-gaps.md` enumerates the deferred DSL targets
  that block OUT-ENGINE/T2 rows.
- Housekeeping found during planning: `grimoire-packs/debug-pack.py` and
  `push-to-prod.py` contain a **hardcoded prod username/password** — move to
  env vars before any agent fleet starts running these scripts routinely.

**Plan.**

1. **[A] Audit coverage first.** Extend `audit.mjs` to spells, monsters, and
   items (tier heuristics per kind: a monster with no statblock actions is a
   stub; a spell with no `damage`/`effect` structure is a stub unless
   OUT-FLUFF). Regenerate the matrix — this sets the real denominator.
2. **[A] Close the two open engine-free workstreams** from
   `docs/three-workstreams-plan.md`: verify OUT-FLUFF marking is complete
   (153 marked suggests W2 shipped — confirm classifier precision on a
   sample), and finish W3 (spell-pack expansion from the dnd-5e-srd dump,
   watching the SRD 5.1/OGL vs 5.2/CC-BY license labeling risk the plan
   flags).
3. **[A] Tier burn-down by pack priority.** Order: packs the live campaigns
   actually use (cross-reference `docs/dndbeyond/` party sheets), then
   `players-handbook-2024`, `monster-manual-2024`, `tashas`, `xanathars`,
   then long tail. Fan out one agent per pack (or per class within the big
   packs); each agent: pick T1/T2 rows from the TSV inventory → author
   `modifiers[]`/`activities[]`/`triggers[]` (mechanical values only — never
   book prose; AGENTS.md copyright rule) → validate with `debug-pack.py`
   against a dev server → add a fixture + C.8-style test in
   `grimoire/src/lib/rules/__tests__/fixtures/extras/` for anything
   non-obvious → re-run `audit.mjs` and commit the regenerated matrix with
   the content. The support matrix is the shared progress board; the audit
   script is the merge arbiter (regenerate after rebase, never hand-edit).
4. **[A] Engine-gap lane (serialized, one owner).** T2/OUT-ENGINE rows blocked
   on missing DSL targets (weapon mastery effects, forced movement, escalating
   DCs, …) get filed against `docs/engine-gaps.md`; a single engine agent
   implements targets in priority order (most-blocked-rows-first — the gaps
   doc format already supports this). Engine work serializes on `derive.ts`;
   content agents keep moving on unblocked rows meanwhile.
5. **[B] Prod push automation.** Replace hardcoded creds with env vars; add a
   `push-to-prod` dry-run mode that diffs against the live content table; run
   after each pack completes.

**Parallelization.** Near-perfectly parallel: per-pack file granularity means
content agents never conflict; the only serialization points are `audit.mjs`
output files (regenerate, don't merge) and the engine lane.

**Done when** `audit.mjs` (with all kinds covered) reports 0 T1-STUB and 0
T2-PARTIAL across all packs; remaining OUT-ENGINE rows are enumerated in
engine-gaps.md with an explicit decision (implement or reclassify OUT-FLUFF);
`pnpm gaps` and full test suite green; prod content table matches the repo.

---

## WS2 — Encounter builder: highly usable for DM and players

**Goal.** Running combat through grimoire is faster than pen and paper for
the DM, and players always know what's happening and what they can do.

**Current state.** Solid bones after the 2026-07-26 overhaul: shared
`EncounterPage`, 2s poll with ETag, reveals model, turn planner, action log
with server-side triggers, auras, death saves, dice roller, DM notes,
legendary/spell-slot trackers. Known gaps (several found by the new e2e
suite): reveal flags and the participant *list* are not realtime (SSR-only —
a player doesn't see a new monster or a reveal until navigation); the
service worker serves stale page documents; destructive actions use 14
`confirm()` dialogs; no encounter difficulty math; no clone/template flow;
adding N goblins is N manual adds.

**Plan.**

1. **[B] Realtime completeness.** Extend the `/state` poll snapshot (and its
   ETag token) to carry the role-redacted participant list + reveals + round
   status, not just HP/plans — the client reconciles list membership without
   `invalidateAll()`. Fix the service worker: network-first for documents and
   `__data.json`, stale-while-revalidate only for static assets. This unlocks
   "DM reveals a monster and every player sees it within 2s", the core demo
   moment. Add an e2e assertion for live reveal (the suite currently has to
   do a fresh SSR pass).
2. **[C] DM prep ergonomics.** Encounter clone ("run it again"); add-monster
   quantity (×N with auto-numbered names + shared statblock); saved encounter
   groups/templates (a "goblin ambush" bundle); drag-to-reorder initiative
   with auto-roll respected; XP budget / difficulty rating vs party level
   (data already available: party levels from linked characters, monster CR
   from statblocks); bulk reveal controls (reveal all vitals, hide all).
3. **[C] In-combat DM flow.** Replace `confirm()` with a small confirm-modal
   component (single implementation, keyboard accessible); round-scoped
   condition durations with expiry prompts at turn start ("poisoned ends for
   Goblin 2?"); concentration-check prompts already exist — add auto-DC
   calculation from damage; lair/legendary action reminders at initiative 20.
4. **[C] Player experience.** Turn planner v2: target picker bound to visible
   participants, action legality hints from `derive()` (already computed —
   surface "no action left", "out of uses"); "your turn" prominent state +
   optional browser notification; readable action-log feed with reveal
   redaction (log entries for hidden actors show as "Something happens…").
5. **[C] Table mode.** A read-only `/c/[code]/encounters/[id]/display` view
   for a shared screen: initiative order, HP buckets, round, big type. Reuses
   the player redaction path wholesale.

**Parallelization.** Phase 1 is lane B (one agent); phases 2–5 are lane C and
independent of each other once 1 lands. The e2e suite is the regression net —
extend it per phase.

**Done when** a DM can prep a themed encounter in under a minute (clone +
×N + difficulty readout), run a full combat without touching `confirm()`,
and two-browser e2e proves reveals/participant changes propagate live.

---

## WS3 — Positions, geography, and encounter maps

> **Superseded 2026-07-29 by [`docs/boards-design.md`](docs/boards-design.md).**
> The zone-graph-first design below pivoted to a painted tile board with a
> standalone map builder, fog-of-war riding the reveals model, and an NPC
> turn optimizer. The section is kept for the design rationale; the current
> design lives in the new doc.

**Goal.** Model *where* combatants are well enough that (a) the engine can
validate range/movement/AoE, (b) a planner can optimize NPC turns and
suggest player actions, and (c) WS4 can ingest real map images into the same
structures.

**Design decision: zone graph first, coordinates optional.** A full grid
simulator is a trap (huge UI + rules surface, fights the theater-of-mind
style the app supports today). Instead: a map is a **graph of zones** (nodes
with tags, edges with traversal cost), and each participant occupies a zone.
Optional per-zone pixel anchors + grid calibration tie the graph to an
uploaded image, and leave the door open to true grid positions later as a
zone refinement — not a rewrite. This is also the ideal LLM target: asking a
model for "zones and connections" from a map image is robust; asking for
pixel-perfect walls is not.

**Plan.**

1. **[A] Types + rules primitives (pure, in `src/lib/rules/`).**
   `ZoneGraph { zones: Zone[], edges: ZoneEdge[] }`; `Zone { id, name, tags
   (difficult, cover, elevation, hazard, water…), anchor?: {x,y}, gridRect? }`;
   `ZoneEdge { from, to, cost, blocked?, oneWay? }`. Pure functions:
   `zoneDistance` (Dijkstra over edge costs), `reachableZones(speed)`,
   `inRange(attacker, target, rangeFt)` via zone-distance × calibration,
   `aoeZones(origin, shape, size)` (coarse: zones within radius),
   `coverBetween(a, b)` from tags. Purity test already pins this lane.
2. **[B] Schema + API.** `encounter_maps` table (encounter_id, image file ref
   reusing the portrait storage pattern, gridCalibration {ftPerUnit},
   graphJson) + `participants.zoneId` column (nullable — everything works
   without a map, zone-less encounters behave exactly as today). Migration
   through the rehearsal pipeline. CRUD under
   `/api/encounters/[id]/map` (+ zone assignment on the existing participant
   PATCH), Zod schemas + `_openapi`, DM-only writes, reveals-aware reads
   (hidden participants' zones redacted; optionally fog: zones tagged
   unrevealed).
3. **[C] Map + zone UI on `EncounterPage`.** Upload image; draw zones as
   simple polygons/rects over it (or auto-generate a blank 3-zone "near/mid/
   far" graph when no image); drag participant tokens between zones; zone
   occupancy chips in the initiative list for theater-of-mind tables (no
   image required). Positions ride the `/state` poll (WS2 phase 1 extends the
   snapshot — add `zoneId` there).
4. **[A] Planner integration.** Extend `TurnPlan` with `moveTo: zoneId`;
   resolve flow validates movement (reachable?) and attack range
   (`inRange`?) as soft warnings, not hard blocks (DM fiat always wins).
   Then the suggester: pure `suggestTurn(graph, participants, actorId) →
   ranked actions` scoring targets by distance/HP/threat/cover and movement
   by reachability — deterministic and testable. Surface as a DM button
   ("suggest turn for Goblin 3") and as optional player hints. This function
   is also the grounding/validation layer for WS4's LLM suggestions: the LLM
   proposes, `suggestTurn`'s legality checks dispose.

**Parallelization.** Phase 1 (rules) and 2 (schema/API) can run in parallel
against the agreed types; phase 3 needs 2; phase 4 needs 1+2.

**Done when** a DM can upload a map, sketch 5 zones in under a minute, drag
tokens, get range warnings in the resolve flow, and a unit-tested suggester
proposes sane goblin turns on a fixture encounter.

---

## WS4 — LLM integration: map ingestion, statblock import, turn suggestions

**Goal.** Upload a battle-map image and get a ready-to-edit WS3 zone graph;
photograph a statblock and get a validated monster row; ask for an NPC turn
suggestion grounded in the real encounter state.

**Foundation (build once, in `src/lib/server/ai/`).**

- `@anthropic-ai/sdk` (TypeScript, server-side only — key never reaches the
  client). Model: `claude-opus-5` for all features (vision-capable,
  high-res image support — a full-res map is ≤ ~4,800 image tokens; pricing
  $5/$25 per MTok, so an ingest run is cents). Adaptive thinking on
  (default); `output_config.effort` per feature: `medium` for ingestion,
  `high` for suggestions.
- **Structured outputs are the contract:** `client.messages.parse()` with
  `zodOutputFormat(ZoneGraphSchema)` / `MonsterDataSchema` — the *same* Zod
  schemas the REST API validates with, so an LLM response that parses is by
  construction importable. No freehand JSON parsing.
- Prompt caching: static system prompts (zone-graph authoring guide,
  statblock field guide) behind a `cache_control` breakpoint.
- Ops: `ANTHROPIC_API_KEY` as a Fly secret; feature is dark when unset (API
  returns 501, UI hides entry points). Per-user rate limit (reuse
  `isRateLimited`, e.g. 10 ingestions/hour) + a usage log table
  (user, feature, input/output tokens, requestId) for cost visibility.
  Typed error handling per SDK exception classes; refusal stop_reason
  handled (surface "couldn't process this image" — never crash on empty
  content).
- Testing: vitest mocks the SDK layer (no network in CI); one env-gated live
  smoke script (`scripts/ai-smoke.mjs`) run manually.

**Plan.**

1. **[B] Foundation module + config plumbing** as above, plus
   `POST /api/ai/*` route scaffold (auth: campaign DM only, Zod everywhere,
   `_openapi` documented, 501-when-unconfigured tested).
2. **[B] Map → zone graph** (`POST /api/ai/ingest-map`, image upload reusing
   the portrait multipart path): vision request → `ZoneGraphSchema` → return
   as a *draft* the DM reviews in the WS3 zone editor before saving — the
   model proposes, the human commits. Include grid-calibration guess
   (squares detected → ftPerUnit) and zone tags (difficult/cover/hazard).
   Depends on WS3 phases 1–2.
3. **[B] Statblock ingestion** (`POST /api/ai/ingest-statblock`, image or
   pasted text → `MonsterDataSchema` → prefilled MonsterEditor). Copyright
   posture mirrors homebrew import: mechanical fields only (the schema has no
   prose field to fill — description deliberately dropped), user-supplied
   source, stays in the operator's DB, never in git. Extraction quality test:
   fixture images of homebrew statblocks with known-good JSON.
4. **[B]+[C] Turn suggestions** (`POST /api/ai/suggest-turn`): context =
   redacted encounter state + zone graph + actor statblock + WS3
   `suggestTurn` legal-move list; the model picks/narrates among *legal*
   options (structured output constrained to action ids + target ids +
   reachable zones — illegal suggestions are structurally impossible).
   Streamed narration optional. DM-only first; player hints behind a
   campaign setting.
5. **[C] UI affordances:** "✨ Import map" in the WS3 map editor, "✨ Scan
   statblock" in MonsterPicker, "✨ Suggest turn" on the DM row card — all
   hidden when AI is unconfigured.

**Parallelization.** Phase 1 and 3 need nothing from WS3 and can start
immediately; 2 and 4 wait on WS3's types/schema. All lane B/C — no conflict
with WS1's content lane.

**Done when** the three endpoints ship behind the feature flag with mocked
tests + live smoke, a real map photo round-trips to an editable zone graph,
and a suggested turn is always legal per the WS3 engine.

---

## WS5 — Decouple character state from characters (campaign-scoped resources) — LOW PRIORITY

**Goal.** Spell slots, HP, hit dice, conditions, and other *mutable state*
scope to a (character, campaign) pair instead of living on the character —
so one character can sit in two campaigns without HP bleeding across, and a
standalone sheet still works.

**Current state.** `CharacterDocument` mixes **build** (classes, species,
feats, scores, inventory, known spells — legitimately global) with **state**
(currentHp, tempHp, hitDiceSpent, resourcesSpent, conditions, spell-slot
spend via resourcesSpent, action economy, concentration, prepared spells —
arguably per-campaign). `campaign_characters` already models the M:N link,
so the join point exists; today the last campaign to touch the sheet wins.

**Plan.**

1. **[A] Carve the state type.** Define `CharacterState` (the mutable subset)
   vs `CharacterBuild` in `src/lib/rules/types.ts`; `derive()` takes a merged
   view so the engine is untouched. Decide the prepared-spells question
   explicitly (recommend: per-campaign — you prepare differently for
   different tables; known spells stay global).
2. **[B] Schema.** New table `character_campaign_state (character_id,
   campaign_id NULLABLE, state_json, updated_at)` — the NULL row is the
   standalone/default state; unique on the pair. Migration (branch + PR +
   staging rehearsal per AGENTS.md) backfills each character's current state
   fields into the NULL row *and* a row per linked campaign, then strips
   state keys from `document` (kept readable for rollback for one release).
3. **[B] API.** `PATCH /api/characters/[id]` splits: build patches as today;
   state patches route to `/api/characters/[id]/state?campaign=CODE` with the
   same `baseUpdatedAt` optimistic-concurrency scheme (per-row updatedAt).
   Zod strips state keys from build documents so old clients can't reintroduce
   drift. Encounter loaders, `/state` poll, and triggers read the
   campaign-scoped row.
4. **[C] Sheet plumbing.** `CharacterSheetPage` receives (build, state,
   campaignContext); `patchDocument` splits writes by field classification —
   one mapping table, mechanical change since the de-fork means it lands
   once. Campaign switcher on the standalone sheet URL ("viewing as: Kribwynn
   / standalone").
5. **Explicit non-goals for v1:** long-rest sync across campaigns, shared
   inventory splitting, XP/level divergence per campaign (build stays global).

**Why last:** every phase touches surfaces WS2/WS3 are actively changing
(poll snapshot, sheet mutations, encounter loaders), and the migration is
the riskiest since 0007 — it needs the staging rehearsal pipeline and a
quiet window, not a parallel fleet.

**Done when** two campaigns can run the same character with independent
HP/slots/conditions, the standalone sheet still works, migration rehearsed on
a prod copy with row-count + spot-value assertions, and the two-browser e2e
gains a cross-campaign isolation test.
