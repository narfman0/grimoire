# Engine gaps

Primitives the rules engine doesn't yet express. Surfaced by the
[grimoire-packs mechanical-correctness audit](../../grimoire-packs/docs/AUDIT-PLAN.md)
but **not non-SRD-specific** — every gap below is also exercised by SRD
content. New content (SRD or pack) should consult this list before encoding
a feature that depends on a deferred primitive.

Updated after the audit pass that landed C.0–C.10 (commits 0b431cd..20c8ada).
Each item is a deliberately-deferred workstream — the audit didn't ship a fix
because the scope crossed into encounter-runtime or UI work that needs a
separate design pass.

## Status legend

- **DEFERRED** — design-needed; out of scope for the audit
- **PARTIAL** — engine support shipped but one piece is missing
- **OPERATOR** — actionable in content, not engine

## Engine deferrals

### Polymorph / companion / overlay-HP — DEFERRED

Three related "extra entity / extra HP bucket" mechanics, none currently
expressible:

1. **Statblock replacement** (Druid Wild Shape, Form of Dread, Avenging
   Angel). The character temporarily becomes a beast / aberration with a
   different HP pool, AC, attack list, and ability scores.
2. **Controlled minor entity** (Ranger Beast Master companion, Echo Knight
   echo, Drakewarden drake, Pact of the Chain familiar with combat use).
   First-class entity the player commands alongside their own turn.
3. **Overlay HP pool** (Arcane Ward, Bladesong, Tortle Shell Defense
   stance-toggle AC).

**SRD reach:** Druid Wild Shape (`content-packs/srd-5.2/features/druid.json`),
Pact of the Chain familiar, and any future companion-class addition. The
parallel SRD-content agent should expect ~60 rows blocked on this family
across SRD + non-SRD.

**Where to start:** Pick one family first (probably overlay HP — smallest
scope, most local change). The other two need the encounter runtime to
treat the character as a multi-entity bag, which is broader than `derive()`
can model alone.

**Sample blocked rows:** Druid Wild Shape, Echo Knight (`wildemount/`),
Beast Master, all 6 `wildemount/echo-knight` features, Tortle Shell Defense,
Bladesinger Bladesong, Abjurer Arcane Ward.

### Arithmetic-token evaluator — PARTIAL

C.0 shipped named-token resolution in `evaluate.ts`: `intMod`,
`proficiencyBonus`, `<class>Level`, `walkSpeed`, etc. What's still missing
is a **small arithmetic grammar** for formulas like:

- `1 + warlockLevel` (Celestial Healing Light pool)
- `floor(barbarianLevel/2)` (Divine Fury rider; the audit applied a
  conservative 1d6 instead of the prose's `1d6 + half-level`)
- `paladinLevel * 5` (Lay on Hands pool)
- `max(1, intMod)` (Chronurgy Momentary Stasis uses)

**SRD reach:** Divine Smite uses `addBonus: "paladinLevel"` (works today as
a bare token), but several SRD features need true arithmetic.

**Where to start:** Add a tiny expression parser to
`evaluate.ts:evaluateValue` that handles `+ - * /`, `min` / `max` / `floor`
function calls, and the named tokens. ~15 rows benefit immediately;
no DSL change required (the existing string `value` field already carries
the formula).

**Sample blocked rows:** Lay on Hands, Healing Light, Divine Fury (rider),
Channel Divinity uses-per-rest formulas, Bardic Inspiration die-size scaling.

### Per-feature menu-pick UI — OPERATOR

The C.5 engine generalization shipped (`resolveChoicePicks` now reads
picks for feat / species / subspecies / background / feature / subclass
rows). What's missing is **UI affordance** to let the player record picks
on a per-feature basis — `character.featureChoices[slug] = { skillProficiency: { skill: 'nature' } }`.

This is grimoire client work, not derive() work. Until the UI lands, packs
should encode pick-one menus by leaving `data.modifiers` empty and noting
the prose intent — the over-grant antipattern (granting all options) was
caught and corrected during the audit.

**SRD reach:** Several SRD subclass features use pick-one (Battle Master's
Student of War, Wild Heart's Aspect of the Wilds at L6, etc.).

**Sample blocked rows:** ~35 across P0/P1/P2 audit (Acolyte of Nature,
Otherworldly Glamour, Aspect of the Wilds, Transmuter's Stone, Third Eye,
Battle Master maneuvers, etc.).

### Encounter-runtime trigger consumers — PARTIAL

C.8 shipped a trigger-event registry (`KNOWN_TRIGGER_EVENTS`) and the
TriggerGrant union for `damage.reduce`, `damage.reflect`, etc. The encounter
runtime needs to actually **fire** the events. derive() declares triggers;
no module consumes them at action-resolution time.

**SRD reach:** Half-Orc Relentless Endurance (`attack.reduce-to-zero`) is
already encoded but never auto-prompts. Heavy Armor Master (`damage.taken`)
likewise.

**Where to start:** New module `src/lib/server/encounter/triggers.ts` that
receives action-resolution events from the encounter channel and matches
against `derived.triggers[]`, surfacing matching triggers to the active
character's planner.

### Outbound-effects consumer — PARTIAL

C.6 shipped `Derived.outboundEffects[]`. The encounter runtime needs to
walk it for each character and apply the resulting modifiers to ally
tokens within range — i.e. when a paladin enters their aura, ally tokens
gain +CHA-mod to saves. Until this lands, auras only affect the
emitting character (which is incorrect for most auras).

**SRD reach:** Paladin Aura of Protection is a marquee SRD feature.

## Related

- [`grimoire-packs/docs/audit/deferred.md`](../../grimoire-packs/docs/audit/deferred.md)
  — operator tickets that don't need engine work (pack-specific data fixes,
  re-imports, sub-species populate-or-delete decisions).
- [`grimoire-packs/docs/audit/batch-plan.md`](../../grimoire-packs/docs/audit/batch-plan.md)
  §B + §C — original engine-gap analysis from the P0 pass; the items here
  are the subset that was deliberately deferred.
- [content-model.md](./content-model.md) — modifier DSL the engine reads.
- [rules-engine.md](./rules-engine.md) — `derive()` contract.
