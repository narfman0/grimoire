# WS2 schema follow-ups — proposal

Status: **proposal only**. No migration has been generated, and none should be
until this is reviewed. Per AGENTS.md, schema migrations take a branch + PR and
a rehearsal against a copy of prod data, because pushing `master` auto-deploys
to Fly and `scripts/migrate.mjs` runs at boot against the only prod database
(see the failed 0007 deploy, 2026-07-26).

Three deferred items came out of WS2:

1. `participants.combat_state_json` — give non-PC ephemeral combat state its own
   column instead of riding `plan_json`.
2. Encounter templates — a reusable roster instantiable into any campaign.
3. An encounter-level "this fight has a lair" flag.

**Recommendation up front:**

| # | Item | Needs a migration? | Verdict | Order |
|---|------|--------------------|---------|-------|
| 2 | Encounter templates | **No** | Ship the migration-free clone-into-target-campaign. Do **not** build `encounter_templates`. | 1st |
| 1 | `participants.combat_state_json` | **Yes** | Justified. One nullable column, no backfill, read-side fallback for one release. | 2nd |
| 3 | Encounter-level lair flag | **No** | **Don't do this one.** The premise is wrong and the real defect is fixed by #1. | — |

---

## Verified current state (read-only)

### `participants` (`src/lib/server/db/schema.ts:306-348`)

Created in `0000_squashed.sql:165`. **Never rebuilt since** — 0007's table-rebuild
sweep skipped it (it has no `NOT NULL` timestamp column), and no migration has
`ALTER TABLE participants`. So its physical column order still matches
`schema.ts` exactly, which matters below.

| column | type | null | default |
|---|---|---|---|
| `id` | text PK | no | — |
| `encounter_id` | text | no | — (FK → `encounters.id` ON DELETE cascade) |
| `character_id` | text | yes | — (FK → `characters.id` ON DELETE set null) |
| `name` | text | no | — |
| `kind` | text | no | — (`pc` \| `npc` \| `monster`) |
| `statblock_slug` | text | yes | — |
| `statblock_json` | text (JSON) | yes | — |
| `initiative` | integer | yes | — |
| `current_hp` | integer | yes | — |
| `max_hp` | integer | yes | — |
| `temp_hp` | integer | no | `0` |
| `conditions_json` | text (JSON) | no | `'[]'` |
| `plan_json` | text (JSON) | yes | — |
| `concentrating_json` | text (JSON) | yes | — |
| `reveals_json` | text (JSON) | no | `'{}'` |
| `sort_order` | integer | no | `0` |

Index: `participants_encounter` on `(encounter_id)` (added in 0008).

### `encounters` (`src/lib/server/db/schema.ts:292-304`)

Rebuilt in 0007 (for the `created_at` default), so the drizzle snapshot is current.

| column | type | null | default |
|---|---|---|---|
| `id` | text PK | no | — |
| `campaign_id` | text | no | — (FK → `campaigns.id` ON DELETE cascade) |
| `name` | text | no | — |
| `status` | text | no | — (`staging` \| `live` \| `ended`) |
| `round` | integer | no | `0` |
| `active_participant_id` | text | yes | — (no FK) |
| `notes_json` | text | yes | — |
| `created_at` | integer (ms) | no | `(unixepoch('now') * 1000)` |
| `ended_at` | integer (ms) | yes | — |

No index beyond the PK. **There is no JSON blob on this table.** `notes_json` is
misnamed: it is DM prose, validated as `z.string().max(4000)`
(`encounter-schemas.ts` `UpdateEncounterRequest`) and rendered in a textarea.
It is not a JSON document and cannot carry a flag without changing its type,
which is a migration in everything but name.

Also noted: `serializeEncounter` (`src/lib/server/serializers.ts:34`) and the
`Encounter` Zod schema both omit `notes_json` entirely — the clone route reads
and copies it, but the REST API never returns it. Notes reach the UI via page
data only.

### Migrations

