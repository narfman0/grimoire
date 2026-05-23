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

### Spell-mechanic primitives that have no current home — PARTIAL

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
  Weapon, Elemental Weapon): **SHIPPED** via the activation primitive
  (see below) — action-modifier + appliesWhen.condition gated on a
  player-toggleable activation. The "applies to ALL weapons while
  active" caveat is the per-weapon-tracking gap still listed below.

### Activation primitive — SHIPPED (long-tail authoring close to exhausted)

Player-toggleable self-buff state — Bladesong, Rage, Magic Weapon,
Armor of Agathys, Elemental Weapon, Shield of Faith, Longstrider, etc.
— is now first-class. Pack rows declare `data.activations[]` with id,
cost, duration, uses (number | string | perClass-table), concentration,
group (mutual-exclusion), condition slug, autoCancelOn list, and
optional variants. `Derived.availableActivations[]` carries the runtime
manifest. The sheet's `ActivationsPanel.svelte` renders one row per
declaration with uses tracking, concentration warnings, variant
dropdowns, and auto-cancel on rest / condition change. derive()
auto-injects an activation's `condition` slug into resolvedConditions
when active, so existing `appliesWhen.condition` modifiers fire
without further wiring.

**Shipped commits:** b554e6f (primitive) → 1ceac63 (helpers) → b37fc15
(refactor) → 84bf339 (rest/condition wiring) → e4cc397 (sheet panel)
→ 41ed2b6 (perClass-table uses) → 0c54d71 (SRD rage migration).

**Long-tail authoring status:** Done. Migrated rows: SRD rage,
Bladesong (tashas), Magic Weapon (2014 + 2024), Armor of Agathys
(2014 + 2024), Elemental Weapon (2024), Shield of Faith (2014 + 2024),
Longstrider (2014 + 2024). A `grep` audit of `appliesWhen.condition`
across both content repos shows the remaining rows are either (a)
enemy-targeting condition gates (Aura of Conquest's "frightened"
predicate, not a player activation) or (b) ride on the SRD rage
condition (Storm Herald aura variants, Path of the Totem Warrior
totems, Divine Fury) — all auto-surface through rage's activation.

**Remaining activation work is engine-side, not content-side** —
see the new gap entries below.

### Target-bounded buff primitive — SHIPPED (recipient-side model)

`character.receivedBuffs: ReceivedBuff[]` (commit 8ebb85a) lets a
recipient record an ally-cast buff with shape
`{id, spellSlug, slot?, variant?, sourceLabel?}`. derive() force-loads
the spell row into the active set and injects the spell's activation
condition into resolvedConditions — the spell's existing
`appliesWhen.condition` modifier gates fire automatically. New
`ReceivedBuffsPanel.svelte` on the sheet renders next to the
Activations panel with a spell picker + source-label input + slot
picker + remove buttons. Sheet-local: no cross-character RPC, no
concentration cascade, no caster-sheet involvement.

**Still deferred — caster-push automation:** A future enhancement
where the caster's activation toggle automatically emits a
BuffApplication into shared campaign state and the recipient's sheet
reflects it. Requires campaign-scoped buff log + acceptance UI +
auto-expire + concentration-end cascade. Out of scope until the
recipient-side shape proves out; user direction was "model 100%
character-sheet-side first, then update encounter/campaign state."

**Still deferred — receivedBuffs variant/scaling synthesis:** v1
only handles condition injection from receivedBuffs. If a recipient
needs a variant/slot pick (e.g. receiving Magic Weapon — picks the
recipient's own touched weapon), the synthesis path from activations
would need to be shared. Trivial extension when the use case arises.

(Below: the original deferral notes are retained for grep-archaeology
on what specifically was deferred and why.)

The activation primitive applies a self-buff to whoever activates the
spell on their own sheet. There's no engine-side way to model "Cleric
casts Shield of Faith on the Wizard → Wizard's sheet shows +2 AC."
For now, ally-buffs are pragmatically encoded as self-only — the
target ally must activate the same spell on their own character to
get the bonus.

**Sample blocked rows:** Bless (+1d4 to attacks/saves for up to 3
allies), Aid (+5 HP max for up to 3 allies), Heroism (temp HP per
turn to one ally), Haste (+2 AC + double speed + extra action on
one ally), Vow of Enmity (advantage vs one target). Estimated ~25
rows across SRD + non-SRD spell sources.

**Design — recipient-side model (recommended):** Add a
`receivedBuffs: ReceivedBuff[]` array on the character with shape
`{ id, spellSlug, slot?, variant?, sourceLabel? }`. derive() processes
each entry by force-loading the spell row into the active set and
injecting the spell's activation condition into resolvedConditions —
the spell's existing `modifiers[]` (already gated by
`appliesWhen.condition`) fire automatically. The recipient's sheet
gets a "Received buffs" section with a spell picker + per-entry slot
pick (for scalingByCastSlot spells) + free-text source label
("from Cleric Vortha"). The caster's sheet stays purely self-tracking
— no cross-character RPC, no source-character-id lookup, no data
synchronization. The DM or player adds the buff entry when the spell
is cast, removes it when concentration ends. Simpler to implement and
ship; cross-character automation can layer on top later.

