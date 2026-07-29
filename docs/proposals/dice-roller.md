# Dice roller — implementation plan

Status: **plan**. Nothing here is built. Phases 0–6 need no schema change and
can land incrementally on `master`; phase 7 is migration-gated and should ride
along with `participants.combat_state_json` (see `ws2-schema-followups.md`)
rather than take a second migration hit.

**The framing that matters:** a dice roller is not a new feature bolted onto
the side. It is the *missing consumer* for a tier of engine work that is
already built, tested, documented, and currently inert. Roughly 35 roll-time
modifier flags are computed by `derive()`; four of them reach the UI as
non-interactive chips, and exactly one has any runtime behaviour.

---

## Verified current state

### The two dice rolls that exist

| Site | Code | Scope |
|---|---|---|
| Manual d4–d100 button bar | `src/lib/components/encounter/TurnControls.svelte:12-16` | DM-only, live encounters only. `Math.floor(Math.random() * sides) + 1`. Component-local state, no props, no events, no modifiers, no persistence. Result is overwritten by the next click. |
| NPC initiative auto-roll | `src/lib/components/encounter/EncounterPage.svelte:908` | `1 + Math.floor(Math.random() * 20) + dexMod`. **Ignores `stats.initiativeAdvantage`**, which `derive()` computes right next to the DEX modifier it does use. |

`grep -rn "Math.random" src/` returns exactly those two plus one DOM-id
generator in `ConfirmModal.svelte:34`. **There is no dice evaluator anywhere in
the codebase** — nothing turns the string `2d6+3` into a number.

Everything else is a human rolling physical dice and typing a total: attack,
damage, every per-target save (`ResolvePanel.svelte:224-238`, `:177-183`),
concentration saves (`ConcentrationSavePrompt.svelte`), HP adjustments
(`HpAdjustRow.svelte`), initiative (`ParticipantRowCard.svelte`), death saves,
and ability scores at character creation. Hit dice don't roll at all — spending
one awards the average. The character-creation "Rolled" option asks you to type
six numbers.

### Three partial die parsers, no evaluator

- `src/lib/rules/random-tables.ts:76-84` — `parseDieBounds()`, returns min/max only.
- `src/lib/rules/upcast.ts:124-140` — `bumpDiceFormula()`, rewrites `NdS[+F]` counts.
- `src/lib/rules/cross-row-upgrades.ts` — `DIE_RE` for die-size comparison.

All three are pure and none of them roll. They should be left alone; the new
module is additive, not a refactor of these.

### The dead surface

`grep` for the roll-time flags outside `src/lib/rules/` returns **nothing** for
every one of these:

```
critThreshold          critExtraDie            damageDieMin
damageRerollAndKeepHigher                      damageMaximized
damageMaximizedVsObjects                       damageDiceDoubled
damageDiceDoubledVsObjects                     healMaximized
hitDiceMaximized       deathSaveAdvantage      initiativeAdvantage
```

(declared `src/lib/rules/types.ts:668-700`, `:391`, `:514-519`).

Four flags do reach a component — `SkillCell.advantage` / `disadvantage` /
`bonusDice` / `d20Floor`, rendered as chips at `src/lib/components/Sheet.svelte:172-185`.
They are labels; clicking them does nothing.

Exactly one flag has runtime behaviour: `StatBlock.incomingCritImmune`, which
`src/lib/realtime/resolve.ts:33-43` uses to *relabel* a declared crit as a hit.
It does not change a number, because there is no number to change.

So Silver Tongue's floor of 10, Great Weapon Fighting's reroll, Savage
Attacker, the Champion's crit range, Bless's `1d4`, Overchannel's maximize,
every `randomTable` (deck of many things, wild magic), every `dieFromResource`
superiority die — encoded across eight engine batches, and consumed by nothing.

### Player-side action resolution is ~95% built and unreachable

This is the single most important finding for the "players roll their own
actions" goal, so it gets its own section.

**The server already supports it.** `POST /api/encounters/[id]/log`
(`src/routes/api/encounters/[id]/log/+server.ts`) documents and enforces
"Players may only act for participants tied to characters they own" — it looks
up the participant's `characterId` and checks ownership when `role === 'player'`.
The `action_log.submitterRole` column is `'player' | 'dm'`. No API work is
needed for players to log their own actions.

**The client flow is written.** `CharacterSheetPage.svelte` contains a complete
implementation: `resolveOpen` (:248), `openResolve()` (:425),
`applyToTarget()` (:442), `submitResolve()` (:504). It is not a stub — it reads
the player's own plan, handles multi-target saves with per-target roll-vs-DC
adjudication, POSTs one log row per target, applies HP deltas, consumes the
action-economy slot, debits `spendsResource` pools, applies grants (temp HP,
condition removal, slot restore) in one `patchDocument`, and clears the plan.

