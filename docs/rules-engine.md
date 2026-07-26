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

## Known scope limits

- **Polymorph / Wild Shape**: full statblock replacement is not modeled; tracked as a known gap.
- **Cover, lighting, terrain**: accepted as ad-hoc per-attack context at the UI layer; not stored in the engine.
- **Reaction timing windows**: triggers are declared; players adjudicate timing with the DM.
- **Auto-resolving trigger chains**: the engine surfaces pending triggers; players decide whether to invoke.

## Related

- [content-model.md](./content-model.md) — the modifier DSL the engine reads.
- [data-model.md](./data-model.md) — database schema.
