# rules engine

`derive(character, contentLookup) → derived`. A pure function that turns a
character document plus the relevant `content` rows into a fully-resolved
sheet: stats, available actions, declared triggers, validation issues.

Lives in `src/lib/rules/` (M1.5). Runs identically on the server (for
denormalized projection writes, validation, character snapshots) and in the
browser (live sheet display).

Companion to [content-model.md](./content-model.md); read that first.

## Contract

```ts
function derive(
  character: CharacterDocument,
  content: ContentLookup
): Derived;
```

### Inputs

`CharacterDocument` — the editable state. In M1 this lives in the Drizzle
`characters` table; in M2 it becomes a Y.Doc. Shape:

```ts
type CharacterDocument = {
  id: string;
  name: string;
  alignment?: string;

  classes: ClassEntry[];            // multiclass: many entries
  species: ContentRef;
  subspecies?: ContentRef;
  background?: ContentRef;
  feats: ContentRef[];

  abilityScores: AbilityBlock;      // base, before modifiers
  inventory: InventorySlot[];
  spells: { known: ContentRef[]; prepared: string[] };

  currentHp: number;
  tempHp: number;
  hitDiceSpent: Record<string, number>;   // classSlug -> spent count
  conditions: string[];                   // ['rage', 'frightened', ...]

  modifierToggles: Record<string, boolean>;  // user-set enabled flags by modifier id
};

type ClassEntry = {
  slug: string;
  level: number;
  subclass?: string;
  hpRolledPerLevel: number[];        // for honest HP math (avg + rolls)
};

type InventorySlot = {
  contentId: string;
  version: number;
  equipped: boolean;
  attuned: boolean;
  charges?: number;
  slot?: string;
};
```

`ContentLookup` — pre-resolved map. The caller (a SvelteKit `load` or a
unit test) is responsible for fetching every content row the character
references and putting them in the map. The engine never does I/O.

```ts
type ContentLookup = (ref: ContentRef) => ContentRow | undefined;
```

### Output

```ts
type Derived = {
  stats: StatBlock;
  actions: Action[];
  triggers: TriggerDeclaration[];
  resources: Resource[];
  validations: ValidationIssue[];
};
```

- `stats` — composed ability scores, saves, skills, AC, HP, speeds,
  proficiency bonus, initiative, passive perception, spell DC/attack, slots.
- `actions` — fully-realized usable actions for the current state (every
  attack, every spell, every utility). Each carries its attack bonus,
  damage roll, range, cost, and any applicable action-modifiers tagged.
- `triggers` — declarations the UI uses to react to events. `derive()`
  doesn't fire triggers itself; it just lists what's *registered*. (Pending
  triggers — ones that have fired and await player decision — live in
  separate session state, not in the document.)
- `resources` — hit dice, ki, channel divinity, sorcery points, spell
  slots (used/max), exhaustion level.
- `validations` — multiclass prereq failures, attunement-over-3, prepared
  spells over limit, missing required choice (e.g., Fighting Style not
  picked). Surfaced in UI as warnings; they don't block edits.

### Determinism

`derive` is a **pure function**. No DB calls, no clock reads, no random
draws, no `crypto.randomUUID()`. Given identical `(character, content)`,
output is byte-identical. This makes it:

- Testable from JSON fixtures (no test DB, no mocks).
- Memoizable on the client (`$derived` in Svelte).
- Reproducible across server and client (same TS module imported both places).

Rolls (initiative, damage, attacks) happen elsewhere. The engine produces the
formulas; UI rolls them or hands them off to the dice roller.

## Phases

```
            ┌────────────────────────────┐
input ───►  │ 1. resolve active content  │
            └─────────────┬──────────────┘
                          ▼
            ┌────────────────────────────┐
            │ 2. compose stat block      │  (stat-modifiers by priority)
            └─────────────┬──────────────┘
                          ▼
            ┌────────────────────────────┐
            │ 3. assemble activities     │  (per active item/feature/spell)
            └─────────────┬──────────────┘
                          ▼
            ┌────────────────────────────┐
            │ 4. apply action-modifiers  │  (predicate match, tag)
            └─────────────┬──────────────┘
                          ▼
            ┌────────────────────────────┐
            │ 5. register triggers       │
            └─────────────┬──────────────┘
                          ▼
            ┌────────────────────────────┐
            │ 6. validate                │
            └─────────────┬──────────────┘
                          ▼
                       Derived
```

### Phase 1: resolve active content

Walk every `ContentRef` on the character (species, subspecies, background,
classes, feats, inventory items, prepared spells, conditions). For each
referenced row, decide if it's **applicable** right now:

| Source             | `applicable` if…                                                    |
| ------------------ | ------------------------------------------------------------------- |
| species/subspecies | always (one of each, locked at creation)                            |
| background     | always                                                                  |
| class          | `level ≥ 1`                                                             |
| class feature  | `featureLevel ≤ classLevel ≤ featureMaxLevel`                           |
| feat           | always once selected                                                    |
| item           | `equipped && (!requiresAttunement || attuned) && (charges ?? 1) > 0`   |
| spell          | prepared casters: `slug ∈ character.spells.prepared`; spontaneous: known |
| condition      | `slug ∈ character.conditions`                                          |