**Nothing in any markup calls it.** `openResolve()` is defined and never
invoked; `resolveOpen` is assigned `true` at :427 and `false` at :586 and never
read. Checked against `c2841b3^`: it was *already* dead in both pre-de-fork
copies of the sheet, so this is long-standing never-wired code, not a de-fork
regression.

So player action resolution is a UI-wiring job, not a build. That materially
changes its cost and moves it up the plan (phase 5 below).

### Free rolling is DM-only

The only free-form roller in the app is the `TurnControls` button bar, gated at
`EncounterPage.svelte:1803` on `liveStatus === 'live' && data.role === 'dm'`.
A player cannot roll a d20 anywhere in Grimoire, in or out of an encounter, and
there is no roller at all outside a live encounter. The app shell
(`src/routes/+layout.svelte`, header at :45-99, `<slot />` at :113) has no dice
surface.

### The purity guard does not guard purity

`src/lib/rules/__tests__/purity.test.ts` is an **import-graph test only**: it
asserts every file in `src/lib/rules/` imports only relative siblings. It says
nothing about `Math.random` or `Date.now`, which are globals and would sail
straight through. The determinism requirement for `derive()` currently exists
only as prose comments in four files.

It also would not catch `import { roll } from '../dice/roll'` — that specifier
*is* relative and passes the existing check.

---

## Architecture

**One pure evaluator, RNG injected at the call site.**

```
src/lib/dice/
  types.ts     DiceExpr, RollOptions, RollResult, Rng
  parse.ts     parseDice('2d6+3'), parseDice('4d6kh3')  → DiceExpr | null
  roll.ts      rollDice(expr, opts, rng), rollD20(mod, opts, rng)
  rng.ts       mulberry32(seed) for tests; cryptoRng() for the browser
  from-derived.ts   SkillCell → RollOptions, Action → damage RollOptions, …
```

Why a new top-level module and not `src/lib/rules/dice.ts`: `src/lib/rules/`
must stay deterministic and repeatable — the cross-row upgrade machinery,
serialization, and caching all assume `derive()` returns the same output for
the same input. Dice go beside the engine, never inside it.

Why injected RNG rather than calling `Math.random` internally: every
interesting behaviour (advantage, floors, rerolls, crit dice, maximize,
keep-highest) is pure logic that deserves exact-value tests. With a scripted
RNG the whole module is testable without statistical assertions.

```ts
export type Rng = () => number;                       // [0, 1)

export interface RollOptions {
  advantage?: boolean;          // d20 only; both true cancels per RAW
  disadvantage?: boolean;
  bonusDice?: string[];         // Bless, Bardic Inspiration: ['1d4']
  d20Floor?: number;            // Silver Tongue, Reliable Talent
  dieMin?: number;              // Great Weapon Fighting → 3
  rerollAndKeepHigher?: boolean;// Savage Attacker
  maximize?: boolean;           // Overchannel, Supreme Healing
  doubleDice?: boolean;         // crit, Death Strike
  extraDice?: number;           // critExtraDie
  keep?: { count: number; from: 'highest' | 'lowest' };  // 4d6kh3
}

export interface RollResult {
  total: number;
  flat: number;
  formula: string;              // as authored
  dice: Array<{
    sides: number;
    value: number;
    kept: boolean;
    note?: 'floored' | 'rerolled' | 'maximized' | 'dropped' | 'crit' | 'bonus';
  }>;
  detail: string;               // '2d6+3 → [4, 6] + 3 = 13'
}
```

`from-derived.ts` is the load-bearing piece for the "activate the dead flags"
goal: it is the *one* place that knows `Action.damageDieMin` maps to
`RollOptions.dieMin`, that `critThreshold` decides whether a d20 result counts
as a crit, that `SkillCell.d20Floor` becomes `d20Floor`. Components call it and
stay dumb. Without it that mapping gets copy-pasted into five components and
drifts.

### Client-rolled, deliberately

Rolls happen in the browser and the result is submitted like a typed one. This
is trivially cheatable, and that is fine: the DM can already amend any log
entry, the existing flow is *entirely* self-reported, and this is a tool for a
table of friends rather than a tournament server. The evaluator being
isomorphic means server-authoritative rolling is a later swap of the call site,
not a rewrite.

Stating it explicitly so nobody "fixes" it by accident later.

---

## Phases

