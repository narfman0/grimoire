# rules engine

`derive(character, contentLookup) → Derived` — a pure function that turns a character document plus the relevant content rows into a fully-resolved sheet.

Source: `src/lib/rules/derive.ts`. Runs identically on the server and in the browser (same module imported both places). Tests: `src/lib/rules/__tests__/`.

## Contract

**Input:** a `CharacterDocument` (the mutable character state) and a `ContentLookup` (a pre-resolved map of every content row the character references). The engine never does I/O — the caller fetches content and passes it in.

**Output:** a `Derived` object containing:
- `stats` — composed ability scores, saves, skills, AC, HP max, speeds, proficiency bonus, initiative, passive perception, spell DC/attack bonus, spell slots
- `actions` — fully-resolved usable actions (attacks, spells, utilities) with attack bonus, damage rolls, range, cost, and applied modifier tags
- `triggers` — declarative trigger registrations (what becomes available when an event fires); the engine lists them, it does not fire them
- `resources` — per-rest expendables (ki, channel divinity, bardic inspiration, etc.) with used/max counts
- `validations` — soft warnings (multiclass prereqs, attunement over limit, prepared spells over cap); never block saves

Type shapes are in `src/lib/rules/types.ts`.

## Phases

1. **Resolve active content** — walk every `ContentRef` on the character (species, background, classes, feats, inventory items, prepared spells, conditions). Determine which are currently applicable (equipped, level-gated, condition-gated, etc.).
2. **Compose stat block** — apply `stat-modifier` entries in priority order (ADD / MULTIPLY / OVERRIDE / UPGRADE / DOWNGRADE / CUSTOM) per target path. Stats are frozen after this phase.
2.5. **Cross-row upgrades** — apply `upgrade.<rowSlug>.<path>` modifiers into a copy-on-write clone of the target row's `data`, so phases 3+ read the upgraded declaration (see [Cross-row upgrades](#cross-row-upgrades)).
3. **Assemble activities** — for each applicable content piece, build concrete `Action` objects with resolved numeric fields (attack bonus, damage formula, save DC, range).
4. **Apply action modifiers** — match `action-modifier` predicates against each action's context; apply effects and tag the action for UI display.
5. **Register triggers** — collect `trigger` declarations into `TriggerDeclaration` objects. No events are fired here.
6. **Validate** — emit soft `ValidationIssue` entries for constraint violations.

## Determinism

`derive` is a pure function — no DB calls, no clock reads, no random draws. Given identical inputs, output is byte-identical. This makes it testable from JSON fixtures, memoizable on the client, and reproducible across server and browser.

## Multiclass

Total character level drives proficiency bonus and ASIs. Spell slots use the standard multiclass caster formula (full / half / third caster weights). Hit dice are tracked per class. The multiclass slot helpers (`slotsFor`, `fullCasterSlots`, `halfCasterSlots`, `thirdCasterSlots`, `pactCasterSlots`, `artificerCasterSlots`) live in `src/lib/rules/derive.ts`.

## Item activity model

### Charge pools

An equipped item with `data.charges` emits one shared resource, id `item/<slug>/charges`, name `<Item Name> Charges`. Three authoring shapes are accepted (normalized by `normalizeItemCharges` in `derive.ts`):

```jsonc
"charges": { "max": 7, "recharge": { "amount": "1d6+1", "per": "dawn" } }  // engine-native
"charges": { "max": 3, "per": "day" }                                       // legacy display — day/dawn → dawn
"charges": 6, "recharge": "dawn"                                            // 5etools flat + sibling recharge
```

`max` accepts any `evaluateValue` shape. `recharge.per` is `'dawn' | 'long-rest' | 'short-rest' | 'week'`; `recharge: "never"` (or a flat shape with no recharge sibling) never refills on rest. `recharge.amount` ("1d6+1") is stored and displayed, but v1 resets the pool to max at the cadence — partial recharge rolls are a follow-up.

An activity that declares `chargeCost: N` debits the pool: its Action carries `spendsResource: 'item/<slug>/charges'` and `resourceCost: N`. Variable-cost items author sibling activities with different chargeCosts. An activity with its own `uses` block keeps its independent per-activity counter and never attaches to the pool.

Rest cadence is shared across all reset sites via `src/lib/rules/rest.ts`: a long rest resets `per` ∈ {`long-rest`, `short-rest`, `day`, `dawn`}; a short rest resets only `short-rest`; `never` is never reset.

`per: 'week'` (night-caller, cauldron of rebirth; the 5etools sibling string `"7 days"` normalizes to it) is deliberately **not** reset by any rest — a rest never spans a week, and the sheet has no calendar. The player restores a weekly pool manually via the resource counter when the in-fiction week has passed. Activity-level `uses: { per: 'week' }` behaves identically.

### Fixed attack bonus

When an activity's `attack.bonus` is a literal number, the Action uses it verbatim — no ability mod, no proficiency, and no ability mod folded into the damage formula (Ring of the Ram: `{"bonus": 7, "damage": [{"dice": "2d10", "type": "force"}]}` → +7 to hit, 2d10 flat). `attack.ability` may be absent in this shape; `attackAbility` stays unset, so weapon crit riders don't attach. When `attack.bonus` is absent the derived ability + proficiency path is unchanged.

### cast-spell overrides