**Design — caster-side push model (deferred alternative):** Cross-character data flow where the caster's
sheet emits a `BuffApplication { sourceCharacterId, targetCharacterId,
spellSlug, slot?, expiresAt? }` into shared state; the target's
sheet polls / subscribes and reflects the buff. Significantly more
plumbing (campaign-scoped buff log, target acceptance affordance,
auto-expire, concentration-end cascade). Better UX but a real design
pass with several open questions; defer until the recipient-side
shape proves out.

**Where to start (recipient-side):** Add `receivedBuffs` to
`CharacterDocument` + Zod schema. In `derive()`, after the activation
processing block, walk `character.receivedBuffs`, look up the spell
rows, push them into `active`, inject their activation conditions,
synthesize variant modifiers (variants[] and scalingByCastSlot —
variantsFromWeapons is harder because the recipient probably hasn't
equipped the touched weapon). New `ReceivedBuffsPanel.svelte` with
spell picker + slot picker. ~1 day end-to-end; the engine work mirrors
the existing activation processing.

### Inventory-state conditions — SHIPPED (auto-cancel side)

`ActivationDeclaration.autoCancelOn` accepts a mixed list of condition
slugs and inventory predicates of the shape
`{wearing: 'armor.light' | 'armor.medium' | 'armor.heavy' | 'shield'}`
(commit d161615). The activation auto-cancel walk evaluates the new
predicate against `Derived.equipped`, a denormalized equipped-armor +
shield summary computed once in derive() and shared with the AC
formula. The sheet wires the walk into `setInventoryFlag` (new) so
equipping medium / heavy armor or a shield drops Bladesong-style
activations in real time. Bladesong migrated to the new shape
(grimoire-packs commit f1640bc).

Still deferred: **attack-time inventory predicates** (Bladesong's
"using two hands to make a weapon attack" trigger, monk martial-arts
"unarmed or with a monk weapon" gates). These need an action-modifier
`appliesTo.predicates` extension — different code path from the
autoCancelOn walk because the predicate fires per-attack rather than
per-state-change. Estimated 4-6 monk + 2 bladesong + 2 barbarian rows
still blocked. Same pattern as the per-weapon enchantment tracking
gap below — both want a weapon-identity predicate on action-modifier
predicates.

### Per-weapon enchantment tracking — SHIPPED

`ActivationDeclaration.variantsFromWeapons: { modifiers: [...] }`
(commit 0d286bb) generates one variant per equipped weapon at
derive() time. The player picks the touched weapon when activating;
the engine substitutes the chosen weapon's slug for any `"__weapon__"`
placeholder in the modifier template — typically the `weapon.slug`
predicate on action-modifier `appliesTo` — so the bonus fires only
for attacks made with that weapon. Mutually exclusive with the
static `variants[]` field (authoring both is a content bug).

**Migrated:** Magic Weapon (both editions, grimoire-packs commit
595808b). Stale-pick semantics: if the picked weapon is unequipped
later, no bonus is synthesized (correct).

**Still deferred — Elemental Weapon:** RAW the +1d4 element rider
should also be per-weapon, but the element pick currently flows
through `choices.modifierFromChoice` (character-level) which doesn't
participate in activation synthesis. A clean fix needs either
routing modifierFromChoice through activation synthesis OR a 2D
variant primitive (weapon × element). Tracked in the
[`elemental-weapon.json`](../grimoire-packs/phb-2024/spells/elemental-weapon.json) note.

### Slot-aware action-modifier scaling — SHIPPED (activation side)

The `scalingByCastSlot: { baseSlotLevel, table }` value shape (commit
a9addf5) can appear anywhere in a modifier template (typically as an
action-modifier `effects[].value`). At activation synthesis time the
engine substitutes the picked cast slot into the table —
`table[slot - baseSlotLevel]` — clamping past the last entry for
typical "+3 at L6+" semantics. The ActivationsPanel renders a slot
picker on any activation whose template references scaling; the slot
is persisted on `character.activations[id].slot` (defaults to
baseSlotLevel).

**Migrated:** Magic Weapon (both editions, grimoire-packs commit
a042591) — +1/+2/+3 by slot.

**Still deferred — modifierFromChoice through activation synthesis:**
Elemental Weapon's damage rider lives in `choices.modifierFromChoice`
(character-pick), which doesn't flow through activation synthesis.
Same root cause as the Elemental Weapon per-weapon gap above —
a fix would route modifierFromChoice modifiers through the activation
synthesis path so they pick up both scaling and weapon substitution.

**Still deferred — instantaneous spells:** The broader `Spell upcast
scaling — DEFERRED` entry above covers Magic Missile / Burning Hands /
Fireball / etc. (~150 rows) where damage/heal/target-count scale per
slot. Those are activity-level (cast event), not modifier-level
(persistent buff), so they don't fit the activation primitive's
scaling shape — they need a separate `scaling` field on activities.

## Related

- [`grimoire-packs/docs/audit/deferred.md`](../../grimoire-packs/docs/audit/deferred.md)
  — operator tickets that don't need engine work (pack-specific data fixes,
  re-imports, sub-species populate-or-delete decisions).
- [`grimoire-packs/docs/audit/batch-plan.md`](../../grimoire-packs/docs/audit/batch-plan.md)
  §B + §C — original engine-gap analysis from the P0 pass; the items here
  are the subset that was deliberately deferred.
- [content-model.md](./content-model.md) — modifier DSL the engine reads.
- [rules-engine.md](./rules-engine.md) — `derive()` contract.