Output of this phase: a flat list of every modifier on every applicable
content piece, plus its source metadata (for UI traceability).

### Phase 2: compose stat block

Start from `character.abilityScores` (raw). Walk `stat-modifier`s whose
`active = enabled && applicable`. Group by `target`; sort each group by
`priority` ascending. Apply in order:

```
for target in modifiersByTarget:
  current = baseValue(target)
  for mod in sortedByPriority(modifiersByTarget[target]):
    current = applyMode(current, mod.mode, evaluate(mod.value))
  stats[target] = current
```

`applyMode` covers ADD / MULTIPLY / OVERRIDE / UPGRADE / DOWNGRADE / CUSTOM
per [content-model.md](./content-model.md#1-stat-modifier-passive-always-on-while-active).

Then compute **derived** stats from the composed primitives:

- **Ability modifier**: `floor((score - 10) / 2)`.
- **Proficiency bonus**: from total character level (5e standard table).
- **Save bonus**: `abilityMod + (proficient ? profBonus : 0)`.
- **Skill bonus**: `abilityMod + (proficient ? profBonus : 0) * (expertise ? 2 : 1)`.
- **AC**: armor formula (varies: `unarmored ? 10 + dex + (con|wis) : armorBase + maybeDex(cap?) + shield`). Stat-modifiers can `ADD`/`OVERRIDE` AC directly.
- **HP max**: `sum(perLevelRoll + conMod)` across class levels + flat HP modifiers (Tough, Hill Dwarf).
- **Speeds**: per-mode; modifiers can `ADD`, `OVERRIDE`, or set new modes.
- **Initiative**: `dex.mod + initiative.bonus`.
- **Passive perception**: `10 + perception.bonus`.
- **Spell save DC / attack**: `8 + profBonus + spellAbilityMod` / `profBonus + spellAbilityMod`.
- **Spell slots**: multiclass caster formula (see Multiclass below).

Stats at the end of phase 2 are read-only for the rest of the run.

### Phase 3: assemble activities

For every applicable content piece, collect its `data.activities[]` (and
the per-feature/per-spell activities recursively). For each, resolve a
concrete `Action`:

```ts
type Action = {
  id: string;                        // unique within this derive
  sourceContent: ContentRef;
  name: string;
  cost: ActivityCost;
  type: ActivityType;
  // resolved numeric fields, with no further computation needed by UI:
  attackBonus?: number;
  damageRolls?: DamageRoll[];        // each {formula, type}
  saveDC?: { ability: string; value: number };
  range?: { value: number; units: string };
  // for UI traceability:
  appliedModifiers: AppliedModifier[];
};
```

For weapon attacks: `attackBonus = abilityMod + profBonus + attack.bonus.{melee|ranged} + weapon's stat-modifiers`. Ability used by finesse/ranged rules:
- Melee weapon, not finesse → STR
- Ranged weapon → DEX
- Finesse → max(STR, DEX)
- Spell attack → spellcasting ability

For spells: cast-time activities; damage roll formulas; save DCs from
phase-2 spell DC.

### Phase 4: apply action-modifiers

For each action assembled in phase 3, walk every active `action-modifier`
(`active = enabled && applicable`). For each, check its `appliesTo.predicates`
against the action's context (weapon properties, attack range, proficiency,
spell level, …). If every predicate matches:

- Apply the modifier's `effects[]` to the action's resolved fields
  (`attackBonus`, `damageRolls`, save DC, range, etc.).
- Append a `{ modifierId, sourceContent, name }` entry to the action's
  `appliedModifiers` array for UI display.

This is where GWM's −5/+10 lands when the user has flipped the toggle on.

### Phase 5: register triggers

Walk every applicable content's `triggers[]`. Emit one
`TriggerDeclaration` each:

```ts
type TriggerDeclaration = {
  id: string;
  sourceContent: ContentRef;
  name: string;
  on: EventName[];
  scope: PredicateBlock;
  grants: { ... };
  limit?: { per: 'turn'|'round'|'short-rest'|'long-rest'|'day'; uses: number };
};
```

The engine doesn't simulate events. UI (or a future combat tracker) calls
the events, matches them against `on + scope`, and shows the player the
appropriate options ("You crit — would you like to use Cleave?"). v1 does
not include the auto-resolver.

### Phase 6: validate

Soft checks. Emit `ValidationIssue[]`; never throw:

- Multiclass prereqs not met (`paladin` needs `str ≥ 13 && cha ≥ 13`).
- Feat prereqs not met (GWM needs `str ≥ 13`).
- Attunement: `attunedCount > attunementMax` (default 3; Artificer raises via a CUSTOM modifier).
- Prepared spells > prepared limit.
- Required choices unmade (Fighting Style at L1, Martial Archetype at L3).
- Equipment proficiency mismatches (wearing heavy armor without proficiency → "disadvantage on STR/DEX checks while worn").
- Inventory slots over-allocated (two-handing while wielding a shield, …).

