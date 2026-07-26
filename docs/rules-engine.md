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

`realizeActivity` treats unrecognized `type` strings as `utility`; phase 6 emits an `unknown-activity-type` soft warning for anything outside {`attack`, `save`, `damage`, `heal`, `cast`, `cast-spell`, `utility`, `summon`, `maneuver-rider`} (`summon` is reserved for the summons batch). Absent `type` intentionally defaults to utility without warning.

## Known scope limits

- **Polymorph / Wild Shape**: full statblock replacement is not modeled; tracked as a known gap.
- **Cover, lighting, terrain**: accepted as ad-hoc per-attack context at the UI layer; not stored in the engine.
- **Reaction timing windows**: triggers are declared; players adjudicate timing with the DM.
- **Auto-resolving trigger chains**: the engine surfaces pending triggers; players decide whether to invoke.

## Related

- [content-model.md](./content-model.md) — the modifier DSL the engine reads.
- [data-model.md](./data-model.md) — database schema.