`spellOverrides: { saveDC?, attackBonus? }` on a `cast-spell` activity applies after the referenced spell's activity is inlined — the literal replaces the character-derived DC / attack bonus ("this item casts Fireball, save DC 15"). Only the cast-spell path honors it; plain `save` activities already express a literal DC via `save.dc.value`.

### Attunement gating

Item refs carry their inventory slot's equipped/attuned state, and `appliesWhen.requires` gates item-sourced modifiers, triggers, activities, activations, and charge pools:

- `"equipped"` — baseline (only equipped items produce refs at all)
- `"equipped:attuned"` — additionally requires the slot to be attuned
- `"equipped:offHand"` — v1: treated as plain equipped (no hand model yet)

An item row with `requiresAttunement: true` whose slot is not attuned is inert wholesale unless an individual entry declares `requires: "equipped"` explicitly (a property that works while merely holding the item). An unattuned attunement weapon still falls back to the synthesized mundane weapon attack when the row carries a `damage` string.

### Activity types

`realizeActivity` treats unrecognized `type` strings as `utility`; phase 6 emits an `unknown-activity-type` soft warning for anything outside {`attack`, `save`, `damage`, `heal`, `cast`, `cast-spell`, `utility`, `summon`, `maneuver-rider`}. Absent `type` intentionally defaults to utility without warning.

### Summon activities

A `type: 'summon'` activity (any content kind; items are the usual driver) declares the creatures it brings out:

```jsonc
{
  "id": "blow-horn", "name": "Blow the Horn", "type": "summon",
  "cost": "action", "chargeCost": 2,          // or "uses": { "max": 1, "per": "day" }
  "summon": {
    "creatures": [
      { "slug": "goblin", "count": 3 },        // count: number | evaluateValue string; default 1
      { "slug": "orc", "name": "Warband Leader" }
    ],
    "choice": false,                            // true → player picks ONE entry; false/absent → all together
    "duration": { "value": 1, "units": "hour" } // display-only, ActivationDuration shape
  }
}
```

Resolution: the Action carries `summons: { creatures: [{ slug, count, name?, resolvedName? }], choice, duration? }`. `count` is `evaluateValue`-resolved (magic strings like `proficiencyBonus` work); `resolvedName` is the monster row's name when the `ContentLookup` resolves `{kind: 'monster', slug}`. The sheet's Companions panel renders a Summon button per action (per creature when `choice` is true) that appends `CompanionState` entries to `character.companions` — HP snapshotted from the monster row's `hp.max`/`hp.average` when available, a 0-HP shell the DM edits otherwise — debiting the activity's charge pool or `uses` resource in the same write. Cost integration, attunement gating, and the `uses`-vs-`chargeCost` exclusivity all compose exactly like other activity types.

Warning semantics: an unresolvable creature slug emits a `summon-missing-content` soft warning. This is deliberately **not** an `unknown-*` code — the packs QC gate hard-fails T3 rows on `unknown-*`, and a summon may legitimately reference a monster shipped in another pack or in operator homebrew that a partial lookup can't see. The action still realizes either way.

### Item choice slots

An item row can declare per-inventory-slot player picks via `data.choices` — the pick lives on the `InventorySlot` (`slot.choices`), not the content row, so two copies of a Spell Scroll hold different spells. v1 engine-read slots:

```jsonc
"choices": {
  "spell":      { "label": "Inscribed spell", "maxLevel": 3, "allowedLevels": [1, 2, 3], "allowedClasses": ["wizard"], "allowedSchools": ["evocation"] },
  "baseWeapon": { "label": "Base sword", "allowedCategories": ["sword"] }
}
// slot.choices.spell      = "fireball"    (a spell slug)
// slot.choices.baseWeapon = "longsword"   (any corpus weapon row — NOT necessarily in inventory)
```

The allow-list fields are declaration metadata for the picker UI; the engine records the pick without validating it (same posture as feature choices). Any other slot name is a generic pass-through — declared, surfaced, and stored, but not interpreted.

A `cast-spell` activity references a pick parametrically: `spell: { "fromChoice": "spell" }` resolves the picked slug at realize time and composes with `spellOverrides` and `chargeCost` exactly like a literal ref. With no pick recorded, the action still realizes as a stub carrying `Action.needsChoice: '<slot name>'` (no inlined attack/save/damage, **no warning**).

`Derived.pendingItemChoices` is the manifest: one entry per (inventory slot, choice slot) pair on every equipped item with a `data.choices` declaration — `{ slotIndex, itemSlug, itemName, choice, declaration, picked? }`. `slotIndex` is the position in `character.inventory` where the sheet writes the pick back; `picked` is absent when unresolved. Entries surface regardless of attunement (recording a pick is setup, not effect); unequipped items surface nothing.

### Base-weapon binding

`data.baseWeaponFromChoice: true` (implies a `baseWeapon` choice slot) marks a generic-variant weapon — a Flame Tongue "any sword" whose bound longsword IS a longsword. With a pick recorded, the item's attack is synthesized FROM the base weapon's row:

- The base row's authored `type: 'attack'` activity (SRD weapons author full activities) is renamed onto the item and realized against **merged data** — the base's fields overlaid with the item's own (item fields win). Bases without activities fall back to flat-damage synthesis (`damage` string).
- Damage, damage type, weapon properties, and proficiency all flow from the base (`weaponType: martial-melee` makes the bound item a martial weapon), including finesse best-of ability selection.
- The item's own stat-modifiers apply to the synthesized attack: the `attack.bonus` / `damage.bonus` reroute predicates on `weapon.slug = <item slug>`, and the synthesized action's `sourceContent.slug` IS the item's slug, so the predicate matches. Phase-4 predicate matching also consults the merged data (recorded per action id), so `weapon.kind` sees the base's weaponType.
- An explicit `activities[]` on the item wins over synthesis (no double actions). Without a pick, the item contributes no attack action and `pendingItemChoices` surfaces the gap — no warning.

### Spell storage

`data.spellStorage: { "maxLevels": 5 }` (Ring of Spell Storing) turns the inventory slot into a spell container. Slot state: `slot.stored: [{ slug, level, dc?, attackBonus?, label? }]`. For an equipped, attunement-satisfying item, derive() emits one cast Action per stored entry:

- The spell row's primary activity is inlined (like `cast-spell`), then upcast to the stored `level`; `upcastScaling` is stripped from the emitted Action — the cast level is fixed by the storer, the planner must not re-scale it.
- The storer's `dc` / `attackBonus` override the wearer's derived numbers when recorded; absent, the wearer's own values stand.
- `Action.description` carries a validation-free summary: `Cast at level N from <Item> (<label>).`
- Capacity is enforced only as a soft warning: `spell-storage-over-capacity` (severity `warning`, deliberately **not** an `unknown-*` code) when Σ stored levels > `maxLevels`. The cast actions still realize.

Unresolvable stored slugs are skipped silently — a character-state gap, not a pack-authoring error.

### Creature-type wards

An activation may declare `ward: { creatureTypes: string[], radiusFt?, barrier? }` (scrolls of protection, icon of ravenloft, condensed order). It mirrors verbatim onto `AvailableActivation.ward` and the activation panel renders a compact "Wards vs fiends (5 ft radius) — DM adjudicates" line while the toggle is available. Pure display contract: the engine validates nothing (any creature-type slug is legal, homebrew included) and the runtime enforces nothing — the DM adjudicates what the ward blocks. `barrier: true` marks a physical can't-cross barrier vs a mere-hindrance ward. A malformed block (missing/empty `creatureTypes`) is dropped silently.

### Teleport shape