### Phase 0 — guards (prerequisite, ~1h)

Two small changes that must land *before* any dice code, because both get
harder to add once there is a roller tempting people.

1. **Determinism guard.** Extend `purity.test.ts` with a source scan over
   `src/lib/rules/*.ts` rejecting `Math.random`, `Date.now`, `new Date(`, and
   `performance.now`. Also reject import specifiers that escape the rules
   directory (`../` followed by anything not resolving inside `RULES_DIR`) —
   the current check accepts `../dice/roll` because it is technically relative.

2. **Fail-closed redaction.** `RedactableActionLogEntry`
   (`src/lib/realtime/action-log.ts:44-58`) documents that "extra keys are
   preserved", and the hidden-actor branch (:108-125) spreads `...entry` and
   then nulls sensitive fields *by name*. Adding a roll-detail field in phase 7
   would ship a hidden monster's dice to every player — reintroducing exactly
   the leak fixed in `360bfc6`. Restructure so the compiler enforces it:

   ```ts
   // Every field of the redactable slice that describes the actor's behaviour.
   // Typed so adding a field to the interface fails to compile until it is
   // dispositioned here.
   const HIDDEN_ACTOR_BLANKS: Omit<RedactableActionLogEntry,
     'participantId' | 'targetParticipantId' | 'redacted'> = {
     actionId: '', actionLabel: REDACTED_ACTION_LABEL,
     attackRoll: null, damageRoll: null, hit: null,
     targetHpBefore: null, targetHpAfter: null, notes: null
   };
   ```

   Behaviour-identical today; the point is that it stops being possible to add
   a leaky field silently.

### Phase 1 — the evaluator (~1 day)

`src/lib/dice/` per the architecture above, plus `src/lib/dice/__tests__/`
with a scripted RNG for exact-value assertions. No UI changes, no imports from
anywhere else yet. Coverage that matters:

- advantage/disadvantage, and both-set cancelling to a straight roll
- `d20Floor` applying after the advantage pick, not before
- `dieMin` flooring each die independently (GWF is per-die, not per-total)
- `rerollAndKeepHigher` rerolling *all* damage dice as a set (Savage Attacker
  is one reroll of the whole pool, not per-die)
- `doubleDice` doubling dice only, never the flat modifier
- `extraDice` (crit extra die) stacking with `doubleDice` without double-counting
- `maximize` interacting with `dieMin` and `doubleDice`
- `keep` for `4d6kh3`
- unparseable input returning `null` rather than throwing

This phase is the whole keystone. Everything after it is wiring.

### Phase 2 — flag adapters (~half day)

`from-derived.ts` mappers plus tests asserting each dead flag now produces the
right `RollOptions`. This is where the ~35 inert flags become reachable; it is
worth its own phase and its own test file so the coverage is legible as
"flag X is consumed".

### Phase 3 — character sheet (~1 day)

Highest payoff per line changed, and zero encounter-flow risk.

- **Skill rows become buttons.** `Sheet.svelte:172-185` already renders the
  adv/dis/bonus-dice/floor chips; making the row clickable activates the
  largest cluster of dead flags at once.
- Saving throws and raw ability checks, same treatment.
- **Death saves** honouring `deathSaveAdvantage`.
- **Hit dice** rolling instead of awarding average, honouring `hitDiceMaximized`.
- **Character creation "Rolled"** ability scores — `4d6kh3` ×6, which is why
  `keep` is in the phase-1 API.
- A shared `RollResultChip` in `src/lib/components/ui/` showing `detail`
  (`2d6+3 → [4, 6] + 3 = 13`) so a player can see *why*, and a DM can audit a
  disputed roll.

Results here are ephemeral — displayed, not persisted. No schema pressure.

### Phase 4 — the dice tray: free rolling for everyone (~half day)

Free rolling is a first-class goal, not a byproduct of the action surfaces, so
it gets its own phase and its own component rather than being bolted to
`TurnControls` (which is DM-gated and live-encounter-gated, and should stay
that way — it is a *combat* bar).

`src/lib/components/dice/DiceTray.svelte`, mounted in the app shell
(`src/routes/+layout.svelte`) so it is available on every page to every role,
logged in or not, in or out of an encounter:

- d4–d100 quick buttons plus a formula box (`2d6+3`, `4d6kh3`, `1d20+5`).
- Advantage / disadvantage toggles for d20 rolls.
- A local roll history (last ~20), client-side only, so "wait, what did I
  actually roll" has an answer.
- Collapsed to a small persistent affordance by default; it must not compete
  with the sheet or the encounter board for space.