UI surfaces these as banners; they don't prevent saves. Players sometimes
break rules on purpose, and that's the DM's problem.

## Multiclass

- **Total character level** = `sum(classes[].level)`. Drives proficiency
  bonus, ASIs.
- **Proficiency bonus** comes from total level, not per-class.
- **Hit Dice** tracked per class (different die sizes per class).
- **HP** is `sum(perLevelRoll + conMod)`; the perLevelRoll array on each
  ClassEntry encodes "took avg" vs "rolled a 7" honestly.
- **Multiclass spell slots**: caster level = `Σ classWeight * level` rounded
  down, where weight is `1` (full caster: Bard/Cleric/Druid/Sorcerer/Wizard),
  `0.5` (half caster: Paladin/Ranger), `1/3` (third caster: Eldritch Knight,
  Arcane Trickster). Use the standard 5e multiclass-caster slot table on the
  computed level. **Pact slots** (Warlock) are tracked separately and never
  combined.
- **Class features**: at every (class, level-in-that-class), include that
  class's features for that level. Multiclassing a Fighter 5 / Wizard 1 gets
  Fighter L5 features (Extra Attack) + Wizard L1 features (Arcane Recovery).
- **Prereqs** are validated by phase 6; they don't block selection at the
  document level (the editor UI does), so the engine reports them rather
  than rejecting the character.

## Active state derivation, in code

```ts
function isActive(mod: Modifier, character: CharacterDocument, source: ContentRow): boolean {
  const enabled =
    character.modifierToggles[mod.id]
    ?? mod.defaultEnabled
    ?? true;
  const applicable = isApplicable(mod, character, source);
  return enabled && applicable;
}

function isApplicable(mod: Modifier, c: CharacterDocument, src: ContentRow): boolean {
  // structural eligibility from the source content
  if (src.kind === 'item') {
    const slot = c.inventory.find(i => i.contentId === src.id);
    if (!slot || !slot.equipped) return false;
    if (src.data.requiresAttunement && !slot.attuned) return false;
    if (src.data.uses && (slot.charges ?? 0) <= 0) return false;
  }
  if (mod.minLevel != null && totalClassLevel(c, src) < mod.minLevel) return false;
  if (mod.condition && !c.conditions.includes(mod.condition)) return false;
  // ...
  return true;
}
```

## Test fixtures

Fixtures live at `src/lib/rules/__tests__/fixtures/*.json`. Each is a
`{ name, character, contentLookup, expected }` quadruple — the `expected`
is a partial deep-match against `derive()` output. Canonical builds for v0:

1. **Fighter 5 / Greatsword / GWM** — the spec test. Two scenarios per
   fixture: Power Attack off (`+7 / 2d6+3`), Power Attack on (`+2 / 2d6+13`).
   Trigger registered for `attack.crit` + `attack.reduce-to-zero`.
2. **Lore Bard 3** — spell DC, spell attack, slots, Bardic Inspiration.
3. **Life Cleric 3** — spell prep, Disciple of Life damage tweak via stat-modifier.
4. **Open Hand Monk 3** — unarmored defense AC formula, Martial Arts die, Ki points.
5. **Rogue 3 (Thief)** — Sneak Attack as a level-gated damage activity, Cunning Action bonus utility.

A fixture passing means the engine handled stat composition + activity
assembly + action modifiers + a couple of declared triggers for that build.
Failures should be precise enough to diagnose without printing the whole
output (use a deep-match library like `expect-objectcontaining`).

## What v0 does not handle

Deliberate cuts to keep M1.5 shippable:

- **Polymorph / Wild Shape**: full statblock replacement. v2: a "form
  overlay" that supersedes phase-2 output entirely.
- **Concentration tracking**: validation only; no auto-drop on damage.
- **Combat-time context** (cover, advantage from terrain, target conditions):
  the UI passes these as ad-hoc per-attack modifiers; engine doesn't store them.
- **Auto-resolving triggers**: declared only. The UI presents pending
  triggers from declared `on` events; no automatic chain (e.g., GWM crit →
  bonus attack → crit → bonus attack) without the player clicking.
- **Reactions during another creature's turn**: surfaced as available
  triggers based on the declarative `on:` set, but timing is the players'
  problem, not the engine's.
- **Short/long rest recovery**: the engine emits `resources` rows with
  `{max, used, per}` but doesn't simulate rest cycles itself. Resetting
  `used` counters, HP, and hit-dice-spent on rest is UI work — lands in
  the C "editable sheet" milestone as a pair of rest buttons.

## Related

- [content-model.md](./content-model.md) — the catalog and modifier DSL the
  engine reads.
- [seed-sources.md](./seed-sources.md) — where seed content comes from.