An activity may declare `teleport: { distanceFt?, mode? }` (boots of the winding path; shard solitaire's Rift Step). `mode` is `'line-of-sight' | 'unrestricted'`; `distanceFt` absent reads as unlimited/scene-scoped. Passes through onto `Action.teleport` and renders as a "teleport: 15 ft (line of sight)" line — positioning stays DM-adjudicated (the engine has no position model).

### Hit-dice action costs

`ActionCost` accepts `{ "hitDice": N }` (crown of the wrath bringer, delver's claws). `costLabel` renders it as "N Hit Dice"; it maps to no action-economy slot. Display-only — there is no auto-spend path for action costs, so the player debits Hit Dice manually via the sheet's per-class hit-dice row (`character.hitDiceSpent`).

## Class-resource spends and alternative costs

`ClassResourceDecl` declares the pools (Focus, Sorcery Points, Bardic Inspiration, Superiority, Psionic Energy, Channel Divinity, Wild Shape, Rage) and `Derived.classResources` resolves them. **Spending** them used to reach the engine from exactly two places — a `ManeuverDecl` and an item charge pool — so a feature that spent a pool from an activity, a trigger, or an activation had nowhere to say so and the debit stayed manual.

Any activity, trigger, or activation may now declare the spend directly; it mirrors onto the derived declaration:

```jsonc
// activity → Action.spendsResource / Action.resourceCost
{ "id": "touch", "name": "Touch of the Long Death", "type": "save", "cost": "action",
  "spendsResource": "focus", "resourceCost": 3 }

// trigger → TriggerDeclaration.spendsResource / .resourceCost
{ "kind": "trigger", "id": "drunkards-luck", "on": ["attack.declare"],
  "spendsResource": "focus", "resourceCost": 2 }

// activation → AvailableActivation.spendsResource / .resourceCost
{ "id": "bastion-of-law", "condition": "bastion-of-law", "cost": "action",
  "spendsResource": "sorcery-points", "resourceCost": 5 }
```

`resourceCost` defaults to 1. On an **item** activity the charge pool wins: an activity with `chargeCost` keeps `spendsResource: 'item/<slug>/charges'` and its own `spendsResource` is ignored (one debit per use).

The pack-side annotations that predate the field are read as aliases of the pool the class rows already declare, so already-authored rows light up without an edit:

| annotation | pool |
| --- | --- |
| `spendsSorceryPoints` | `sorcery-points` |
| `spendsBardicInspiration` | `bardic-inspiration` |
| `spendsKi` / `spendsFocusPoints` | `focus` (there is deliberately no separate `ki` pool) |
| `spendsWildShape` | `wild-shape` |
| `spendsSuperiorityDice` | `superiority` |
| `spendsPsionicEnergy` | `psionic-energy` |
| `spendsChannelDivinity` | `channel-divinity` |
| `spendsRage` | `rage` |

The annotation's value is the amount (`true` reads as 1). An explicit `spendsResource` always wins over an alias.

### Alternative costs

"Expend a spell slot of 1st level or higher to summon it again", "while you have no uses available, spend 2 Focus Points to use it again", "spend 5 Sorcery Points to use it again" — a second way to pay for a use that sits *beside* the declaration's own `uses` pool. Authored as `alternativeCosts` (singular `alternativeCost` also accepted) on an activity or an activation; mirrors onto `Action.alternativeCosts` / `AvailableActivation.alternativeCosts`.

```jsonc
"alternativeCosts": [
  { "kind": "spell-slot", "minLevel": 3 },                       // minLevel defaults to 1
  { "kind": "class-resource", "resource": "focus", "amount": 2 },
  { "kind": "hit-dice", "amount": 1 }
]
```

Display contract: the engine debits nothing automatically — the planner offers the alternative and the player spends the pool. Malformed entries are dropped silently (no warning; an empty result simply means "no alternative path").

## Trigger grants

`TriggerDeclaration.grants` is a discriminated union (`TriggerGrant` in `types.ts`). Beyond the runtime-contract shapes (`force-reroll`, `damage.reduce`, `convert-hit-to-miss`, …), three canonical **on-hit rider** shapes exist as structured display contracts — the runtime stays DM-adjudicated; the planner/sheet renders the fields instead of parsing prose:

```jsonc
{ "type": "damage.rider",    "amount": "2d6", "damageType": "fire", "save": { "ability": "dex", "dc": 15, "half": true } }
{ "type": "condition.rider", "condition": "poisoned", "save": { "ability": "con", "dc": 15 }, "duration": { "value": 1, "units": "minute" } }
{ "type": "hp.max-reduce",   "amount": "3d6" }   // sword of life-stealing / wounding patterns
```

Five more display-contract shapes cover the long-tail d20/save/death patterns — same posture (structured render, DM adjudicates):

```jsonc
{ "type": "d20.replace", "value": 10 }              // clockwork amulet — forgo the roll, take 10
{ "type": "save.convert-fail-to-success" }           // ring of evasion / mind-sharpener; usually on save.fail
{ "type": "reroll.grant", "die": "d20" }             // luck / fragment-of-possibility; pool via limit / spendsResource
{ "type": "contingency.revive", "hp": 1 }            // ring of temporal salvation / amulet of duplicity on-death contingency
{ "type": "spell.absorb", "maxLevels": 50 }          // rod of absorption capture reaction
```

`spell.absorb` is display-only — no runtime absorption exists. An item that also casts from the absorbed pool models that side via `data.spellStorage`; downstream riders can listen on the `spell.absorbed` trigger event. `contingency.revive`'s `hp` accepts a flat number or dice formula (absent → 1 HP).

### Trigger events

`KNOWN_TRIGGER_EVENTS` (`types.ts`) is the validated event vocabulary — an unlisted name still registers but emits an `unknown-trigger-event` soft warning. Adding one requires a C.8 fixture in `src/lib/rules/__tests__/fixtures/extras/` plus a row in `NEW_EVENT_FIXTURES` (AGENTS.md). Three landed with engine batch 6:

| event | POV | rides |
| --- | --- | --- |
| `save.success` | self | reactions that only exist because you *made* the save (Tasha's Vigilant Rebuke) |
| `ally.damage.taken` | the damaged ally is `self`; reactors scope `{ ally: true }` | Protective Bond, Spirit Shield, Aura of the Guardian, Dampen Elements |
| `resource.spent.bardic-inspiration` | the creature spending the die | Mote of Potential, Unfailing Inspiration, Combat Inspiration |

`ally.damage.taken` is the ally-POV counterpart of the self-only `damage.taken`, and `buildTriggerEventsFromLog` raises it from the same log row with the same role assignment — so an ally-scoped predicate is what selects the reactors.

`resource.spent.<pool-id>` is a **family**: one literal event name per class-resource id, so typos stay catchable at the modifier level. Only the Bardic Inspiration member exists today; add a sibling when another pool grows riders. The id matches the `ClassResourceDecl` id the runtime debits.

Item-sourced triggers respect the attunement gates (§ Attunement gating): a `requiresAttunement` item registers no triggers until attuned, and a per-entry `appliesWhen.requires: "equipped:attuned"` gates a single trigger on any item. Unknown grant `type` strings still pass through untyped (forward-compat).

## Random-effect tables

A slice of the corpus is pure "roll and see": Deck of Many Things, deck of illusions, bag of beans, wand of wonder, robe of useful items, the d100 Wild Magic Surge, Tasha's Experimental Elixir, the Book of Many Things card decks. An activity **or** a trigger may declare a `randomTable`; derive() coerces it and hands the resolved declaration to the UI on `Action.randomTable` / `TriggerDeclaration.randomTable`.

**derive() never rolls.** It is pure and repeatable — there is no RNG in the pipeline and `Math.random()` is banned. The table is a declaration; the DM rolls a physical d100 or the UI picks a row.

```jsonc
{
  "id": "wonder", "name": "Wand of Wonder", "type": "utility", "cost": "action", "chargeCost": 1,
  "randomTable": {
    "die": "1d100",                    // NdS or dS; 4d4 reads as 4..16
    "label": "Wand of Wonder",
    "rollTwiceChoose": true,           // Controlled Chaos / Controlled Surge / Mystical Connection
    "entries": [
      { "range": [1, 5],  "label": "Slow", "effect": { "kind": "cast-spell", "slug": "slow" } },
      { "range": 6,       "label": "Faerie Fire", "description": "…" },
      { "range": [7, 8],  "label": "Stunning gust",
        "effect": { "kind": "condition", "condition": "stunned",
                    "save": { "ability": "con", "dc": 15 },
                    "duration": { "value": 1, "units": "round" } } },
      { "range": [9, 10], "label": "Fireball",
        "effect": { "kind": "damage", "parts": [{ "formula": "8d6", "type": "fire" }],
                    "save": { "ability": "dex", "dc": 15, "half": true } } },
      { "range": [11, 12], "label": "Rhinoceros",
        "effect": { "kind": "summon", "creatures": [{ "slug": "rhinoceros", "count": 1 }] } },
      { "range": [13, 100], "label": "Nothing happens", "effect": { "kind": "display" } }
    ]
  }
}
```

`range` is a scalar (`6`) or an inclusive pair (`[1, 5]`); entries are sorted by `min` at coercion time. `label` defaults to the range when omitted.

`effect` is optional and discriminated by `kind` — reuse the shapes the engine already understands, or leave it off (equivalently, `{"kind": "display"}`) when the outcome is prose-level:

| kind | fields |
| --- | --- |
| `damage` | `parts: [{ formula \| dice, type }]`, `save?: { ability, dc, half? }` |
| `condition` | `condition`, `save?`, `duration?` (`ActivationDuration`) |
| `summon` | `creatures: [{ slug, count?, name? }]` |
| `grants` | `tempHp?`, `removeConditions?`, `restoreSpellSlots?` — the `ActionGrants` vocabulary |
| `cast-spell` | `slug`, `level?` |
| `display` | *(none)* — the label/description is the whole outcome |

Effect values are **verbatim display contracts** — no `evaluateValue`, same posture as trigger grants. A malformed entry or effect is dropped silently rather than throwing; a table with no `die` or no usable entries produces no `randomTable` at all.

Phase 6 soft-validates coverage: every face of the declared die should land on exactly one entry. Three codes fire, all warnings and all deliberately **outside** the `unknown-*` family (the packs QC gate hard-fails T3 rows on those, and a table with a deliberate hole — "on any other result, nothing happens" left implicit — is legal authoring):

`random-table-die-unparsed` · `random-table-entry-out-of-range` · `random-table-range-overlap` · `random-table-range-gap`

## Modifier-side capability targets

Boolean targets take `value: true`; anything else is ignored. All feed `derive()` phase 2 and land on `Derived.stats`.

### Modifier `value` shapes

`StatModifierSchema.value` (`src/lib/server/content/schemas.ts`) accepts **number | string | boolean | object**. The object branch is `.passthrough()` — zod records the keys, the engine decides which ones a given target reads. That covers every `evaluateValue` object shape (`{perClass, table}`, `{perTotalLevel, table}`, `{perConditionStack, perLevel}`, `{sum: [...]}`, `{perAbilityMod, dieSize}`, `{perClassLevel, multiplier}`) plus literal object targets like `ac.formula`'s `{ base, ability | abilities }`.

The schema backs `/api/homebrew/*` and the packs QC gate for every kind whose `data` it validates — **feat** and **item**. It was scalar-only until engine batch 6, which is why an unarmored-AC feat (XGtE Dragon Hide, PHB-2014 Medium Armor Master) had nowhere to put its formula. Arrays are still rejected; no target reads one.

### Cross-row upgrades

A large slice of the 5e class chassis is features whose whole job is to raise an **earlier** feature's numbers — "your Sneak Attack dice increase", "Extra Attack lets you attack three times", "your Martial Arts die becomes a d8", "Warding Flare now refreshes on a Short Rest", "Invoke Duplicity creates four duplicates". Re-declaring the earlier row on the later one double-counts any shared pool, so three modifier-target families exist instead. All three are ordinary `stat-modifier` entries — same modes, same `appliesWhen` / toggle gating, same `evaluateValue` on `value`.

| target | shape | effect |
| --- | --- | --- |
| `upgrade.<rowSlug>.<dotted.path>` | any | writes into another **active** row's `data` at that path |
| `class-resource.<id>.max` | numeric | bumps a resolved class-resource pool by its id |
| `class-resource.<id>.dieSize` | die string | bumps a pool's die (`d6` → `d8`) |
| `extra-attacks` | numeric | rides the `data.extraAttacks` total → `Action.attackCount` = 1 + total |

```jsonc
// "Warding Flare now recharges on a Short Rest"
{ "kind": "stat-modifier", "target": "upgrade.warding-flare.activities.warding-flare.uses.per",
  "mode": "OVERRIDE", "value": "short-rest" }

// "Your Archer / Chalice die becomes 2d8"
{ "kind": "stat-modifier", "target": "upgrade.starry-form.activities.archer.damage.parts.0.dice",
  "mode": "UPGRADE", "value": "2d8" }

// "You can attack three times" / "one more Channel Divinity" / "your BI die is a d8"
{ "kind": "stat-modifier", "target": "extra-attacks",                        "mode": "OVERRIDE", "value": 2 }
{ "kind": "stat-modifier", "target": "class-resource.channel-divinity.max",  "mode": "ADD",      "value": 1 }
{ "kind": "stat-modifier", "target": "class-resource.bardic-inspiration.dieSize", "mode": "UPGRADE", "value": "d8" }
```

**Path grammar.** Segments split on `.` and walk `row.data`. On an **object** a segment is a key; on an **array** it is either a numeric index *or* the `id` of an element — so `activities.warding-flare.uses.per` beats `activities.0.uses.per` and survives reordering. The first segment after `upgrade.` is the target row's slug; every active row with that slug is upgraded (kind is not part of the address).

**Value semantics** (`applyUpgradeValue` in `src/lib/rules/cross-row-upgrades.ts`):

- number + number → the standard numeric modes (ADD / MULTIPLY / UPGRADE / DOWNGRADE / OVERRIDE).
- die string + die string → OVERRIDE replaces; UPGRADE keeps the **higher-average** die (`1d8` 4.5 < `2d8` 9, `d6` < `d8`), DOWNGRADE the lower. `1d8+2` deliberately doesn't parse as a die — use OVERRIDE there.
- anything else (strings, absent fields) → OVERRIDE writes, every other mode is a no-op.

**Ordering.** All upgrades to the same (row, path) chain in **priority ascending** order, defaulting to `mode × 10` per `modes.ts` — so an OVERRIDE (50) always lands after an ADD (20) no matter which row declared it. Ties keep the order derive() collected the modifiers in, which is its deterministic active-content walk (species → subspecies → background → classes → subclasses → feats → items → spells → conditions → features). Authoring order within one row is preserved. `priority` on the modifier overrides all of it.

**When it runs.** Phase 2.5 — after the stat block is composed (so `wisMod` / `barbarianLevel` tokens resolve) and before phase 3. The write goes into a **copy-on-write clone** of the row's `data`; the shared/cached `ContentRow` is never mutated, so `derive()` stays repeatable. Everything phase 3+ reads sees the upgraded declaration with no per-consumer plumbing: activities, `uses` blocks, class resources, triggers, maneuvers, outbound effects, summons.

**Scope limit.** Phase 2 has already run, so `upgrade.<slug>.modifiers…` does **not** retroactively change the stat block. Stat numbers stack through their own targets — that's what ADD is for. This channel is for *declarations*.

A modifier that names an inactive row, or a path that doesn't resolve, emits a soft `cross-row-upgrade-unresolved` warning (deliberately **not** an `unknown-*` code — the packs QC gate hard-fails those, and a legitimately level-gated target row is simply not active yet).

### Form-scoped modifiers (`appliesToForm`)

Two flags decide how a base row's modifier interacts with a polymorph form:

| flag | base sheet | form snapshot |
| --- | --- | --- |
| *(none)* | applies | ignored |
| `persistsInForm: true` | applies | surfaced on `ActiveForm.persistentModifiers` for the runtime to overlay |
| `appliesToForm: true` | **never applies** | folded into `ActiveForm.statblock` + surfaced on `ActiveForm.formModifiers` |

`appliesToForm` is the Wild Shape rider channel — Circle of the Moon's in-form AC floor, Primal Strike making beast-form attacks count as magical, Improved Circle Forms' WIS-mod-to-CON-saves-while-transformed. Authoring those unflagged would leak them onto the druid's human-shape sheet, which is why the catalog listed the whole family as blocked. derive() pulls flagged modifiers out of the base modifier set *before* phase 2, so they are invisible to every base-stat consumer.

```jsonc
{ "kind": "stat-modifier", "target": "ac",      "mode": "UPGRADE", "value": 13,       "appliesToForm": true }
{ "kind": "stat-modifier", "target": "save.con", "mode": "ADD",    "value": "wisMod", "appliesToForm": true }
{ "kind": "stat-modifier", "target": "trait.attacks-count-as-magical", "value": true, "appliesToForm": true }
```

Targets with a `MonsterDerived` slot are applied to the snapshot by `applyFormModifiers` (`src/lib/rules/form-modifiers.ts`), reusing the PC stat-block vocabulary:

`ac` · `hp.max` · `proficiencyBonus` · `speed.<key>` · `sense.<key>` · `save.<ability>` · `skill.<slug>` · `resistance|immunity|vulnerability.<type>` (boolean) · `trait.<slug>` (boolean, lands as a named form trait)

Standard modes and `evaluateValue` apply, priority-ascending like everywhere else — the PC's own `ctx` is used, so `wisMod` means the *druid's* Wisdom, not the bear's. Every flagged modifier — including riders with no statblock slot, like a form-attack damage-type substitution — also rides `formModifiers` verbatim for the encounter runtime. `formModifiers` is `[]` when nothing is flagged; the shared/cached monster row is never mutated.

### Skill / ability-check advantage

| target | effect |
| --- | --- |
| `skill.advantage.<slug>` / `skill.disadvantage.<slug>` | flags that skill's `SkillCell.advantage` / `.disadvantage` |
| `skill.advantage.all` / `skill.disadvantage.all` | flags every skill |
| `check.advantage.<ab>` / `check.disadvantage.<ab>` | flags every skill of that ability AND records `stats.abilityCheckAdvantage[<ab>]` (`'advantage' \| 'disadvantage' \| 'both'`) for raw checks |
| `check.bonus.<ab>` (numeric) | adds to every skill of that ability. Initiative deliberately stays separate — it has its own `initiative` target |
| `check.bonusDice.<ab>` (die string, e.g. `'1d4'`) | appends to `SkillCell.bonusDice` on every skill of that ability AND records `stats.abilityCheckBonusDice[<ab>]` for raw checks (strixhaven primers, guidance-style items) |
| `skill.bonusDice.<slug>` (die string) | appends to that one skill's `bonusDice` |

Bonus dice never fold into the numeric `bonus` — the skills panel shows a `+1d4` chip and the roll-time consumer adds the die. Skill-scoped dice sort before the governing ability's dice in the cell.

### d20 floors

"Treat a d20 roll of N or lower as N" — Reliable Talent, Circle of the Stars' Dragon, Tasha's Silver Tongue, XGtE's Ear for Deceit.

| target | value | effect |
| --- | --- | --- |
| `check.d20Floor` | numeric | floors every ability check: `SkillCell.d20Floor` on every skill **and** `stats.checkD20Floor` for raw checks |
| `skill.d20Floor.<slug>` | numeric | floors one skill's `SkillCell.d20Floor` |
| `save.d20Floor` | numeric | `stats.saveD20Floor` |

Semantics are implicitly **UPGRADE**: the highest floor wins, a declared `mode` is not read, and a skill's cell takes `max(skill floor, check floor)`. Values run through `evaluateValue` (so `proficiencyBonus` works) and are floored to an integer; non-numeric and non-positive values are ignored. Absent when no floor applies, exactly like `bonusDice`.

Same display + roll-time contract as bonus dice — the numeric `bonus` and passive Perception are untouched. The skills panel renders a `min 10` chip beside the adv/dis and `+1d4` chips; `saveD20Floor` renders once beside the Saves heading.

Both flags can be true at once; derive reports both and the roll-time consumer cancels them. **Passive Perception** applies RAW: advantage on the check → +5, disadvantage → −5, both → ±0.

### Option menus: multi-pick + per-option uses

`data.choices.modifierFromChoice` is the "pick one of these distinct modifier sets" slot (Aspect of the Wilds, Kobold Legacy, Transmuter's Stone). Two extensions make it carry the Rune Knight shape — 2–5 known runes, each with a passive rider **and** its own 1/short-rest invocation:

```jsonc
"choices": {
  "modifierFromChoice": {
    "label": "Runes Known",
    // number, token, or a perClass table — milestone growth is authorable
    "picks": { "perClass": "fighter", "table": [0,0,2,2,2,2,3,3,3,4, …] },
    "options": [
      { "id": "cloud-rune", "label": "Cloud Rune",
        "modifiers": [ … ],
        "uses": { "max": 1, "per": "short-rest" } },
      { "id": "hill-rune", "label": "Hill Rune", "modifiers": [ … ] }   // passive only
    ]
  }
}
```

Pick storage accepts both shapes; `option` and `options` union together:

```jsonc
"modifierFromChoice": { "option": "cloud-rune" }                    // single
"modifierFromChoice": { "options": ["cloud-rune", "fire-rune"] }    // multi
```

- **Every** picked option's `modifiers[]` are synthesized as if declared on the row directly, in **declaration order** (not pick order) so the generated modifier ids are stable. Picks matching no option id drop silently.
- An option's `uses: { max, per }` becomes an independent `Resource` with id `<kind>/<slug>/choice/<optionId>`, named from the option's `name` / `label`. `max` takes any `evaluateValue` shape. Options without `uses` contribute no pool. Each pool tracks separately through `character.resourcesSpent`.
- `picks` is resolved through `evaluateValue`, so `PendingFeatureChoice.unresolved` flips only once the player has chosen that many options. It is a picker-UI cap, not an enforcement gate — derive() synthesizes whatever was picked.
- The sheet's feature-choices panel renders a `<select>` for single-pick menus and a capped checkbox list for multi-pick ones.

### Dice maximization and doubling

"Maximize the damage dice", "maximize the healing", "double the dice against objects" — the family beside `damage.die.min`, `damage.reroll-and-keep-higher` and `crit.extra-die`. All are **action-modifier effect targets** taking `value: true`, and all land as booleans on the Action for the roll-time consumer to honor:

| effect target | Action field |
| --- | --- |
| `damage.maximize` | `damageMaximized` |
| `damage.maximize.vs-objects` | `damageMaximizedVsObjects` |
| `damage.double-dice` | `damageDiceDoubled` |
| `damage.double-dice.vs-objects` | `damageDiceDoubledVsObjects` |
| `heal.maximize` | `healMaximized` |

Scope comes from the ordinary `appliesTo.predicates` block — Consuming Fervor's "a Fire or Thunder damage roll" is `{ "damage.type": ["fire", "thunder"] }`, Overchannel's "a spell you cast" is `{ "attack.classification": "spell" }` plus the activation-condition gate. The `.vs-objects` siblings exist because the engine has no object-target model, so a sword of sharpness can't express its scope as a predicate.

Two trigger-grant shapes cover the reaction-timed cases (same display-contract posture as the other grants):

```jsonc
{ "type": "damage.maximize" }                                        // Consuming Fervor
{ "type": "damage.double", "save": { "ability": "con", "dc": 17 } }  // Death Strike
```

`hitDice.maximize` (boolean stat-modifier) → `stats.hitDiceMaximized`: Hit Dice spent on a rest deal their maximum instead of being rolled (periapt of wound closure).

### Curated trait flags

`trait.<slug>` (boolean) appends the slug to `stats.traits` (sorted, deduped). Any slug is allowed — no validation gate. Canonical slugs:

`water-breathing`, `x-ray-vision`, `surprise-immune`, `disease-immune`, `mind-shielding`, `no-fall-damage`, `ignore-difficult-terrain`, `attacks-count-as-magical`, `auto-stabilize`, `magic-detection-immune`

The sheet renders traits as chips beside senses; the encounter runtime interprets slugs it knows.

### Incoming-crit immunity

`tag.incoming-crit-immune` (boolean) → `stats.incomingCritImmune` — critical hits against the wearer become normal hits (adamantine armor). Consumed by the DM resolve flow: a 'crit' outcome against an immune PC target is downgraded to 'hit' via `downgradeCritForTarget` (`src/lib/realtime/resolve.ts`) — the log reads 'hit', `attack.crit` reactions don't fire, and the form shows a drop-the-extra-dice note. The flag also renders on the encounter stats disclosure beside resistances. Monster statblocks have no crit-immune field, so only PC targets participate.

### Death-save advantage

`deathsave.advantage` (boolean) → `stats.deathSaveAdvantage`. The sheet/runtime chooses how to surface it on death-save rolls.

### Armor property consumers

Equipped armor rows (category `armor`, non-shield) now have engine consumers for two pack-data fields:

- `stealthDisadvantage: true` → `stats.skills.stealth.disadvantage` via the skill advantage channel. Waived by an active `armor.ignore-stealth-disadvantage` (boolean) modifier.
- numeric `strRequired` > the character's STR **score** → every speed −10 ft (RAW), applied after all other speed math, floored at 0. Waived by `armor.ignore-str-requirement`.

Mithral-style items author the ignore targets on themselves; a mithral row can also simply omit the base flags — both shapes work.

### Condition-removal grants

Activities may declare `grants.removeConditions` (Lesser Restoration shape); `realizeActivity` passes it onto `Action.grants.removeConditions`:

```jsonc
"grants": {
  "removeConditions": [
    "poisoned",                              // remove entirely
    { "condition": "exhaustion", "stacks": 2 } // decrement conditionStacks by 2; remove at 0
  ]
}
```

`stacks` is numeric-only (no evaluateValue formulas).

`grants.restoreSpellSlots: { level, count? }` (spell-refueling ring): `level` is the maximum restorable slot level, `count` defaults to 1, both numeric-only.

Action grants are **applied at use time** by `applyActionUse` (`src/lib/rules/apply-grants.ts`): one draft-mutating call debits the action's `spendsResource` pool by `resourceCost` and folds the grants into the document — numeric temp HP with take-the-max (no stacking, RAW), condition removal / stack decrement, and slot restoration with pick-best semantics (each restore un-spends the highest-level spent slot ≤ `level`, `count` times, clamped at 0). Dice-formula temp HP (`'1d4+4'`) is surfaced as a manual follow-up — the engine has no RNG. The sheet wires this in two places, each a single `patchDocument` write with toast feedback: the Use button on grant-carrying action rows (grant-carrying spell casts surface in the Actions section for this purpose; the spell-slot spend itself stays manual) and the encounter-planner resolve flow. The DM-side encounter resolve does **not** auto-apply grants to PC documents — the player's sheet is the apply surface.

### Source-qualified save advantage from items

A `save.advantage.*` stat-modifier with a `sourcePredicate` (see `src/lib/rules/damage-source.ts`) works identically on items as on feats/features — the entry lands on `stats.savesAdvantageSourceQualified` with item attribution, and the attunement gate (`appliesWhen.requires: "equipped:attuned"`) keeps unattuned entries out. Mantle of Spell Resistance is `save.advantage.all` + `sourcePredicate: { "kind": "spell" }`.

## API schema parity

Every `CharacterDocument` field must appear in the Zod `CharacterDocument` schema in `src/lib/server/api/schemas.ts` — Zod strips unknown keys, and the character PATCH/PUT handlers persist the parsed body, so a missing schema entry silently deletes the field on every client round-trip. 2026-07: `companions`, `polymorphForm`, and `deathSaves` were missing and got stripped this way; the round-trip regression test in `src/routes/api/characters/[id]/__tests__/server.test.ts` now covers all three (add new optional fields to that test when extending the document).

## Known scope limits

- **Polymorph / Wild Shape**: full statblock *replacement* is not modeled; tracked as a known gap. Rider mechanics on top of a form are covered — see [Form-scoped modifiers](#form-scoped-modifiers-appliestoform).
- **Cover, lighting, terrain**: accepted as ad-hoc per-attack context at the UI layer; not stored in the engine.
- **Reaction timing windows**: triggers are declared; players adjudicate timing with the DM.
- **Auto-resolving trigger chains**: the engine surfaces pending triggers; players decide whether to invoke.

## Related

- [content-model.md](./content-model.md) — the modifier DSL the engine reads.
- [data-model.md](./data-model.md) — database schema.
