# Three remaining engine workstreams — design plan

Research-only design plans for three engine + tooling workstreams that
together unblock ~80+ T1-STUB pack rows. This document defines scope,
schema shapes, and phase plans so the work can be picked up in order.

**Status (2026-07-26):** Workstream 1 (Battle Master maneuvers) has
SHIPPED — `ManeuverDecl` + `ManeuverEffect` in `src/lib/rules/types.ts`,
`synthesizeManeuver` in `derive.ts`, tests in
`src/lib/rules/__tests__/maneuvers.test.ts` — along with its class-resource
prereq (`src/lib/rules/class-resources.ts`). Workstreams 2 (OUT-FLUFF tier
marker) and 3 (spell-pack expansion) remain open; both are engine-free and
safe to run in parallel with other work.

The three workstreams are independent and can be parallelized, but they
have asymmetric risk and leverage. See the summary at the end for a
recommended execution order.

- [Workstream 1: Battle Master maneuver content model](#workstream-1)
- [Workstream 2: OUT-FLUFF tier marker for the audit classifier](#workstream-2)
- [Workstream 3: dnd-5e-srd spell-pack expansion](#workstream-3)

---

## Workstream 1 — Battle Master maneuver content model {#workstream-1}

### Problem

Battle Master fighters spend Superiority Dice to perform "maneuvers" —
Riposte, Trip Attack, Parry, Disarming Attack, Lunging Attack, etc. The
class-resource primitive (in flight, parallel to this plan) ships the
Superiority Die pool itself, but the maneuver *content model* is the
gap: how a class declares the menu of N maneuvers, how the player picks
3/5/7/9 of them across levels 3/7/10/15, and how each picked maneuver
synthesizes into the appropriate Action / action-modifier / Trigger.

The existing rows at
`/home/narfman0/workspace/grimoire-packs/phb-2014/features/battle-master.json`
and
`/home/narfman0/workspace/grimoire-packs/phb-2024/features/battle-master.json`
already enumerate the 16 RAW maneuvers as `activities[]` with
`spendsDie: "superiority"` markers — but **every player gets every
maneuver**. RAW says a Battle Master picks 3 at level 3, +2 at 7/10/15.
Eldritch Knight gets a similar mechanic in some variants. The Martial
Adept feat and Superior Technique fighting style also grant 1 maneuver
each.

### Content schema

**Class / feature declares the menu** on a new
`data.maneuvers: ManeuverDecl[]` field, with each entry describing the
maneuver's mechanics in declarative form. Keep it on the feature row
that owns the picks (`combat-superiority`):

```jsonc
{
  "kind": "feature",
  "slug": "combat-superiority",
  "data": {
    "ownerKind": "subclass",
    "ownerSlug": "battle-master",
    "minLevel": 3,
    "maneuvers": [
      // ManeuverDecl[] — see "ManeuverDecl shape" below
    ],
    "choices": {
      "maneuvers": {
        "picks": { "perClass": "fighter", "table": [0, 0, 3, 3, 3, 3, 5, ...] }
      }
    }
  }
}
```

The `choices.maneuvers` slot supplies the per-level count via the same
`perClass-table` shape `ClassResourceDecl.max` already accepts. The
player records picks in `character.featureChoices["combat-superiority"]
.maneuvers = ["riposte", "trip-attack", "goading-attack"]`. derive()
walks `featureChoices[].maneuvers` and synthesizes the chosen
maneuvers' mechanics.

#### ManeuverDecl shape

Each maneuver is a small object that mirrors the *kind* of effect it
produces. Shared fields plus a discriminated `effect` union:

```ts
export interface ManeuverDecl {
  id: string;                                          // pick identifier + synthesized Action id
  name: string;
  description: string;                                 // picker + sheet tooltip
  cost: 'free' | 'bonus' | 'reaction' | 'action';
  spendsResource: string;                              // 'superiority' (future-proof for Monk Focus etc.)
  effect: ManeuverEffect;
}

export type ManeuverEffect =
  | { kind: 'on-hit-rider';
      damageRider?: { dieFromResource: string; type: string };  // adds die to damage
      save?: { ability: AbilityKey; dc: { calc: 'maneuver' } | { value: number };
               onFail: ManeuverSaveEffect };
      maxTargetSize?: 'medium' | 'large'; }            // Trip/Pushing exclude Huge+
  | { kind: 'pre-roll';
      addsToRoll: 'attack';
      dieFromResource: string; }                       // Precision Attack
  | { kind: 'damage-reduction';
      reduceBy: { dieFromResource: string; addAbilityMod: 'dex' };
      triggerOn: 'damage.taken.melee'; }               // Parry
  | { kind: 'reaction-attack';
      triggerOn: 'attack.targets-self.miss';
      attackType: 'melee-weapon';
      damageRider: { dieFromResource: string; type: 'weapon' }; } // Riposte
  | { kind: 'ally-attack';
      costOnSelf: 'bonus'; costOnAlly: 'reaction';
      attackType: 'weapon';
      damageRider: { dieFromResource: string; type: 'weapon' }; } // Commander's Strike
  | { kind: 'temp-hp-grant';
      costOnSelf: 'bonus';
      tempHp: { dieFromResource: string; addAbilityMod: 'cha' }; } // Rally
  | { kind: 'target-free-move';
      distance: 'half-ally-speed'; };                  // Maneuvering Attack

export type ManeuverSaveEffect =
  | { kind: 'condition'; condition: 'prone' | 'frightened' | 'restrained' }
  | { kind: 'drop-item'; targets: 'held-item' }
  | { kind: 'forced-move'; distance: number }          // Pushing
  | { kind: 'disadvantage-against-others' }            // Goading
  | { kind: 'forced-move-target'; distance: number };  // Maneuvering
```

7 effect kinds cover all 16 RAW maneuvers and the ~6 newer ones
(Tasha's, 2024). Future expansion adds new variants; the union stays
discriminated. The `dc: { calc: 'maneuver' }` shape is a new resolver
that derive() expands to `8 + PB + max(strMod, dexMod)`.

### Choice mechanism

`choices.maneuvers` is a plural-pick slot — closest cousin is the
existing `choices.skillProficiencies: { picks: N }` shape (multi-pick
choice counts, SHIPPED). Reuses derive()'s plural-slot resolution:

- `pendingFeatureChoices[i]` flags `unresolved: true` until
  `featureChoices[slug].maneuvers.length === picks`.
- The picker UI (`FeatureChoicesPanel.svelte`) renders a checkbox grid
  of the allowed maneuvers (filtered by the parent feature's
  `data.maneuvers[]`), enforcing the `picks` cap client-side.

Cross-feature additions (Martial Adept feat, Superior Technique style)
push their single maneuver into the same `featureChoices[slug].maneuvers`
array using the same slot — the UI shows their picker beside Combat
Superiority's. derive() reads the union of all `maneuvers` picks across
active rows.

**Level-replace mechanic.** RAW at levels 7/10/15 the player may *swap*
one known maneuver for another. The picker UI just lets the player edit
`featureChoices[slug].maneuvers` freely — replace is just a deselect +
reselect. No engine-side level-pinning needed; the `picks` cap grows
with level via the `perClass-table`, and the player owns the array.

### Synthesis

For each chosen maneuver id, derive() walks the `data.maneuvers[]`
catalog on the parent feature, finds the matching entry, and
synthesizes engine-side artifacts per `effect.kind`:

| `effect.kind`          | What derive() emits                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `on-hit-rider`         | `Action` with `type: 'maneuver-rider'`, `cost: 'free'`, `gatedOnTrigger: 'attack.hit'`, damage + save embedded   |
| `pre-roll`             | `Action` with `type: 'maneuver-pre-roll'`, `gatedOnTrigger: 'attack.declare'`                                    |
| `damage-reduction`     | `TriggerDeclaration` with `on: ['damage.taken']`, `scope: { selfOnly: true }`, `grants: {type: 'damage.reduce'}` |
| `reaction-attack`      | `TriggerDeclaration` with `on: ['attack.targets-self.miss']`, `grants: {type: 'reaction-weapon-attack'}`         |
| `ally-attack`          | `OutboundEffect` with `targets: 'ally'`, embeds reaction-attack grant                                            |
| `temp-hp-grant`        | `Action` with `type: 'maneuver-buff'`, `grants: { tempHp }`, `targetMode: 'single'`, `cost: 'bonus'`             |
| `target-free-move`     | `Action` with `type: 'maneuver-ally-move'`, `cost: 'free'`, surfaces opportunity on the ally's planner          |

Each synthesized artifact carries a `spendsResource: 'superiority'`
field on the Action / Trigger so the planner knows to debit the pool
when the maneuver fires. The class-resource primitive's
`ResolvedClassResource.dieSize` field is the source of truth for "what
die does this roll" — `dieFromResource: 'superiority'` resolves at
encounter-runtime time, picking up Improved Combat Superiority (d10)
and Ultimate Combat Superiority (d12) automatically.

### Save DC resolver

The shape `{ calc: 'maneuver' }` is new. derive() resolves it as
`8 + PB + max(strMod, dexMod)`. The 2014 prose says STR or DEX (player
choice); 2024 prose says the same. Pick at the resolver — taking the max
matches optimal-play assumption and is the convention used by other
multi-ability DCs. Add a `data.maneuverDCAbility?: 'str' | 'dex' | 'auto'`
override on the feature row so the player can pin a choice if they want.

### Sheet UI sketch

The character sheet grows two panels (or a stacked single panel):

1. **Maneuvers panel.** Renders one card per *picked* maneuver, with
   the name, prose blurb, and a die-cost badge ("1 superiority die,
   currently d8"). When a maneuver has a reaction cost (Riposte,
   Parry), the card shows a "Use reaction" button; on click, the
   encounter runtime evaluates the trigger conditions and surfaces the
   opportunity in the planner. When the maneuver is an on-hit rider
   (Trip, Disarming), the card shows "Apply on next hit" — the next
   attack the player declares offers a checkbox to attach the rider.
2. **Superiority Dice tracker** (lives on the class-resource panel
   shipped by the parallel workstream). Shows 4/4 d8 at L3, 5/5 d8 at
   L7, 5/5 d10 at L10, etc. Spend / refresh tracked via the existing
   `character.resourcesSpent['superiority']` counter; rests refresh via
   `ClassResourceDecl.refresh: 'short-rest'`.

The maneuver picker UI lives in `FeatureChoicesPanel.svelte`. When the
player opens Combat Superiority, they see a multi-select widget with
all `data.maneuvers[]` listed (name + 1-line prose), `picks` cap
enforced (3 at L3, +2 at 7/10/15). The widget shows "3 of 3 picked" or
"2 of 5 picked — pick 3 more" depending on level state.

### Sample maneuvers (fully authored)

Three reference shapes — `reaction-attack`, `on-hit-rider with save`,
and `damage-reduction`:

```jsonc
{
  "id": "riposte",
  "name": "Riposte",
  "description": "When a creature misses you with a melee attack, use your reaction to make a melee weapon attack. Add the superiority die to the damage on hit.",
  "cost": "reaction",
  "spendsResource": "superiority",
  "effect": {
    "kind": "reaction-attack",
    "triggerOn": "attack.targets-self.miss",
    "attackType": "melee-weapon",
    "damageRider": { "dieFromResource": "superiority", "type": "weapon" }
  }
},
{
  "id": "trip-attack",
  "name": "Trip Attack",
  "description": "On a hit, add the superiority die to damage. If the target is Large or smaller, it must make a Strength saving throw or fall prone.",
  "cost": "free",
  "spendsResource": "superiority",
  "effect": {
    "kind": "on-hit-rider",
    "damageRider": { "dieFromResource": "superiority", "type": "weapon" },
    "save": { "ability": "str", "dc": { "calc": "maneuver" },
              "onFail": { "kind": "condition", "condition": "prone" } },
    "maxTargetSize": "large"
  }
},
{
  "id": "parry",
  "name": "Parry",
  "description": "When you take melee damage, use your reaction to reduce the damage by superiority die + DEX modifier.",
  "cost": "reaction",
  "spendsResource": "superiority",
  "effect": {
    "kind": "damage-reduction",
    "triggerOn": "damage.taken.melee",
    "reduceBy": { "dieFromResource": "superiority", "addAbilityMod": "dex" }
  }
}
```

The remaining three from the original ask follow the `on-hit-rider`
shape with different `save.onFail` variants:

- **Disarming Attack** — `save: { ability: 'str', onFail: { kind:
  'drop-item', targets: 'held-item' } }`
- **Maneuvering Attack** — no `save`; pairs the damage rider with a
  separately-emitted `target-free-move` Action surfaced to a chosen
  ally.
- **Goading Attack** — `save: { ability: 'wis', onFail: { kind:
  'disadvantage-against-others' } }`.

### Phase plan

1. **Types & schema** (1-2 days). Add `ManeuverDecl` / `ManeuverEffect`
   union to `src/lib/rules/types.ts`. Extend `ClassResourceDecl` with
   `spendKind: 'die'` already covers the pool. Add `Action.spendsResource`
   and `TriggerDeclaration.spendsResource` optional fields. Add
   `{ calc: 'maneuver' }` to the save-DC resolver in derive().
2. **Choice slot** (0.5 day). Wire `choices.maneuvers` as a plural-pick
   slot in `Derived.pendingFeatureChoices`. Add a `picks` resolver that
   accepts the perClass-table shape (reuse evaluateValue's existing
   resolver path; already supports perClass tables).
3. **Synthesis** (2-3 days). Per `effect.kind`, emit Action / Trigger /
   OutboundEffect in derive(). Each branch is small (~30 lines); the
   union is 7 cases. Wire `dieFromResource` token resolution against
   `Derived.classResources`. The on-hit-rider case is the trickiest —
   needs to interact with the existing attack pipeline so the rider
   attaches to the *next attack* the player declares. Initial
   implementation: surface the rider as a separately-rollable Action
   with `gatedOnTrigger: 'attack.hit'` and let the encounter runtime
   evaluate the gate.
4. **Tests** (1-2 days). Unit tests cover: derive() synthesis of each
   effect.kind producing the expected Action / Trigger; `choices.maneuvers`
   plural pick resolution with picks-cap enforcement; superiority-die
   pool integration (PB-die sizes flowing through); save DC resolver.
   Per CLAUDE.md `feedback_engine_tests_with_changes.md`, every commit
   to `src/lib/rules/` ships a test in the same commit.
5. **Sheet UI** (1-2 days). Maneuvers panel component; checkbox grid in
   FeatureChoicesPanel. Spend / refresh integration with the
   class-resource panel.
6. **Content migration** (1 day). phb-2014/phb-2024 battle-master.json:
   convert the existing 16 `activities[]` into the `data.maneuvers[]`
   catalog on the parent `combat-superiority` row. Delete the
   redundant per-activity rows. Add the `choices.maneuvers` block.
   Run the audit; the rows promote from T1-STUB / T2 to T3-FULL.
   Eldritch Knight (variant), Martial Adept feat, Superior Technique
   FS get their single-maneuver shapes.

Total: ~7-10 days end-to-end.

### Risks + open questions

- **On-hit-rider attach UX.** The "pick a rider, then make the attack,
  and the rider applies only if the attack hits" sequence is novel.
  The encounter planner today resolves attacks atomically — the gate
  has to be evaluated *during* the attack, not as a separate planner
  action. Initial implementation can be conservative (rider is its own
  Action button the player presses *after* the attack hits, debiting
  the die retroactively). A cleaner UX waits on a planner refactor.
- **Reaction-attack budget.** Riposte uses a reaction; the planner
  doesn't have a reaction-tracker today. Either ship a minimal
  "reaction-used-this-round" boolean alongside this work, or accept
  that the player polices their own reaction budget. The trigger
  mechanic already surfaces the opportunity; spending is the gap.
- **Save DC resolver overlap.** Other features use `{ calc: 'spell' }`
  already. Adding `{ calc: 'maneuver' }` is a small extension but
  mirrors the same pattern. Long-term: the resolver could grow a
  general `{ calc: 'class-feature'; abilities: ['str','dex']; mode:
  'max' }` shape and bury maneuver/spell/ki as named instances. Out of
  scope for v1.
- **Eldritch Knight crossover.** RAW Eldritch Knights don't natively
  learn maneuvers, but a variant rule does (Superior Technique). Make
  sure the choice slot is composable across feature rows — Martial
  Adept feat (1 maneuver, +1 die) should *add* to the
  `featureChoices["combat-superiority"].maneuvers` array without
  colliding. Resolution: the choice slot key is `maneuvers` at the
  feature-row level; each feature that grants picks names its own slot
  (`choices.maneuvers` with its own `picks`), and derive() merges all
  picked maneuvers across active rows. Slot id can collide; picks
  array is per-feature-row.
- **Relentless interaction.** L15 "if you have no Superiority Dice
  remaining, roll a d8 anyway." Implementable as a class-resource
  fallback shape (`fallbackDie: 'd8'` on the ResolvedClassResource), or
  as a Trigger on `spendsResource.empty`. Out of scope for v1; ship
  the maneuver content model first, layer Relentless in a follow-up.

---

## Workstream 2 — OUT-FLUFF tier marker for the audit classifier {#workstream-2}

### Problem

The pack-audit script at
`/home/narfman0/workspace/grimoire-packs/scripts/audit.mjs` classifies
row tiers purely on structural shape:

- **T1-STUB** if no `modifiers` / `activities` / `triggers` /
  `activations` / `outboundEffects` / `spellListAdditions`.
- **T2-PARTIAL** if only `choices` is populated.
- **T3-FULL** if any of the above arrays is non-empty.

This is fine for rows whose prose has mechanical effects to encode. But
many rows are *intentionally* flavor-only:

- Subclass intro rows ("Master Sophisticated Battle Maneuvers / Battle
  Masters are students of the art of battle..." — phb-2024
  `battle-master.json` slug `battle-master`).
- Narrative species sub-features ("Your soul holds embers of the
  primal forces...").
- Section-header rows that exist only as table-of-contents anchors
  (`maneuver-options`, `maneuvers` in phb-2014).

These rows render prose in the UI but have no mechanical effect — and
shouldn't. They're stub *by policy*, not by oversight. Today they get
flagged T1-STUB forever, dragging the matrix percentages down and
generating false-positive audit work.

The fix: a **content-author-controlled tier marker**. A row tagged
`OUT-FLUFF` (or similar) should be excluded from the T1-STUB count.

The AUDIT-PLAN.md spec already defines the tier name (`OUT-FLUFF` —
"the source text has no mechanical effect to encode") at line 46. The
script just doesn't read it.

### Tier-override field shape

Three candidate locations:

1. **`data.tier_override: "OUT-FLUFF"`** — co-located with the
   mechanical arrays the audit already inspects. Simple, easy to grep
   for, matches the existing convention that `data.note` is the
   audit-trail string. **Recommended.**
2. **Top-level `tier_override`** — alongside `kind / slug / name /
   version`. Cleaner conceptually (it's metadata about the row, not
   row data) but breaks the symmetry that everything-audit-relevant
   lives under `data`.
3. **`data.audit: { tier: "OUT-FLUFF", reason?: "subclass-intro" }`**
   — namespaced block, room to grow. Future-proof for additional
   audit-only metadata (e.g. `expected_tier`, `blocked_on`). Slight
   over-engineering for a single field today.

**Recommendation: `data.tier_override: "OUT-FLUFF" | "OUT-ENGINE"`** —
shape 1. Keep it simple, add the namespaced block only when a second
audit field appears. The legal values match the existing AUDIT-PLAN.md
tier vocabulary. Other override values (T3-FULL, T2-PARTIAL,
T1-STUB) are accepted but generate a warning — pack authors shouldn't
hand-pin those, they should be derived.

OUT-ENGINE benefits from the same override mechanism: features that the
engine *can't* express (legendary actions, polymorph statblock swap
pre-engine-Phase-5b) should also be excluded from the T1-STUB count
once tagged. The same override field carries both values.

### Classifier changes

In `/home/narfman0/workspace/grimoire-packs/scripts/audit.mjs`, modify
`classifyStructural` and the tier-resolution path:

```js
function structuralTier(flags, override) {
  // Honor explicit override first.
  if (override === 'OUT-FLUFF' || override === 'OUT-ENGINE') return override;
  // Existing logic.
  if (!flags.hasMods && !flags.hasActs && ...) return 'T1-STUB';
  return 'T3-FULL';
}

// In the row-iteration loop:
const override = typeof row?.data?.tier_override === 'string'
  ? row.data.tier_override
  : null;
const tier = row.kind === 'subclass' ? null : structuralTier(flags, override);
```

The subclass roll-up at lines 191–208 already handles `'T3-FULL' |
'T1-STUB' | 'T2-PARTIAL' | 'GAP'`. Extend to skip `OUT-FLUFF` /
`OUT-ENGINE` rows when computing the parent subclass tier — they
shouldn't count *against* a subclass roll-up. New roll-up logic:

```js
const realFeatureTiers = featureTiers.filter(
  (t) => t !== 'OUT-FLUFF' && t !== 'OUT-ENGINE'
);
if (realFeatureTiers.length === 0) {
  // All flavor — subclass is also OUT-FLUFF.
  sub.rec.tier = 'OUT-FLUFF';
} else if (realFeatureTiers.every((t) => t === 'T3-FULL')) {
  sub.rec.tier = 'T3-FULL';
} else if (realFeatureTiers.every((t) => t === 'T1-STUB' || t === 'GAP')) {
  sub.rec.tier = 'T1-STUB';
} else {
  sub.rec.tier = 'T2-PARTIAL';
}
```

### Reporting

The current matrix renders cells like `30 / 0 / 0 / 30` (T3 / T2 / T1
/ total). **Recommendation:** extend to `T3 / T2 / T1 / OF / OE /
total` — separate OF and OE columns so readers can distinguish
"authored as flavor" (ship-it) from "can't encode yet" (engine-debt).
The console summary in `audit.mjs` (lines 444–447) grows parallel
OUT-FLUFF / OUT-ENGINE lines. Headline percentage should switch from
`T3 / total` to `T3 / (T1 + T2 + T3)` so OUT-* rows don't dilute the
work-remaining signal.

### Migration strategy

Two batches:

**Batch A: subclass intro rows (~70 rows).** Each subclass file in
phb-2014 / phb-2024 / tashas / xanathars typically opens with a single
flavor-only `feature` row matching the subclass slug — e.g. `battle-
master.json` slug `battle-master`, `archfey-patron.json` slug
`archfey-patron`. These are deterministic:

- Per pack, walk every `features/` JSON.
- For each row where `slug === ownerSlug` AND
  `data.modifiers/activities/triggers/activations` are all empty AND
  the description is the subclass intro paragraph (heuristic: contains
  `subclass` or matches the parent subclass row's `description`
  prefix), mark `data.tier_override = "OUT-FLUFF"`.
- Optional `data.tier_override_reason = "subclass-intro"` field for
  audit grep — defer until shape proves out.

Build a single-shot migration script:
`scripts/mark-fluff-rows.mjs` that walks every pack, identifies
candidates by heuristic, prompts (or accepts `--auto`) per candidate,
and writes the override. Idempotent — re-running picks up new rows
without churning existing ones.

**Batch B: section-anchor rows (~10 rows).** `maneuver-options`,
`maneuvers`, certain "Spells" header rows. These are pure
table-of-contents anchors and are visually distinct from
subclass-intro rows. Mark by hand or by a separate heuristic
(`name in ['Maneuvers', 'Maneuver Options', 'Spells', 'Spell List']`
AND all-empty mechanical arrays).

**Batch C: future OUT-ENGINE pin** (~80 rows). Many rows currently
sitting at T1-STUB with a `data.note` explaining the engine gap (e.g.
the Battle Master parent row's `relentless` note "no
`refund-resource` TriggerGrant variant"). Once the workstream that
unblocks them ships, the override comes off. Until then, pin
`data.tier_override = "OUT-ENGINE"` so the matrix doesn't punish.

Migration of Batch C is more selective — only mark rows whose engine
gap is documented in
`/home/narfman0/.openclaw/workspace/grimoire/docs/engine-gaps.md`. A
linter could check that every OUT-ENGINE row has a `data.note`
explaining what's blocked.

### False-positive risk + mitigation

The biggest risk: an author marks a row OUT-FLUFF when the prose
actually has encodable mechanics — the override silently buries the
engine gap.

Mitigation: **audit-time warning when an OUT-FLUFF row's description
contains mechanical-sounding keywords.** `audit.mjs` checks for
phrases like `'gain proficiency'`, `'you have advantage'`, `'deal X
damage'`, `'resistance to'`, `'temporary hit points'`, `'spell save
dc'`, `'bonus action to'`, etc. on each OUT-FLUFF row's description.
Soft warning, not an error; per-row suppress via
`data.tier_override_acknowledge: true`.

Tuning: single keywords like "gain" alone over-trigger ("Battle
Masters gain a deep understanding…"). Require multi-word phrases so
the keyword list stays usefully selective. Tune empirically once
real OUT-FLUFF rows exist.

### Phase plan

1. **Audit script changes** (0.5 day). Modify `classifyStructural`,
   `structuralTier`, the subclass roll-up logic, the console summary,
   and the matrix renderer (`support-matrix.md` cell + per-pack docs).
   Update the table-header strings.
2. **AUDIT-PLAN.md updates** (0.5 day). Document the override field,
   the OUT-FLUFF / OUT-ENGINE meanings, and the matrix cell change.
   Update the "Tier system" table at line 39 to note "OUT-* tiers can
   be pinned via `data.tier_override`."
3. **Migration tooling** (1 day).
   `scripts/mark-fluff-rows.mjs` — heuristic candidate finder for
   subclass-intro + section-anchor rows. Reads pack files in place,
   writes `data.tier_override` field, preserves JSON formatting via
   the existing audit.mjs read/write idiom. Add a `--dry-run` flag.
4. **Initial migration** (1 day, content-side). Run the script across
   phb-2014, phb-2024, tashas, xanathars, vrgr, scag. Review the
   diff. Commit per-pack so the rollback granularity is sensible.
   Expected ~70 rows marked.
5. **Linter for engine-gap pins** (0.5 day, optional). When
   `tier_override === 'OUT-ENGINE'`, require `data.note` to be
   non-empty. Warn otherwise. Soft enforcement only.

Total: ~3-4 days end-to-end.

### Risks + open questions

- **Over-marking erodes signal.** If a content author defaults to
  OUT-FLUFF for any tricky row, the matrix loses its forcing
  function. Mitigation: the mechanical-keyword warning; periodic
  spot-check audits; code-review gate on PRs that add new OUT-*
  rows.
- **Subclass roll-up semantics for all-OUT-FLUFF subclasses.** If
  every feature in a subclass is OUT-FLUFF (very unusual, only for
  pure-flavor subclasses), should the subclass roll up to OUT-FLUFF
  or T3-FULL? Recommendation: OUT-FLUFF — accurately reflects "this
  has no mechanical surface to verify."
- **Aggregation in the global percentage.** The "X% T3" headline
  number people quote should probably exclude OUT-FLUFF + OUT-ENGINE
  from the denominator — those rows aren't actionable engine work.
  Switch the headline to "T3 / (T1 + T2 + T3)" instead of
  "T3 / total". Document the change in AUDIT-PLAN.md.
- **Re-tier on engine-gap close.** When an engine gap closes,
  every OUT-ENGINE row pinned because of that gap should be revisited.
  Track by adding a `data.tier_override_blocks_on: "engine-gap-slug"`
  reverse-index field, scriptable to "find every row pinned because
  of gap X" once that gap closes. Defer until first need.
- **JSON formatting preservation in migration.** The mark-fluff
  script needs to insert a single field without reformatting the
  whole file. Either use a structure-preserving JSON writer or run
  Prettier as a post-step. Pack repo's existing tooling preference
  determines which.

---

## Workstream 3 — dnd-5e-srd spell-pack expansion {#workstream-3}

### Problem

The SRD spell pack at
`/home/narfman0/.openclaw/workspace/grimoire/content-packs/srd-5.2/spells/`
currently has **48 spells** across all levels:

| Level   | Spells |
| ------- | ------ |
| cantrip |     10 |
| 1st     |     11 |
| 2nd     |      7 |
| 3rd     |      7 |
| 4th     |      5 |
| 5th     |      3 |
| 6th     |      2 |
| 7th     |      1 |
| 8th     |      1 |
| 9th     |      1 |
| **Total** | **48** |

Many `spellListAdditions` entries on pack subclass rows reference
spells that don't exist as slugs in the pack — `archfey-patron.json`
explicitly notes: "Missing from SRD pack: calm emotions, blink, plant
growth, dominate beast, dominate person, seeming". `phb-2024/features/
war-domain.json` notes: "Pack-side spellListAdditions for
shield-of-faith / spiritual-weapon (when SRD slugs land) would surface
them as always-prepared too." Same gap for detect-thoughts,
dispel-magic, guiding-bolt, lesser-restoration, dimension-door, and
many more.

These pack rows can't ship full spell-grant mechanics until the spell
slugs resolve. The fix is to grow the SRD spell pack to comprehensive
5e coverage — roughly 300 spells per RAW.

### Target list

Three options:

1. **Minimum:** ~50 spells. Hand-pick exactly the slugs called out in
   pack notes (`grep -rn "Missing from SRD pack\|when SRD slugs land"`
   the grimoire-packs repo, dedupe). Smallest delta; unblocks every
   currently-documented gap; doesn't future-proof.
2. **Comprehensive:** ~300 spells. Full SRD 5.1/5.2 coverage. Future
   pack rows reference any standard spell without authoring blockers.
3. **Hybrid:** Phase 1 ships all ~300 as prose stubs (slug + name +
   level + school + cast time + range + components + duration +
   description, but no `activities[]`). Phase 2 hand-authors
   `activities[]` + `upcastScaling` on the ~30 high-impact spells
   (Fireball, Counterspell, Misty Step, Cure Wounds, etc.). Phase 3
   backfills the long tail of activities over time.

**Recommendation: Hybrid.** Phase 1 closes the spellListAdditions gap
(slugs resolve, name/description renders on the sheet) at scale.
Phase 2 makes the most-used spells fully mechanically supported. Phase
3 is opportunistic — each pack-row audit batch that wants a new spell
upgrades it from stub to full.

### Authoring shape

The engine reads spells from `content-packs/srd-5.2/spells/*.json`,
one file per level. Existing rows (cure-wounds, magic-missile,
fireball, eldritch-blast) are reference implementations of the full
shape. Fields:

- **Identity:** `kind: 'spell'`, `slug`, `version`, `name`.
- **Header (Phase 1):** `data.level: 0-9`, `school`, `castingTime`,
  `range: {value, units: 'ft'|'self'|'touch'|'sight'|'mile'}`,
  `components: ['v','s','m']`, `materialComponent?` (free text),
  `duration` ('instantaneous' | '1 minute' | '8 hours' | …),
  `concentration?`, `ritual?`, `description`, `classes?: string[]`.
- **Mechanics (Phase 2/3):** `data.activities[]` with `id / type
  ('attack'|'save'|'utility'|'heal'|'damage') / cost / attack / save /
  damage / heal / target / modifiers / appliedModifiers /
  scalesWithSlotLevel / upcastScaling`. See
  `src/lib/rules/types.ts:423` (Action) and `:503` (UpcastScaling)
  for the full shapes.

**Phase 1 (slug-stub)** ships only the header fields — no
`activities[]`. The spell renders on the sheet as known/prepared, the
player gets a non-automated "Cast" button, and every referencing
`spellListAdditions` resolves.

### Upstream mapping

Source of truth: `/home/narfman0/workspace/dnd-5e-srd/5esrd.json`. This
is the consolidated SRD 5.1 prose-as-JSON dump. Each spell is keyed by
its display name under the per-class spell-list sections AND in the
"Spell Descriptions" section (the actual per-spell prose lives
in the descriptions section).

Sample upstream shape (verified at line 9713):

```json
"Cure Wounds": {
  "content": [
    "*1st-level evocation*",
    "**Casting Time:** 1 action",
    "**Range:** Touch",
    "**Components:** V, S",
    "**Duration:** Instantaneous",
    "A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier...",
    "***At Higher Levels.*** When you cast this spell using a spell slot of 2nd level or higher..."
  ]
}
```

The `content` array's first 5 entries are the header block — predictable
shape — and the rest is the description prose. The import script
parses these into engine fields:

| Upstream                                  | Engine field                                  |
| ----------------------------------------- | --------------------------------------------- |
| `"Cure Wounds"` (key)                     | `name: "Cure Wounds"`, `slug: "cure-wounds"`  |
| `"*1st-level evocation*"`                 | `level: 1`, `school: "evocation"`             |
| `"**Casting Time:** 1 action"`            | `castingTime: "action"`                       |
| `"**Range:** Touch"`                      | `range: { value: 0, units: "touch" }`         |
| `"**Components:** V, S, M (a sprig of mistletoe)"` | `components: ["v", "s", "m"]`, `materialComponent: "a sprig of mistletoe"` |
| `"**Duration:** Concentration, up to 1 minute"` | `duration: "1 minute"`, `concentration: true` |
| body lines                                | `description: "..."` (joined with `\n`)       |
| `"***At Higher Levels.***"` paragraph     | parsed into `upcastScaling` for Phase 2 only  |

Class lists for each spell live in the per-class sections of `08
spellcasting.json` ("Wizard Spells" → "3rd Level" → ["Fireball", ...]).
The import script inverts these maps:

```
spellsByName: Map<spellName, classList[]>
```

…and emits `data.classes: ["wizard", "sorcerer", "warlock"]` on each
spell. Subclass-spell-list additions (e.g. Devotion paladin) live in
their own `subclassSpells` blocks but are out of scope for the engine
spell pack — those are pack-side additions via `spellListAdditions`.

### Automation strategy

Build `/home/narfman0/.openclaw/workspace/grimoire/scripts/import-spells.mjs`:

```js
// Reads /home/narfman0/workspace/dnd-5e-srd/5esrd.json
// Writes content-packs/srd-5.2/spells/<level>.json (one file per level)
//
// CLI:
//   node scripts/import-spells.mjs --dry-run
//     Print proposed JSON to stdout, no writes.
//   node scripts/import-spells.mjs --phase 1
//     Slug-stub only. Skip spells already in the pack (preserves
//     hand-authored activities on the 48 existing spells).
//   node scripts/import-spells.mjs --phase 2 --spells fireball,counterspell,misty-step
//     Adds activities + upcastScaling to named spells. Reads
//     existing JSON, merges activities, writes back. Idempotent.
//   node scripts/import-spells.mjs --classes
//     Re-derive the classes[] array on every spell from upstream
//     class spell lists.
```

Phase 1 parser is deterministic — header lines are regex-matched, body
is the joined remainder. Phase 2 needs hand-curation; the script
*emits a stub `activities: []` entry and a `// TODO` comment block*
pointing at the upstream text the author should review.

Idempotency: the script must preserve hand-authored fields. Strategy:
load the existing pack row, deep-merge the new computed prose fields
(name, description, level, school, …) over the existing rec while
preserving `activities`, `upcastScaling`, and any author-added fields
under `data.*`. The existing 48 spells must not regress.

### Quality gate

Phase 1 trust level: high. The upstream prose is canonical SRD; the
parse is mechanical; the engine consumes only display fields. Manual
review: spot-check 10 spells across schools / levels for prose
fidelity (no broken markdown, no half-cut paragraphs from the parser).
Smoke test: load every spell row through the existing pack-loader
(`/home/narfman0/.openclaw/workspace/grimoire/src/lib/.../pack-loader.ts`
— or whatever the entry path is) and verify no schema errors.

Phase 2 trust level: case-by-case. Each hand-authored spell needs:
- The right `activities[].type` (attack/save/utility/heal/damage).
- The right `damage.parts` formulas matching the prose.
- The right `target.affects` / `target.count`.
- For scaling spells, the right `upcastScaling.extra*PerSlot` keys
  matching the "At Higher Levels" prose.

Cross-check against the existing 48 hand-authored rows for shape
consistency — `cure-wounds`, `magic-missile`, `fireball`, `eldritch-blast`,
etc. are reference implementations.

### Phasing

**Phase 1: bulk slug-stub import (~250 new spells, ~1 day).**
- Run `import-spells.mjs --phase 1` end-to-end.
- Result: every SRD spell exists as a row with slug + name + level +
  school + cast time + range + components + duration + description.
- Pack rows referencing previously-missing slugs (`detect-thoughts`,
  `plant-growth`, `dimension-door`, etc.) now resolve.
- Spell-picker UIs show every spell.
- Engine still does nothing mechanical for unauthored spells — they
  surface as prose-only entries the player casts manually.

**Phase 2: hand-author top ~30 high-impact spells (~3 days).**
Priority by gameplay impact, each getting `activities[]` +
`upcastScaling` where applicable:

- **Damage + upcast:** Fireball, Lightning Bolt, Burning Hands,
  Scorching Ray, Shatter, Thunderwave, Spiritual Weapon, Spirit
  Guardians, Cone of Cold, Disintegrate, Inflict Wounds, Vampiric
  Touch (+ verify Magic Missile).
- **Save-or-suck:** Counterspell, Dispel Magic, Hold Person,
  Hypnotic Pattern, Banishment, Dominate Person, Polymorph (engine
  shipped; needs activity).
- **Healing + upcast:** Mass Cure Wounds, Mass Healing Word, Heal,
  Lesser Restoration, Greater Restoration (+ verify Cure Wounds /
  Healing Word).
- **Movement:** Misty Step, Dimension Door, Teleport.
- **Buffs (activation/receivedBuffs):** Bless, Aid, Heroism.

**Phase 3: backfill long tail (opportunistic, ~3-6 months ambient).**
Every pack-row audit batch that wants a previously-unauthored spell
upgrades it then. By the time the pack audit hits 100% T3, the spell
long tail is naturally promoted to full mechanical support.

### License + attribution

Per
`/home/narfman0/.openclaw/workspace/grimoire/docs/seed-sources.md`, the
existing `srd-5.2` pack is labeled CC-BY 4.0 (the WotC April 2025 SRD
5.2.1 release). The upstream
`/home/narfman0/workspace/dnd-5e-srd/LICENSE` is OGL 1.0a (SRD 5.1).

**These are different licenses on different source revisions.**

Two paths:

1. **Use the 5.2.1 source directly.** WotC's April 2025 release is
   downloadable as a structured document and is CC-BY 4.0. Reuse the
   existing pack slug `srd-5.2`. Attribution per seed-sources.md line
   55 is already in place. **Recommended.** Risk: the import script
   has to parse the new release format rather than the existing
   dnd-5e-srd repo's JSON dump. Lift on parser side, win on licensing
   side.
2. **Ingest from the OGL 5.1 dump (current dnd-5e-srd repo).** Faster
   to parse (the JSON is ready). Means the pack actually ships *5.1*
   content under an OGL notice; relabel the pack `srd-5.1` and add an
   OGL 1.0a attribution block per seed-sources.md guidance for
   OGL sources (currently a TODO in that doc — needs filling in).

**Recommendation: switch to the 5.2.1 CC-BY source.** The current
pack is already labeled 5.2.1; ingesting from a 5.1 OGL dump would
quietly mislabel content. The 5.2.1 source isn't in
`/home/narfman0/workspace/dnd-5e-srd` today — but it's downloadable
from WotC and parseable. The import script's `--source` flag lets us
point at either.

Attribution requirements (CC-BY 4.0): visible attribution in the UI
footer or `/legal` page. seed-sources.md line 49–58 already lists the
boilerplate. Confirm it covers spell content; spells are explicitly
listed in seed-sources.md line 15 ("**Primary v1 seed.** 9 species, 12
classes (one subclass each), ~48 feats incl. GWM, all SRD spells").

No further per-spell attribution needed (CC-BY doesn't require
per-row credit, just visible source-level credit).

### Phase plan

1. **Import script skeleton** (1 day). `scripts/import-spells.mjs`
   with `--dry-run` / `--phase` flags. Parser for the upstream
   spell-content shape. Class-list inversion. Idempotency / merge
   logic.
2. **Phase 1 bulk import** (0.5 day). Run script, review diff,
   commit. ~250 new spell rows added.
3. **Pack-side audit re-run** (0.5 day). Re-run grimoire-packs audit;
   the long list of `spellListAdditions` rows with gap notes now
   surface as resolvable. Update the pack notes (drop "Missing from
   SRD pack" lines).
4. **Phase 2 hand-authoring** (3 days). Top 30 spells: Fireball,
   Counterspell, Misty Step, Bless, Aid, Heroism, Hold Person,
   Hypnotic Pattern, Spirit Guardians, Spiritual Weapon, Vampiric
   Touch, Cone of Cold, Scorching Ray, Thunderwave, Shatter,
   Lightning Bolt, Burning Hands, Inflict Wounds, Disintegrate,
   Polymorph (cast-side; engine-side shipped), Banishment, Dominate
   Person, Dimension Door, Teleport, Mass Cure Wounds, Mass Healing
   Word, Heal, Lesser Restoration, Greater Restoration, Dispel
   Magic. Hand-author per spell.
5. **Tests** (1 day, ambient). Unit tests for each Phase 2 spell:
   derive() produces the expected Action shape; upcastScaling
   resolves correctly at slot N. Sample tests already exist for
   cure-wounds, magic-missile.
6. **Phase 3 long-tail backfill** (ongoing). No fixed schedule —
   opportunistic per pack-audit-batch.

Total: ~5-6 days for Phases 1+2.

### Risks + open questions

- **License confusion.** If we ingest from `/home/narfman0/workspace/
  dnd-5e-srd` (OGL 1.0a) and label the result `srd-5.2` (CC-BY),
  we've mislabeled. Must either (a) source from the actual 5.2.1
  release or (b) relabel the pack `srd-5.1` and add OGL attribution.
  Confirm before any bulk import.
- **Spell-list ownership.** Many spells appear on multiple class
  lists; the upstream JSON has class-by-class lists, not per-spell
  classes. The inversion has edge cases (spells that appear in
  subclass-specific extensions, e.g. "Eldritch Knight gets Detect
  Magic"). Phase 1 inversion uses base class lists only;
  subclass-additions stay pack-side via `spellListAdditions`.
- **Parser fidelity on edge prose.** Material components like
  `"V, S, M (a pinch of dust)"` are easy. `"V, S, M (a diamond worth
  at least 500 gp, which the spell consumes)"` needs to capture both
  the material and the cost/consumption flag — extend the parser to
  pull `materialComponentCost: 500` and `materialConsumed: true`.
  Mostly cosmetic; can defer.
- **Duration parsing.** "Concentration, up to 1 minute" splits into
  `concentration: true` + `duration: "1 minute"`. Watch for prose
  variants: "Up to 1 minute", "Concentration, up to 10 minutes",
  "1 round", "Until dispelled". Build a small parser table.
- **Spell-slug collisions with pack content.** Some packs (PHB-2014
  Tasha's reprints) may already define `cure-wounds-alt` style
  variants. The slug namespace is `srd-5.2/spells/cure-wounds`;
  pack-side spells live under `<pack>/spells/`. No collision risk if
  the pack loader treats them as distinct sources. Confirm via
  pack-loader.md.
- **Phase 2 prioritization.** "Top 30 by gameplay impact" is a
  judgment call — the recommendation above is one defensible list.
  Re-rank by checking which spells appear in the most
  `spellListAdditions` references across packs (`grep -ho
  '"[a-z-]*"' grimoire-packs/**/spellListAdditions* | sort |
  uniq -c | sort -rn` once spellListAdditions are populated).
- **Class spell list for non-PHB classes.** Artificer, Blood
  Hunter, etc. aren't in SRD 5.1/5.2. Their spell lists live in
  pack files. Phase 1 import gets base PHB classes only; pack
  spell additions flow through unchanged.
- **The 5.2.1 release format.** If WotC ships the 5.2.1 SRD as PDF
  rather than structured JSON, the import script needs a PDF parser
  (or hand-conversion). Confirm the deliverable format before
  committing to it.

---

## Summary — execution order and dependencies

### Recommended order

1. **Workstream 2 (OUT-FLUFF marker) first.** Smallest scope (~3-4
   days), no engine changes, immediate matrix-percentage benefit, and
   it makes Workstreams 1 and 3 audit-correct as they ship (rows that
   end up legitimately OUT-* are pinned, rows that promote to T3
   flip naturally).
2. **Workstream 3 (spell-pack expansion) second.** Medium scope (~5-6
   days), no engine changes, unblocks ~6 known pack rows immediately
   and removes the "when SRD slugs land" footnote from ~10 more.
   Independent of Workstream 1; can ship in parallel if a second
   contributor is available.
3. **Workstream 1 (Battle Master maneuvers) third.** Largest scope
   (~7-10 days), real engine work, blocked on the class-resource
   primitive (currently in flight in parallel). Unblocks the most
   T1-STUB rows of any single workstream (~20 across phb-2014,
   phb-2024, Eldritch Knight, Martial Adept, Superior Technique) but
   requires the most design care.

### Biggest risks

- **Workstream 1: on-hit-rider attach UX.** The encounter planner
  doesn't have a clean "this attack but with a rider" gate today.
  Conservative initial implementation surfaces riders as separate
  follow-up actions, debiting the die after the hit resolves.
  Cleaner UX waits on a planner refactor.
- **Workstream 3: license labeling.** The current pack slug is
  `srd-5.2` (CC-BY 4.0); the upstream JSON dump is SRD 5.1 (OGL
  1.0a). Ingest from the right source or relabel. Confirm before
  bulk import — un-doing a license mislabel is painful.
- **Workstream 2: false-positive OUT-FLUFF erodes signal.** Mitigation
  is the mechanical-keyword warning, but tuning the keyword list is a
  research task in its own right. Start conservative; expand the
  list based on observed false-positive rate.

### Cross-workstream dependencies

- **None hard.** All three can ship independently.
- **Soft dependency: Workstream 2 before 1 + 3.** Marking the
  battle-master.json subclass-intro row OUT-FLUFF first means the
  Workstream-1 migration only changes T1-STUB → T3-FULL on the
  *actually-mechanical* rows. Similarly, Workstream-3's stub-spell
  import (Phase 1) wants its slug-stub rows correctly classified —
  Phase 1 spells without `activities[]` should arguably mark
  themselves T2-PARTIAL automatically (they have prose, no
  activities) which the existing classifier already handles. No
  manual marking needed for spell rows.
- **Soft dependency: Workstream 1 wants Workstream 3.** Several
  maneuvers in the 2024 prose reference spell names (e.g. Goading
  Attack interacts with spell-attack disadvantage gating). Doesn't
  block schema work; only matters at integration-test time.
- **Class-resource primitive (parallel, out of scope here) is a
  hard prereq for Workstream 1 synthesis.** The maneuver content
  model declares `spendsResource: "superiority"` and expects
  `Derived.classResources` to resolve the pool. If the primitive
  slips, Workstream 1 stalls at the synthesis step. Schema work
  (Phase 1 of Workstream 1) can proceed in parallel.