Nine migrations, `0000_squashed` … `0008_nappy_arachne` (indexes only). `pnpm check`
is green on `master` as of this writing:

```
check-drizzle: 9 migrations OK
rehearse-migrations: 0008_nappy_arachne OK against populated DB
svelte-check: 0 errors 0 warnings
```

`pnpm check` = `check-drizzle.mjs && rehearse-migrations.mjs && svelte-kit sync && svelte-check`.

**`scripts/check-drizzle.mjs` enforces**, per journal entry:
1. `drizzle/{tag}.sql` exists;
2. `drizzle/meta/{padded_idx}_snapshot.json` exists (the 4d6c997 bug: SQL + journal
   committed, snapshot forgotten);
3. `when` is numeric and **strictly increasing** — drizzle skips any entry whose
   `folderMillis` is ≤ the newest `created_at` in the target DB's
   `__drizzle_migrations`, so a hand-pasted timestamp silently never applies in prod;
4. when `$DATABASE_URL` exists on disk, every applied `created_at` matches some
   journal `when` (catches a renumbered journal against a live DB).

Consequence for us: **generate with `pnpm db:generate`, never hand-roll the journal
entry.** A rebased/cherry-picked migration branch must have its `when` re-checked
against `master`'s newest entry (`1785075771100`) before merge.

**`scripts/rehearse-migrations.mjs` enforces**: copies `drizzle/` minus the newest
journal entry, migrates a scratch DB to that state, seeds
`scripts/rehearsal-fixture.sql`, then runs the *real* `scripts/migrate.mjs`
(snapshot → FK-off → migrate → `foreign_key_check`) and asserts **no table lost
rows**. This is an automated mini-rehearsal that runs on every `pnpm check`; it is
not a substitute for the prod-data rehearsal, because the fixture is 8 rows.

`scripts/rehearsal-fixture.sql` inserts `participants` with an explicit column
list (`id, encounter_id, name, kind, initiative, temp_hp, conditions_json,
reveals_json, sort_order`) — so **adding a nullable column does not break the
fixture**. It would break if we added a `NOT NULL` column without a default.

---

## Item 1 — `participants.combat_state_json`

### Does it need a migration? Yes.

`plan_json` currently carries four unrelated concerns (the `TurnPlan` interface in
`src/lib/realtime/encounter-channel.ts`):

- the player's declared **intent** (action, targets, notes) — per-turn;
- `combat` — action economy + legendary counter, round-keyed
  (`src/lib/realtime/economy.ts`);
- `conditionTimers` — round-scoped condition durations, encounter-scoped
  (`src/lib/encounter/condition-timers.ts`);
- `lair` — a DM prep marker, encounter-scoped (`src/lib/encounter/lair.ts`).

A fifth is inbound: NPC spell slots. Today the `npcSpellSlots` map in
`EncounterPage.svelte` is **client-only in-memory state** — it does not
survive a reload. The concurrent workstream is persisting it, and `plan_json` is
the obvious landing spot.

"It works" is true, but the coupling is not merely aesthetic. Two concrete defects
exist right now:

**(a) The public API contract lies.** `DELETE /api/encounters/[id]/participants/[pid]/plan`
is documented as "Clear the turn plan for a participant" and does
`.set({ planJson: null })` (`plan/+server.ts:58-61`). It destroys the combat
economy, the condition timers and the lair marker along with the plan. The
preservation logic (`planExtras` / `hasPlanExtras` / `planWithExtras` /
rewrite-as-empty-plan, all in `encounter-channel.ts`) lives **only in the browser
client**. Any second
client, any curl against the OpenAPI-documented endpoint, or any future
server-side "reset plans at end of round" job gets the destructive behaviour.
A column cannot be wiped by a route that has no business touching it.

**(b) One bad field takes down four.** The state poll does
`PlanJson.safeParse(JSON.parse(p.planJson))` (`state/+server.ts:276-289`) and on
failure drops the whole blob. A plan whose `notes` exceeds `max(500)` — reachable
if the cap is ever lowered, or via a legacy row — silently zeroes that
participant's economy, timers and lair marker for every poller.

