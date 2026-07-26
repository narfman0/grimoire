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

`max` accepts any `evaluateValue` shape. `recharge.per` is `'dawn' | 'long-rest' | 'short-rest'`; `recharge: "never"` (or a flat shape with no recharge sibling) never refills on rest. `recharge.amount` ("1d6+1") is stored and displayed, but v1 resets the pool to max at the cadence — partial recharge rolls are a follow-up.

An activity that declares `chargeCost: N` debits the pool: its Action carries `spendsResource: 'item/<slug>/charges'` and `resourceCost: N`. Variable-cost items author sibling activities with different chargeCosts. An activity with its own `uses` block keeps its independent per-activity counter and never attaches to the pool.

Rest cadence is shared across all reset sites via `src/lib/rules/rest.ts`: a long rest resets `per` ∈ {`long-rest`, `short-rest`, `day`, `dawn`}; a short rest resets only `short-rest`; `never` is never reset.

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

## Modifier-side capability targets

Boolean targets take `value: true`; anything else is ignored. All feed `derive()` phase 2 and land on `Derived.stats`.

### Skill / ability-check advantage

| target | effect |
| --- | --- |
| `skill.advantage.<slug>` / `skill.disadvantage.<slug>` | flags that skill's `SkillCell.advantage` / `.disadvantage` |
| `skill.advantage.all` / `skill.disadvantage.all` | flags every skill |
| `check.advantage.<ab>` / `check.disadvantage.<ab>` | flags every skill of that ability AND records `stats.abilityCheckAdvantage[<ab>]` (`'advantage' \| 'disadvantage' \| 'both'`) for raw checks |
| `check.bonus.<ab>` (numeric) | adds to every skill of that ability. Initiative deliberately stays separate — it has its own `initiative` target |

Both flags can be true at once; derive reports both and the roll-time consumer cancels them. **Passive Perception** applies RAW: advantage on the check → +5, disadvantage → −5, both → ±0.

### Curated trait flags

`trait.<slug>` (boolean) appends the slug to `stats.traits` (sorted, deduped). Any slug is allowed — no validation gate. Canonical slugs:

`water-breathing`, `x-ray-vision`, `surprise-immune`, `disease-immune`, `mind-shielding`, `no-fall-damage`, `ignore-difficult-terrain`, `attacks-count-as-magical`, `auto-stabilize`, `magic-detection-immune`

The sheet renders traits as chips beside senses; the encounter runtime interprets slugs it knows.

### Incoming-crit immunity

`tag.incoming-crit-immune` (boolean) → `stats.incomingCritImmune` — critical hits against the wearer become normal hits (adamantine armor). Derive + type only for now; encounter-runtime consumption at incoming-attack adjudication is a follow-on.

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

`stacks` is numeric-only (no evaluateValue formulas). Like `grants.tempHp`, this is **display-only** today — the sheet renders a "removes:" line; there is no auto-apply path for action grants yet.

### Source-qualified save advantage from items

A `save.advantage.*` stat-modifier with a `sourcePredicate` (see `src/lib/rules/damage-source.ts`) works identically on items as on feats/features — the entry lands on `stats.savesAdvantageSourceQualified` with item attribution, and the attunement gate (`appliesWhen.requires: "equipped:attuned"`) keeps unattuned entries out. Mantle of Spell Resistance is `save.advantage.all` + `sourcePredicate: { "kind": "spell" }`.

## API schema parity

Every `CharacterDocument` field must appear in the Zod `CharacterDocument` schema in `src/lib/server/api/schemas.ts` — Zod strips unknown keys, and the character PATCH/PUT handlers persist the parsed body, so a missing schema entry silently deletes the field on every client round-trip. 2026-07: `companions`, `polymorphForm`, and `deathSaves` were missing and got stripped this way; the round-trip regression test in `src/routes/api/characters/[id]/__tests__/server.test.ts` now covers all three (add new optional fields to that test when extending the document).

## Known scope limits

- **Polymorph / Wild Shape**: full statblock replacement is not modeled; tracked as a known gap.
- **Cover, lighting, terrain**: accepted as ad-hoc per-attack context at the UI layer; not stored in the engine.
- **Reaction timing windows**: triggers are declared; players adjudicate timing with the DM.
- **Auto-resolving trigger chains**: the engine surfaces pending triggers; players decide whether to invoke.

## Related

- [content-model.md](./content-model.md) — the modifier DSL the engine reads.
- [data-model.md](./data-model.md) — database schema.