**Sharing.** A roll nobody else sees is a much smaller kind of fun, so when the
user is viewing a live encounter the tray gets a "share to table" button. This
needs **no migration**: a shared roll is an ordinary `action_log` row under the
existing `SubmitActionLogRequest` shape — `actionId: 'dice/free'`,
`actionLabel` carrying the formula, `notes` carrying `RollResult.detail`. The
POST route already authorizes players for participants they own.

Default is **local**; sharing is one explicit click. Combat logs are an audit
trail and nobody wants them full of idle d20s.

`TurnControls` still gets its `Math.random` swapped for the evaluator so there
is exactly one roll implementation, but keeps its current DM/live gating.

### Phase 5 — player action resolution (~half day, mostly wiring)

Revive the flow documented above. The decision is made: **revive, don't
delete.** The server authorizes it, and `submitResolve()` /
`applyToTarget()` already implement multi-target saves, HP application, action
economy, resource debits, and grants.

- Add the markup: an "Resolve" button on the player's own plan that calls
  `openResolve()`, and the `{#if resolveOpen}` panel binding
  `resolveAttack` / `resolveDamage` / `resolveHit` / `resolveNotes` /
  `targetSaveRolls`.
- Reuse `ResolvePanel.svelte` if its DM-specific affordances (statblock
  action row, arbitrary target picker) can be made optional; fork a
  `PlayerResolvePanel` only if that turns ugly. Do not duplicate the redaction
  or economy logic either way.
- Every roll input gets a roll button from phases 1–3, prefilled from the
  planned `Action` (attack bonus, damage dice, `critThreshold`, `damageDieMin`,
  `damageRerollAndKeepHigher`, `critExtraDie`). This is where the dead
  action-level flags finally do work.
- **Manual entry stays**, same as the DM side — a player rolling physical dice
  at the table types the number.
- Verify the flow end-to-end before shipping: it has never run in production,
  so treat the existing code as unproven rather than known-good. An e2e case
  covering a player resolving an attack against a monster is the acceptance
  bar, and it doubles as the regression guard against it going dead again.

### Phase 6 — DM encounter surfaces (~1 day)

- **Resolve panel**: roll buttons beside the attack, damage, and per-target
  save inputs, prefilled from the statblock action already surfaced at
  `ResolvePanel.svelte:98-114` (`attackBonus`, `damage[].dice`). Manual entry
  stays.
- **Concentration saves** and initiative get roll buttons.
- **NPC initiative auto-roll** routed through the evaluator so
  `initiativeAdvantage` finally applies.
- **`randomTable`** picker — the deck of many things and wild magic surge
  tables are fully encoded and have never been rollable.

Totals still persist through the existing `attackRoll` / `damageRoll` integer
columns. No migration.

### Phase 8 — permissive-by-default table permissions (~1 day, no migration)

Added 2026-07-29 at the user's request: *"each campaign/DM should have
permissions, allow by default, so anyone can roll (or update hp or whatever)
for any player. The DM can override this per campaign."*

Today the app defaults the **opposite** way — every mutation is owner-gated:

| Surface | Current rule |
|---|---|
| `POST /api/encounters/[id]/log` | players may only act for participants tied to characters they own |
| `.../participants/[pid]/plan` | same |
| `.../participants/[pid]/hp`, `/conditions` | **reject PCs outright** with a 400 — PC vitals live on the character document, so there is no server path for *anyone*, DM included, to damage a PC |
| `PATCH /api/characters/[id]` | owner-only (or admin), full document write |

Two pieces, and the useful one needs no schema.

**8a — the policy module and the permissive default.**
`src/lib/server/auth/campaign-permissions.ts` exposes one async
`getCampaignPermissions(campaignId)` returning:

```ts
export interface CampaignPermissions {
  /** Submit log entries / resolve actions for any participant. */
  actForOthers: boolean;
  /** Adjust another PC's HP, temp HP, conditions, death saves. */
  editOthersVitals: boolean;
  /** Broadcast or clear another PC's plan. */
  planForOthers: boolean;
}
```

All three default `true`. Every call site consults the module rather than
inlining an ownership check, so when the column lands in 8b the *only* thing
that changes is where the policy comes from — zero call-site churn.

Also in 8a: teach `.../participants/[pid]/hp` and `/conditions` to accept PC
participants by applying a **scoped** patch to the linked character document
(current HP, temp HP, conditions, death saves — nothing else). This is what
makes "apply damage to any player" actually work, and it closes the DM-side
gap in the table above as a side effect.

