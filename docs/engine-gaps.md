# Engine gaps

Primitives the rules engine doesn't yet express. Surfaced by the
[grimoire-packs mechanical-correctness audit](../../grimoire-packs/docs/AUDIT-PLAN.md)
but **not non-SRD-specific** — every gap below is also exercised by SRD
content. New content (SRD or pack) should consult this list before encoding
a feature that depends on a deferred primitive.

Updated after the audit pass that landed C.0–C.10 (commits 0b431cd..20c8ada)
and the gap-fill pass that landed phases 1–4 (commits 6f8e101..0b2a0bf).
Each item is a deliberately-deferred workstream — the audit didn't ship a fix
because the scope crossed into encounter-runtime or UI work that needs a
separate design pass.

## Status legend

- **DEFERRED** — design-needed; out of scope for the audit
- **DESIGNED** — design doc landed; implementation not started
- **PARTIAL** — engine support shipped but one piece is missing
- **OPERATOR** — actionable in content, not engine
- **SHIPPED** — gap closed; left here for grep-archaeology

## Engine deferrals

### Polymorph / companion / overlay-HP — PARTIAL (overlay shipped)

Three related "extra entity / extra HP bucket" mechanics:

1. **Statblock replacement** (Druid Wild Shape, Form of Dread, Avenging
   Angel). The character temporarily becomes a beast / aberration with a
   different HP pool, AC, attack list, and ability scores. **DESIGNED**
   — see [polymorph-companion-design.md](./polymorph-companion-design.md).
   Not implemented.
2. **Controlled minor entity** (Ranger Beast Master companion, Echo Knight
   echo, Drakewarden drake, Pact of the Chain familiar with combat use).
   First-class entity the player commands alongside their own turn.
   **DESIGNED** — same design doc. Not implemented.
3. **Overlay HP pool** (Arcane Ward, Bladesong, Tortle Shell Defense
   stance-toggle AC). **SHIPPED** — `Derived.overlayHpPools[]` (commit
   0ede556). hp.applyDamageDelta absorbs in order temp → overlay →
   current. Content rows can now emit `overlay-hp-pool` modifier rows;
   `evaluateValue` resolves the `max` formula against character context.

**Sample blocked rows (1 + 2):** Druid Wild Shape, Echo Knight
(`wildemount/`), Beast Master, all 6 `wildemount/echo-knight` features.
Estimated ~50 rows across SRD + non-SRD.

### Arithmetic-token evaluator — SHIPPED

`evaluateValue` now parses `+ - * /`, parens, unary minus, and
`floor`/`ceil`/`min`/`max` on top of the existing named-token resolution
(commit 6f8e101). Formulas like `1 + warlockLevel`,
`floor(barbarianLevel/2)`, `paladinLevel * 5`, `max(1, intMod)` resolve
to numbers; malformed input falls back to passthrough so existing
non-arithmetic strings are unchanged.

### Per-feature menu-pick UI — SHIPPED

`Derived.pendingFeatureChoices[]` (commit 0b2a0bf) declares each active
feature / subclass row with a `data.choices` entry, the picks the
player has recorded, and whether any slot is unresolved. The new
`FeatureChoicesPanel.svelte` component on the character sheet renders
pickers for all eight slot kinds (asi, skillProficiency, expertise,
savingThrow, language, toolProficiency, feature, spell) and writes
selections back via the existing `patchDocument` flow.

Also closed in the same commit: the API schema gap where
`featureChoices` / `subclassChoices` were stripped by the Zod
validator on every PATCH because they weren't declared on the
CharacterDocument schema.

### Encounter-runtime trigger consumers — PARTIAL (primitive shipped)

`src/lib/server/encounter/triggers.ts` (commit 62e70ed) exposes a pure
`matchTriggers(participants, event)` function that takes an event
(damage.reduce-to-zero, damage.taken, turn.start, …) plus role
assignments and returns the matching `(participant, trigger)`
opportunities. Honors self / ally / enemy scope predicates. Wiring this
into the action-log POST endpoint and surfacing opportunities through
the planner UI is the remaining work — the engine primitive is ready.

### Outbound-effects consumer — PARTIAL (primitive shipped)

`src/lib/server/encounter/auras.ts` (commit 62e70ed) exposes a pure
`collectAurasFor(target, sources)` function that returns the aura
applications affecting a target, honoring self / ally / enemy /
creature targeting, excludeSelf, requiresAlive,
`appliesWhen.condition`, and Chebyshev × 5 ft range checks (skipped
when positions are missing for theater-of-the-mind). Modifier values
deliberately stay as tokens — the caller resolves them against source
or target context per modifier shape. Wiring into encounter
participants is the remaining work.

### Item enhancement-bonus on weapon and spell attacks — SHIPPED