**(c) Clone loses prep.** `clone/+server.ts:126` sets `planJson: null`, which is
correct for intent and correct for the economy, and *wrong* for `lair`: "this
fight has a lair" is prep the DM built, exactly like the roster and the notes the
clone does carry.

A fifth concern arriving makes `PlanExtras` a four-member union that every future
contributor must remember to extend in three places (`PlanExtras`, `planExtras()`,
`PlanJson` Zod). That is the shape of a bug factory.

### Proposed DDL

```sql
ALTER TABLE `participants` ADD `combat_state_json` text;
```

- **Nullable, no default.** Matches `plan_json` / `concentrating_json`. A NULL
  reads as "nothing spent" through the existing `normalizeEconomy(undefined)` /
  `normalizeTimers(undefined)` fallbacks, which already return empty state for
  garbage input.
- **No backfill of existing rows.** See below.
- This is SQLite's cheapest DDL: `ALTER TABLE … ADD COLUMN` is a metadata-only
  operation (no table rewrite), it appends at the end of the physical column
  order, and it touches no foreign key. Because `participants` was never rebuilt,
  drizzle-kit should emit exactly the statement above. **If `pnpm db:generate`
  emits a `participants_new` table rebuild instead, stop and investigate** — a
  rebuild of this table fires implicit DELETEs against `action_log`'s
  `participant_id` / `target_participant_id` FKs (`ON DELETE set null`), which is
  the 0007 failure mode.

Corresponding schema change:

```ts
  /** Encounter-scoped, non-PC combat state: action economy + legendary uses,
   *  round-scoped condition timers, NPC spell slots, and the DM's lair
   *  marker. Distinct from `plan_json`, which is the player's per-turn
   *  declared intent and is cleared every turn. PCs keep the equivalent
   *  state on their character document. */
  combatStateJson: text('combat_state_json'),
```

### What lives in it

```ts
interface CombatStateJson {
  combat?: Partial<CombatEconomy>;      // round-keyed; from plan_json.combat
  conditionTimers?: ConditionTimer[];   // from plan_json.conditionTimers
  spellSlots?: Record<number, { max: number; used: number }>; // new; currently client-only
  lair?: boolean;                       // from plan_json.lair
}
```

`plan_json` reverts to intent only: `actionId`, `actionLabel`, bonus variants,
targets, `notes`, `updatedAt`.

### Data-migration plan: let it lapse, with a one-release read fallback

**Do not write a SQL backfill.** It is expressible — SQLite's json1 extension is
compiled into `better-sqlite3`, so `UPDATE participants SET combat_state_json =
json_object('combat', json_extract(plan_json,'$.combat'), …) WHERE plan_json IS
NOT NULL` would work — but it is a hand-edited data migration running inside
drizzle's transaction against the only prod database, which is precisely the
class of change that produced the 0007 incident. The value it buys is close to
zero:

- **Combat economy is per-round.** `legendaryUsedForRound()`
  (`economy.ts:92-98`) already treats a counter written in an earlier round as
  zero, and `resetTurnEconomy()` clears the action/bonus/reaction/movement flags
  on every turn rise. Anything stale is discarded by design within one round.
- **Condition timers are DM-confirmed, not automatic** (`condition-timers.ts`
  header). Losing a timer degrades to "the DM is not prompted about an expiry",
  which is the behaviour the entire feature was added *on top of* three commits
  ago. The flat `conditions` list — the source of truth the rules engine reads —
  is on a different column and is unaffected.
- **The lair marker is one checkbox.**
- Only encounters that are *live at the instant of deploy* are affected at all.
  Encounters in `staging` have no economy, and `ended` ones are history.

So: rows that already have state in `plan_json` keep it there and it expires
naturally. To avoid even the mid-session cliff, add a **read-side fallback for
one release**, which is five lines and no SQL:

```ts
// state/+server.ts and encounter-page.ts, during the transition
const cs = parseCombatState(p.combatStateJson) ?? legacyExtrasFromPlan(p.planJson);
```

Writers write **only** `combat_state_json` from day one — never both. The next
plan write for a participant naturally drops the legacy keys from `plan_json`
(the client stops sending them), so the data converges without a sweep. One
release later, delete `legacyExtrasFromPlan`, drop `combat` / `conditionTimers` /
`lair` from the `PlanJson` Zod schema, and Zod's strip-unknown behaviour makes any
residual keys invisible. No second migration is needed to clean up; stale keys in
`plan_json` are inert text.

### Code changes that ride along

| Surface | File | Change |
|---|---|---|
| Schema | `src/lib/server/db/schema.ts` | add `combatStateJson` |
| Zod | `src/lib/server/api/encounter-schemas.ts` | new `CombatStateJson` + `SetCombatStateRequest`; keep the three legacy keys on `PlanJson` for one release, then remove |
| Write route | new `…/participants/[pid]/combat-state/+server.ts` | `PATCH` (merge), **not** `POST` (replace) — see risk note; DM-only for non-PC, plus `_openapi` export (required) |
| Write route | `…/participants/[pid]/plan/+server.ts` | unchanged; `DELETE` becomes honest — it now only clears intent |
| Poll | `…/state/+server.ts` | read `combat_state_json` in the `.select({…})` list; add it to the ETag hash input (it is inside `partRows`, so hashing the row already covers it once selected); project `spellSlots` and `lair` onto the response |
| Poll wire shape | `…/state/+server.ts` + `encounter-channel.ts` | `participantEconomy` and `participantHp.conditionTimers` are **already projections**, so they do not change. `lair` is the exception: `EncounterPage.svelte` (`lairFlagFor`, and the `lairReminderForTurn` call) reads `livePlans[id]?.lair` raw. Needs a new projected field (`participantLair: Record<string, boolean>`, or fold onto `LiveParticipant`) |
| SSR | `src/lib/server/encounter-page.ts:346` | same fallback; pass combat state to page data |
| SSR | `src/lib/server/character-page.ts:412-421` | reads `selfPlan` only — intent only, so **no change** |
| Client | `src/lib/realtime/encounter-channel.ts` | delete `PlanExtras` / `planExtras` / `hasPlanExtras` / `planWithExtras`; `clearPlan` goes back to a plain `DELETE`; `setEconomy` / `setConditionTimers` / `setLair` target the new endpoint |
| Clone | `…/clone/+server.ts` | add `combatStateJson: p.lair ? JSON.stringify({ lair: true }) : null` — carries the prep marker, resets the ephemera. Fixes defect (c) |
| Tests | `…/plan/__tests__`, `…/state/__tests__`, `realtime/__tests__/encounter-channel.test.ts` | the existing clearPlan-preserves-extras tests invert: `DELETE` must now leave `combat_state_json` untouched |

### Rollback

The deploy is reverted after the migration has run. What happens:

- `__drizzle_migrations` keeps the applied row, so a later forward deploy does not
  re-run the migration (and `check-drizzle`'s live-DB drift check stays happy —
  the `when` still matches a journal entry, since the reverted code still ships
  the `drizzle/` folder unless the revert also removes the migration file; **do
  not revert the migration file, only the application code**).
- Old code never reads the column. Drizzle expands `db.select().from(table)` into
  an explicit column list built from the *schema object*, not a literal `SELECT *`
  — verified against the clone route, which is the only bare `select()` on
  `participants` (`clone/+server.ts:79-82`). So the extra physical column is
  invisible to the old build. No "no such column" and no positional-mapping shift.
- State written to `combat_state_json` while the new build was live becomes
  temporarily invisible; the old build reads the legacy `plan_json` keys, which by
  then may be stale. Loss is bounded to the same ephemeral state we already argued
  is allowed to lapse.