**Deliberate scope boundary:** `PATCH /api/characters/[id]` stays owner-only.
Permissive rolling and HP is a table-trust decision; letting any campaign
member rewrite another player's class, feats, and inventory is not the same
decision, and nothing in the request implies it. The narrow vitals endpoint
gives the stated capability without that blast radius. Widening this later is
a one-line policy addition — it should be an explicit choice, not a side
effect.

Membership remains the outer boundary throughout: `requireEncounter` already
403s non-members, and permissive means *permissive within an approved
campaign*, never public.

**8b — per-campaign override (migration-gated).** `campaigns` has no settings
column, so the DM-facing override needs
`ALTER TABLE campaigns ADD permissions_json text;` — nullable, no backfill,
absent means "all defaults", which is exactly the permissive behaviour 8a
already ships. Rides the same migration branch as phase 7.

**Extra care on this one:** `campaigns` is referenced by `characters`,
`campaign_members`, and `encounters`. A drizzle-kit table rebuild here is far
worse than on `participants`. Same hard gate — read the generated SQL, stop if
it is not a plain `ADD COLUMN`.

Plus the DM settings UI (three checkboxes on the campaign page) and an
`audit-log` entry when a DM tightens a permission, so a player who suddenly
can't roll can be told why.

### Phase 7 — persisted roll detail (migration-gated, defer)

To show *which dice came up* in the log rather than just a total, `action_log`
needs a nullable `roll_detail_json` column (it has no JSON column today, and
`saveDC` / `targetSaveRolls` are not persisted at all). Bundle this with the
`participants.combat_state_json` migration in one branch + PR + rehearsal per
AGENTS.md; do not take a separate migration for it.

Gate, same as the other migration: **inspect the generated SQL and stop if
drizzle-kit emits a table rebuild.** `action_log` carries FKs with
`ON DELETE set null` to `participants` — the 0007 failure mode.

Requires the phase-0 redaction restructure to already be in place, plus an e2e
assertion that a hidden actor's roll detail does not appear in the player view.

---

## Risks

| Risk | Mitigation |
|---|---|
| New log field leaks hidden-actor dice to players | Phase 0 fail-closed redaction; phase 7 e2e assertion |
| `Math.random` creeps into `src/lib/rules/` | Phase 0 source scan |
| Dice module imported by the engine | Phase 0 escape-path check in `purity.test.ts` |
| e2e non-determinism | Assert on ranges/presence, not exact values; the seeded RNG is for unit tests |
| New UI text collides with loose e2e locators | Known recurring failure mode — new buttons get `exact: true` or scoped locators from the start |
| Rolling replaces manual entry and players/DMs lose control | Explicit non-goal; roll buttons fill inputs, never bypass them |
| Free rolls flood the combat log | Tray is local by default; sharing is one explicit click, and shared rolls use a distinct `actionId: 'dice/free'` the log renderer can style or collapse |
| The revived player resolve flow has never run in production | Treat it as unproven, not known-good: read it before wiring, and gate phase 5 on an e2e case covering a player resolving an attack |
| Player-submitted rolls are self-reported | Accepted — see "Client-rolled, deliberately". The DM can amend any entry, and `submitterRole` records who claimed what |

## Non-goals

3D/physics dice. Exploding dice, fudge dice, and other non-5e notation.
Server-authoritative anti-cheat rolling. Roll macros/aliases. Rolling for the
DM automatically on NPC turns (initiative is the one exception, and it already
auto-rolls today).

## Sequencing

Phase 0 gates everything. Phase 1 gates 2–7. Phase 2 gates 3, 5 and 6.

After that the order is a preference, not a constraint:

| Order | Phase | Why here |
|---|---|---|
| 1 | 0 — guards | Cheap, and both guards get harder to add once a roller exists |
| 2 | 1 — evaluator | The keystone; everything else is wiring |
| 3 | 2 — adapters | Where the inert flags become reachable |
| 4 | **4 — dice tray** | Can jump the queue: it needs only phases 0–1, is role-independent, and is the fastest path to "everyone at the table can roll dice" |
| 5 | 3 — sheet rolls | Biggest dead-flag payoff per line, zero encounter-flow risk |
| 6 | 5 — player actions | Mostly wiring, but the code underneath is unproven |
| 7 | 6 — DM surfaces | Touches the most load-bearing flow, so it goes last of the non-migration work |
| — | 7 — roll detail | Migration-gated; rides the `combat_state_json` branch |

Phases 0–6 have no schema dependency and are individually shippable. If the
goal is "players can roll, and free rolling works" as early as possible, the
minimum path is **0 → 1 → 4 → 2 → 3 → 5**.