`derive()` now synthesizes scoped action-modifiers from each
item-sourced `attack.bonus[.*]` / `damage.bonus[.*]` stat-modifier
(commit 5f85fe9). Scoping: bare / `.melee` / `.ranged` match attacks
made with the item itself (via `weapon.slug` predicate); `.spell`
matches any spell attack (focus held while casting). The synthetic
modifier flows through `applyActionEffect`'s existing attack.roll /
damage.bonus paths so the audit trail and mode semantics stay
uniform. Unblocks 60+ magic weapons + spell focuses across SRD and
packs.

### Union-shape feature choices — DEFERRED

Several subclass-feature picks let the player pick one of N options
that map to *different* modifier kinds (Wild Heart Aspect of the Wilds:
Owl=darkvision / Panther=climb-speed / Salmon=swim-speed; Transmuter's
Stone: darkvision OR resistance OR speed bonus OR proficiency;
Kobold Legacy: skill OR save-advantage OR cantrip). The `choices`
slots today are single-kind (`skillProficiency` → one skill,
`feature` → one feature row). There's no slot that emits an arbitrary
stat-modifier from a named option.

**SRD reach:** Multiple SRD subclass features (Aspect of the Wilds, etc.)
sit at the audit's "menu-pick / engine-gap" tag.

**Where to start:** Add a `modifierFromChoice` slot to the engine's
choice spec:
```ts
modifierFromChoice: {
  options: [
    { id: 'owl',     label: 'Owl',     modifiers: [{ target: 'sense.darkvision', mode: 'UPGRADE', value: 60 }] },
    { id: 'panther', label: 'Panther', modifiers: [{ target: 'speed.climb',      mode: 'UPGRADE', value: 'walkSpeed' }] },
    { id: 'salmon',  label: 'Salmon',  modifiers: [{ target: 'speed.swim',       mode: 'UPGRADE', value: 'walkSpeed' }] }
  ]
}
```
On the character side: `featureChoices[slug].modifierFromChoice.option = 'owl'`. derive() synthesizes the option's modifiers. ~25 rows across SRD + packs unblock.

### Multi-pick choice counts on skill / language slots — DEFERRED

`spell` slots already carry `picks: N`; `skillProficiency`, `language`,
and `toolProficiency` do not. So "pick 3 skills" (College of Lore),
"pick 2 languages" (Mastermind), "pick 2 skills" (Kenku Recall) can't
be expressed today — the row either over-grants all options or stays
T1-STUB.

**Where to start:** Add `picks: N` to the three single-pick slot specs
and have the UI render N copies of the picker. ~15 rows unblock.

### Spell upcast scaling — DEFERRED

153 spells with "At Higher Levels" prose have no `scaling` /
`upcastScaling` field, so casting at a higher slot silently doesn't
adjust the activity's damage / heal / target count / duration.

**SRD reach:** Magic Missile, Burning Hands, Cure Wounds, Fireball,
Scorching Ray, Spiritual Weapon, etc. — basically every leveled
damaging spell.

**Where to start:** A `scaling` field on activities:
```ts
scaling: {
  by: 'slotLevel',
  baseSlotLevel: <spell.level>,
  steps: [
    { field: 'damage.parts.0.dice', perLevel: '1d6' }
  ]
}
```
When the encounter logs a cast at slot N > baseSlotLevel, derive()
(or a runtime helper) walks the steps and computes the upscaled
value. Big unlock — would T2-promote ~150 spell rows.

### Spell-mechanic primitives that have no current home — DEFERRED

A handful of spell mechanics need their own primitives before the
content can encode them:

- **Temp HP on cast** (Armor of Agathys, False Life, Heroism): no
  shape today; suggestion is an `activities[].grants` field with
  `{ type: 'temp-hp', amount: number | formula }`.
- **Retaliatory damage trigger** (Armor of Agathys: "when a creature
  hits you in melee, they take 5 cold"): same trigger registry that
  encounter consumer matches on, but the source is a spell with an
  active concentration / duration. Needs `concentrating.X` as a
  trigger-scope predicate.
- **Damage rider on weapon attacks for duration** (Magic Weapon, Holy
  Weapon, Elemental Weapon): like item enhancement bonuses (Phase 1b)
  but scoped to a self-buff with a duration timer. The action-modifier
  + appliesWhen.condition shape works once the encounter runtime
  exposes "spell-effect-active-on-self" as a condition slug.

## Related

- [`grimoire-packs/docs/audit/deferred.md`](../../grimoire-packs/docs/audit/deferred.md)
  — operator tickets that don't need engine work (pack-specific data fixes,
  re-imports, sub-species populate-or-delete decisions).
- [`grimoire-packs/docs/audit/batch-plan.md`](../../grimoire-packs/docs/audit/batch-plan.md)
  §B + §C — original engine-gap analysis from the P0 pass; the items here
  are the subset that was deliberately deferred.
- [content-model.md](./content-model.md) — modifier DSL the engine reads.
- [rules-engine.md](./rules-engine.md) — `derive()` contract.