- **There is no down-migration**, and none should be written. Dropping the column
  would be a `participants` table rebuild — the exact operation this proposal
  avoids.

Compatibility with `scripts/migrate.mjs`: confirmed. `ALTER TABLE … ADD COLUMN`
performs no table rebuild and creates no new FK, so running under
`pragma foreign_keys = OFF` (set outside drizzle's transaction, `migrate.mjs:61`)
is a no-op for it, and the post-migration `foreign_key_check` sweep
(`migrate.mjs:72-78`) has nothing new to find. **The migration file must not
contain `PRAGMA foreign_keys`** — note that `drizzle/0007_awesome_power_man.sql`
still literally contains `PRAGMA foreign_keys = OFF;` / `ON;` at its head and
tail. Those lines are the no-op from the incident; they survive in-tree and must
not be copied as a template.

The pre-migration `VACUUM INTO` snapshot (`migrate.mjs:43-55`) will fire on the
prod boot that applies this, giving an in-place restore point. Confirm the volume
has headroom for a full DB copy before deploying.

---

## Item 2 — Encounter templates

### Does it need a migration? No.

The migration-free 80% is closer to 95%, and the table version is actively worse.

**Why the table is worse.** `encounter_templates(… roster_json …)` creates a
second, unvalidated representation of a participant roster that will drift from
the `participants` table. Every column added to `participants` — grid positions
are already on the roadmap — has to be re-plumbed into `roster_json`, into a Zod
schema for it, and into the instantiate route. The clone route already encodes,
in tested code and in a 30-line header comment, exactly which fields are prep and
which are per-run state (`clone/+server.ts:11-32`). A template table forks that
decision.

**Why "a template is just an encounter" already works.** `GET /api/encounters`
filters `staging` encounters out for non-DMs (`encounters/+server.ts:22-31`). A
staging encounter the DM never starts is *already* invisible to players, already
has a roster, already has notes, and already clones with correct reset semantics.
The only missing capability is "clone it somewhere else". A DM who keeps a
personal "Templates" campaign with no players gets the whole feature.

### Proposed change (no DDL)

```ts
// encounter-schemas.ts
export const CloneEncounterRequest = z
  .object({
    name: z.string().min(1).max(120).optional(),
    /** Target campaign for the clone. Defaults to the source encounter's
     *  campaign. Requires DM role in BOTH campaigns. */
    campaignCode: CampaignCode.optional()
  })
  .openapi('CloneEncounterRequest');
```

Route changes in `clone/+server.ts`:

1. Resolve target: `body.campaignCode ? await getMembershipByCode(user.id, body.campaignCode) : { campaignId: src.campaignId, role: <already checked> }`.
2. Require `role === 'dm'` on **both** source and target. Source check already exists
   (`getMembershipByCampaignId`, lines 75-77).
3. **Cross-campaign only:** skip `kind === 'pc'` participants entirely. This is
   mandatory, not a nicety — see the risk note.
4. Insert with `campaignId: target.campaignId`. Everything else is unchanged.
5. Log `targetCampaignId` alongside the existing fields.
6. Update the `_openapi` summary/description (required by AGENTS.md; the spec is
   the public contract).

Rollback is `git revert` — there is no schema state to unwind.

### Risk: the PC participant leak

`POST /api/encounters/[id]/participants` validates that a linked `characterId` is
in the encounter's campaign **via `campaign_characters`, never the `campaignId`
soft pointer** (`participants/+server.ts:38-51`, and the AGENTS.md boundary).
Copying a PC participant across a campaign boundary would create a row that the
add-participant route would have rejected — and worse, `GET /…/state` projects
that PC's HP, temp HP, conditions, concentration and turn plan from the character
document to **every approved member of the target campaign** (the per-participant
projection loop in `state/+server.ts`), gated only by the reveal flags, which
`defaultRevealsFor('pc')` sets to all-true. That is a cross-campaign character
data leak with no user-visible warning.

Two acceptable behaviours; pick one and test it:
- **Skip** `kind === 'pc'` rows on a cross-campaign clone (recommended — a template
  is a monster roster; the DM adds the party in the target campaign).
- Copy them **with `characterId: null`**, degrading them to name-only placeholder
  rows. Cheaper for the DM, but a `kind:'pc'` row with no character link is a shape
  nothing else in the codebase produces; prefer the skip.

Lesser notes: `notes_json` carries over, which is fine — it is DM-only prose and
the actor is DM of both campaigns. `statblock_slug` resolves globally at load
(`encounter-page.ts:70-74` queries `WHERE kind='monster'` with no campaign-grant
scoping), so a cloned monster renders in the target campaign regardless of
`campaign_content_grants`. That is pre-existing behaviour and out of scope here,
but it is the reason cross-campaign clone does not need content-grant plumbing.

### If the table is built anyway

DDL for the record. **Not recommended now.**

```sql
CREATE TABLE `encounter_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `roster_json` text DEFAULT '[]' NOT NULL,
  `notes_json` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
  `updated_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `encounter_templates_owner` ON `encounter_templates` (`owner_user_id`);
```

Notes if it is ever built: no backfill (new table, zero existing rows, so the
rehearsal's row-count assertion is trivially satisfied); `ON DELETE cascade` on
`owner_user_id` means deleting a user drops their templates, which the
post-migration `foreign_key_check` will not flag but a `DROP TABLE users` rebuild
in some future migration *would* cascade through — add `encounter_templates` to
the fixture in `scripts/rehearsal-fixture.sql` at that point, or the guard goes
blind to it. Routes needed: `GET/POST /api/encounter-templates`,
`GET/PATCH/DELETE /api/encounter-templates/[id]`,
`POST /api/encounter-templates/[id]/instantiate`, each with an `_openapi` export.
That is five routes and a duplicated roster serializer versus ~30 lines in an
existing route.

---

## Item 3 — Encounter-level lair flag

### Does it need a migration? No — and it should not be built.

**The stated premise is wrong.** The backlog note says the marker "needs a
legendary creature present". It does not:

- The checkbox renders for **any non-PC participant**: the guard on the
  "🏰 has lair actions in this encounter" block in `EncounterPage.svelte` is a
  bare `{#if data.role === 'dm' && !isPc}`, with no legendary condition. (The
  separate `LegendaryActionTracker` immediately above it *is* legendary-gated,
  which is probably where the belief came from.)
- `lairSources()` returns `p.lair === true || (p.legendaryActionCount ?? 0) > 0`
  (`src/lib/encounter/lair.ts:55-57`) — an explicit OR. A lair with no legendary
  creature fires the reminder correctly.

The only true constraint is that the flag needs *some* non-PC participant row to
hang on. An encounter with zero non-PC participants has no monsters, which makes
"this fight has a lair" close to vacuous.

**The real defect is lifetime, not location.** `POST /…/clone` nulls `plan_json`,
so "run it again" loses the lair marker — even though it is prep, like the roster
and the notes that clone *does* carry. That is fixed by Item 1's column plus one
line in the clone route. No `encounters` change is involved.

### Why each candidate home is worse than the status quo

- **`encounters.notes_json`** — no. It is DM prose validated as
  `z.string().max(4000)` and rendered in a textarea. Making it structured is a
  type change with a data migration over every existing row, i.e. strictly more
  migration than a new column, for less clarity.
- **`ALTER TABLE encounters ADD lair integer DEFAULT 0 NOT NULL;`** — mechanically
  safe (SQLite permits `ADD COLUMN` with a constant default; no rebuild; no FK
  interaction; no backfill needed since the default materialises for existing
  rows) but semantically bad: it creates a *second* source of truth for
  `hasLair`, and every reader must then answer "encounter flag OR any participant
  flag?" There is no third behaviour the OR of two flags gives you that the
  per-participant flag does not already give.
- **`encounters.flags_json text` (a generic nullable blob)** — the only version
  worth considering, and only *later*. If a second encounter-scoped boolean
  appears (the positions/grid roadmap item is the likely candidate), migrate once
  for a blob rather than twice for two booleans. Even then it recreates the
  multi-concern-blob problem Item 1 is unwinding, so it needs a stated key
  contract and a Zod schema from day one. Defer until there are at least two real
  flags.

**Recommendation: do nothing.** Fold the lair marker into `combat_state_json` as
part of Item 1 (which fixes the clone loss), and revisit only if a user actually
asks for a lair in an encounter with no monsters in it.

---

## Rehearsal checklist (applies to Item 1 only)

Item 2 has no schema change; Item 3 is not being done.

**Branch + PR. Never straight to `master`** — pushing `master` auto-deploys to Fly
and `migrate.mjs` runs at boot.

1. `git checkout -b feat/participants-combat-state`
2. Edit `src/lib/server/db/schema.ts` (add `combatStateJson`), then `pnpm db:generate`.
3. **Inspect the generated SQL.** It must be the single `ALTER TABLE \`participants\`
   ADD \`combat_state_json\` text;` line. If it is a `participants_new` rebuild,
   stop — that fires `action_log`'s FK actions.
4. Confirm the new journal entry's `when` is strictly greater than `1785075771100`
   (the current newest). If the branch is rebased or the migration cherry-picked,
   re-check this before merge — `check-drizzle` enforces it, and drizzle silently
   skips a non-increasing entry in prod.
5. Commit schema + `.sql` + `meta/*_snapshot.json` + journal **in one commit**.
6. `pnpm check` — `check-drizzle` (10 migrations OK) + `rehearse-migrations`
   (new tag OK against populated DB) + `svelte-check` clean. The fixture needs no
   edit: it inserts `participants` with an explicit column list and the new column
   is nullable.
7. `pnpm test` and `pnpm build`.
8. **Prod-data rehearsal:**
   ```bash
   fly ssh sftp get /data/grimoire.db ./prod-copy.db   # or fly ssh console + VACUUM INTO
   sqlite3 prod-copy.db "SELECT 'participants', count(*) FROM participants
     UNION ALL SELECT 'encounters', count(*) FROM encounters
     UNION ALL SELECT 'characters', count(*) FROM characters
     UNION ALL SELECT 'action_log', count(*) FROM action_log
     UNION ALL SELECT 'campaigns', count(*) FROM campaigns
     UNION ALL SELECT 'users', count(*) FROM users;" | tee before.txt
   sqlite3 prod-copy.db "SELECT count(*) FROM participants WHERE plan_json IS NOT NULL;"
   DATABASE_URL=./prod-copy.db pnpm migrate
   # ^ must print a pre-migration snapshot path, then "migrations applied", and
   #   must NOT print any foreign_key_check violation
   sqlite3 prod-copy.db "<same UNION ALL query>" | tee after.txt
   diff before.txt after.txt      # must be empty
   sqlite3 prod-copy.db "PRAGMA integrity_check; PRAGMA foreign_key_check;"
   sqlite3 prod-copy.db "PRAGMA table_info(participants);"   # combat_state_json present, notnull=0, dflt_value=NULL
   ```
9. Point a local dev server at the migrated copy and open a real encounter: the
   economy, timers and lair marker should still render (read fallback path), and a
   fresh write should land in `combat_state_json`.
10. Confirm the Fly volume has free space for the boot-time `VACUUM INTO` snapshot
    (`migrate.mjs` keeps the last 3).
11. Merge the PR; watch the boot logs for `pre-migration snapshot →` and
    `migrations applied →`. If `foreign_key_check` fails, `migrate.mjs` exits 1 and
    the machine will not serve — restore from the snapshot file it just wrote.
12. Delete `prod-copy.db` and its `.pre-migrate-*` snapshots.

---

## Zod / `CharacterDocument` exposure

There is a history of fields being silently stripped by Zod (AGENTS.md: "Don't add
a new field on `CharacterDocument` without also adding it to the `CharacterDocument`
Zod schema — Zod silently strips unknown keys on PATCH"). What is at risk here:

- **Already covered, no change needed.** `CharacterDocument` in
  `src/lib/server/api/schemas.ts` already declares `conditionTimers` (line 194),
  `actionUsedThisRound` / `bonusActionUsedThisRound` / `reactionUsedThisRound` /
  `movementUsedThisRound` (lines 240-243) and `concentrating` (line 245). Item 1
  changes only the **non-PC** storage path; the PC path is untouched.
- **New exposure: `CombatStateJson`.** A `z.object` strips unknown keys by default,
  so the moment `combat_state_json` is written through a Zod-validated route, any
  key not declared in the schema is dropped on write with no error. This is the
  same footgun as `CharacterDocument`, on a new blob. Two mitigations, both worth
  taking: (a) add a matching AGENTS.md boundary bullet; (b) make the write route
  `PATCH`-with-server-side-merge rather than `POST`-replace, so a client that knows
  about three of four keys cannot blank the fourth. Note the existing plan route is
  replace-semantics (`plan/+server.ts:33-37`), which is *why* the client has to
  round-trip `planExtras` — repeating that shape on the new column would repeat the
  whole problem.
- **`PlanJson` during the transition.** `combat` / `conditionTimers` / `lair` must
  stay declared on `PlanJson` for the fallback release; removing them early means
  the state poll's `safeParse` strips them and legacy rows read as empty. Remove
  them in the follow-up release, not the migration release.
- **State-poll response schemas.** `participantEconomy` and
  `participantHp.conditionTimers` are declared response schemas in
  `state/+server.ts`; a new `participantLair` (or `LiveParticipantSchema.lair`)
  must be added there or the field never reaches the client. `LiveParticipantSchema`
  is also the wire contract consumed by `src/lib/realtime/participants.ts`.
- **Item 2's `campaignCode`** must be added to `CloneEncounterRequest` or `parseJson`
  drops it and every clone silently lands in the source campaign — a stripped-field
  bug that presents as "the feature does nothing".
- `Participant` (the REST serializer schema) exposes neither `plan_json` nor
  reveals, so it needs no change for Item 1.

---

## Ranking, value to risk

**1. Item 2 — clone into another campaign. Do this first.**
No migration, no deploy risk, no rollback story needed, ~30 lines in one route
plus one optional Zod field. Delivers the reusable-roster workflow the template
feature was for. Its one real hazard (PC rows crossing a campaign boundary) is
contained in a single `if` and is testable in the existing
`clone/__tests__/server.test.ts`. Highest value per unit of risk by a wide margin.

**2. Item 1 — `participants.combat_state_json`. Do this second, on a branch.**
The migration itself is the lowest-risk DDL SQLite offers: one nullable column,
metadata-only, no backfill, no FK interaction, fully compatible with
`migrate.mjs`'s FK-off-then-`foreign_key_check` dance, and invisible to a
rolled-back build. It fixes a real API-contract defect (`DELETE .../plan` destroying
encounter state) that no amount of client-side care can fix, and it removes the
blast radius of a single malformed plan field. The risk is not in the SQL — it is
in the code migration, and specifically in colliding with the concurrent
workstream. **Sequencing matters:** NPC spell slots are still client-only in-memory
state today, so landing this column *before* they are persisted saves a second
migration of the same data. Coordinate before starting; `schema.ts` + `drizzle/` is
a hard serialization point.

**3. Item 3 — encounter-level lair flag. Don't do it.**
The limitation it was filed against does not exist (the marker is not
legendary-gated), the residual defect (clone drops the marker) is fixed for free
by Item 1, and every proposed home either duplicates existing state or degrades a
prose column. Close it; reopen only if a second encounter-scoped flag appears, and
then migrate once for `encounters.flags_json` rather than twice for two booleans.
