# Polymorph / companion / overlay HP design

Engine-gaps.md flagged three "extra entity / extra HP bucket" mechanics
under one heading. Phase 2a shipped overlay HP. This doc covers the two
remaining families: **statblock replacement** (polymorph) and
**controlled minor entity** (companions). Both need the encounter
runtime to treat one PC as the controller of more than one body — which
is broader than `derive()` can model alone.

## Status

- **overlay HP** — DONE (commit 0ede556, [docs/engine-gaps.md])
- **statblock replacement** — DESIGNED (this doc), not implemented
- **controlled minor entity** — DESIGNED (this doc), not implemented

## Problem statement

Today, a `CharacterDocument` is one bag of stats; `derive()` produces
one `Derived`; the encounter table holds one `participants` row per
combatant; the planner UI shows one HP bar and one action list.

These mechanics break that 1:1:1:1 chain:

| Mechanic              | Bodies              | Whose HP gets hit? | Who decides actions? |
|-----------------------|---------------------|--------------------|----------------------|
| Wild Shape / Polymorph| Beast replaces self | Beast HP first, then PC| PC turn = beast turn|
| Echo Knight echo      | 1 echo + PC         | Echo (1 HP) or PC  | PC turn — can attack from either|
| Beast Master companion| Companion + PC      | Independent        | PC turn — companion gets BA|
| Drakewarden drake     | Drake + PC          | Independent        | PC turn — drake reacts|
| Pact of the Chain     | Familiar + PC       | Independent        | Familiar uses own turn (reaction trigger to attack)|
| Avenging Angel        | Angel form replaces | Angel HP, PC base HP gone for duration | PC turn|

Two distinct shapes emerge:

- **Polymorph (statblock-replacement)**: PC temporarily *becomes* a
  different statblock. The base character's mechanics are suspended
  (mostly — class features that explicitly persist still apply). When
  the form drops (HP hits 0, duration ends, dismiss), the PC reverts to
  base stats with their base HP undisturbed.
- **Companion (extra-entity)**: PC has a second body they control. Both
  bodies exist simultaneously, each with its own HP / AC / position.
  Initiative is shared (companion acts on PC's turn) or independent
  (familiar acts on its own initiative).

These need different data models. The shared piece is the encounter
layer's representation: a PC participant can be *backed by* more than
one snapshot the player controls.

## Data model

### CharacterDocument additions

```ts
interface CharacterDocument {
  // ...existing fields
  /** Currently-active polymorph form. Null when in base form. The slug
   *  references a content row of kind 'monster' (the form's statblock). */
  polymorphForm?: {
    slug: string;
    /** Source feature that granted the form (Wild Shape, Polymorph spell,
     *  Form of Dread, etc.). Used for cleanup rules — Wild Shape reverts
     *  to base on 0 HP; Polymorph reverts immediately too. */
    sourceContent: { kind: string; slug: string };
    /** Form HP. Independent of character.currentHp. */
    currentHp: number;
    maxHp: number;
    /** Round count remaining at form-end. Null = no timer (Wild Shape uses
     *  a per-rest resource instead of a per-encounter clock). */
    roundsRemaining?: number;
  } | null;
  /** Companion entities the PC currently controls. Persists across
   *  encounters — Beast Master's companion doesn't die when combat ends.
   *  Each entry has its own HP tracking. */
  companions?: Array<{
    slug: string;
    /** Display name (player-chosen). */
    name: string;
    sourceContent: { kind: string; slug: string };
    currentHp: number;
    maxHp: number;
    /** Status when out of combat. 'dismissed' lets the encounter UI
     *  skip the companion entirely; 'summoned' shows it. */
    status: 'summoned' | 'dismissed';
  }>;
}
```

### Derived additions

```ts
interface Derived {
  // ...existing fields

  /** Statblock active when the character is polymorphed. Null in base
   *  form. The encounter layer / sheet renders this in place of the base
   *  stats when present, but base resources / spell slots remain visible
   *  because they're not consumed by the form (with the exception of
   *  Wild Shape uses, which is its own resource entry). */
  activeForm?: {
    sourceContent: { kind: string; slug: string };
    statblock: MonsterDerived;
    /** Modifiers from the base character that persist in the form
     *  (e.g. Druid Circle of the Moon's combat-form CR bump). Applied
     *  on top of monsterDerive() output. */
    persistentModifiers: Array<Record<string, unknown>>;
  };

  /** Companions the character controls. derive() walks character.companions
   *  and produces a Derived-shaped snapshot per entry by running
   *  monsterDerive against the statblock. The encounter participant row
   *  for the PC carries a `controllerForParticipants: string[]` field
   *  that links companion participants back to their controller. */
  companions?: Array<{
    slug: string;
    name: string;
    statblock: MonsterDerived;
    currentHp: number;
    maxHp: number;
  }>;
}
```

### Encounter participants

Two cleanest options:

**(A) One participant row per body, with a controller link.**

```sql
ALTER TABLE participants ADD COLUMN controller_participant_id TEXT
  REFERENCES participants(id) ON DELETE SET NULL;
```

A PC summons a companion → encounter API auto-spawns a participant row
with `controller_participant_id = <PC's pid>`, `kind = 'companion'`,
`character_id = NULL`, `statblock_json = <companion derived>`. Wild
Shape: PC's existing participant row stays, but a `polymorph_form_pid`
column points to a sibling participant row that holds the form's HP /
stats. The planner shows both under the PC's turn entry, and either
body can act.

Pros: visualized on the initiative tracker naturally; HP independence
falls out for free; conditions on the form don't bleed onto the PC.

Cons: requires schema change + UI affordances for "switch active body"
on the planner.

**(B) Single participant row carrying alternate statblocks inline.**

`participants.alternate_bodies_json` field listing each form / companion
with their HP. Encounter API exposes per-body HP via a sub-resource at
`/api/encounters/[id]/participants/[pid]/bodies/[bodyId]/hp`.

Pros: no schema change; the PC's row stays canonical.

Cons: initiative tracker has to special-case PCs with extra bodies;
range/position is awkward to model when one entity has multiple
positions on the grid.

**Recommendation:** (A). The schema change is small and pays for
itself in UI simplicity. Companions and Wild Shape forms are first-class
combat entities — they roll initiative (or share their controller's),
take damage, get conditions, attack independently. Modeling them as
participants is the honest representation.

## derive() responsibilities

- Walk `character.polymorphForm` → load monster row → run `monsterDerive`
  → produce `Derived.activeForm` carrying the form's snapshot + any
  persistent modifiers.
- Walk `character.companions` → for each, load monster row + run
  `monsterDerive` → produce `Derived.companions[]`.
- Per the SRD: while polymorphed, the base character's class features
  that grant *non-statblock* bonuses still apply (advantage on saves,
  vision, etc.). derive() flags these with a new `data.persistsInForm: true`
  marker on the modifier row, and the merge step keeps them.

## Encounter runtime responsibilities

- POST `/api/encounters/[id]/participants/[pid]/polymorph` — start a
  polymorph. Spawns a sibling participant row holding the form's HP, AC,
  damage. The original PC participant is paused (no action / save until
  unpolymorphed) but stays in initiative.
- DELETE same endpoint — unpolymorph. Removes sibling, reactivates the
  PC's main row. If sibling HP hit 0, base PC takes overflow damage.
- POST `/api/encounters/[id]/participants/[pid]/companion/[cid]` —
  summon a companion. Spawns a new participant row controlled by the
  PC. Companion HP / position / conditions independent.
- The action log writes per-body: `participantId` is the body that
  acted (could be the form, the companion, or the base PC).
- Concentration: polymorph forms aren't concentration; companion
  summons (Find Familiar) typically are, so the existing concentration
  tracker handles it without modification.

## UI implications

- **Planner panel**: when a PC has an `activeForm`, the action list
  switches to the form's actions (with a "Revert to base" button).
  When a PC has companions, a tab strip lets the player toggle between
  "PC", "Form", or "Companion: <name>" — each tab shows its own
  actions, HP bar, and conditions.
- **Initiative tracker**: companions show indented under their
  controller. Wild Shape form shows as a colored variant of the PC's
  row, not a separate row (the PC's slot in initiative is still the
  PC's — they're just inside the form).

## Migration plan

Phase 5a (smallest first):
- Schema: `controller_participant_id` on participants.
- API: POST `/companion/[cid]` endpoint.
- derive: `Derived.companions[]` walks `character.companions[]`.
- Component: companion HP/actions card on the planner.
- First target: Pact of the Chain familiar (no combat actions in v0,
  just a presence on the tracker — simplest companion).

Phase 5b:
- derive: `Derived.activeForm` walks `character.polymorphForm`.
- API: POST/DELETE `/polymorph` endpoints.
- Component: form switch UI on the sheet.
- First targets: Druid Wild Shape, Polymorph spell.

Phase 5c (the hard cases):
- Echo Knight's echo: companion model, but PC can attack *through* the
  echo from its position. Needs encounter-runtime support for
  "originating from companion position." Defer.
- Avenging Angel: polymorph model, but with persistent class features.
  Should fall out of the `persistsInForm: true` marker once 5b lands.

## Out of scope

- Multi-action companions (Beast Master's companion gets Multiattack at
  L11). Defer to Phase 5c — needs the multi-attack primitive that
  already exists for PCs to also work on companion statblocks.
- Polymorph + concentration interactions across multiple PCs (one
  paladin polymorphed by an allied wizard — whose concentration?).
  Encoded in the API as "whoever holds the concentrating row controls
  unpolymorph"; not engine work.

## Test coverage required

- derive(): polymorphed PC → `activeForm` populated; un-polymorphed →
  null; companions walked correctly with HP independence preserved.
- derive(): `persistsInForm: true` modifier survives polymorph; without
  it, base modifiers don't apply to the form's snapshot.
- HP: form damage routes through the form's HP first; overflow on
  0-HP form cascades to base PC.
- Encounter API: summoning a companion creates a participant row with
  `controller_participant_id` pointing at the controlling PC. Removing
  the controller participant also removes the companion row.
- Encounter API: polymorph endpoint pauses the base PC's action slot
  without modifying their HP.

## Open questions

1. Should companions share their controller's initiative, or roll their
   own? RAW varies by feature. Recommendation: data field on the
   companion row (`sharesInitiative: boolean`) defaulting to true for
   Beast Master, false for familiars.
2. Wild Shape uses are a PC-level resource. When a Wild Shape sibling
   participant is spawned, the resource is consumed at spawn-time, not
   at revert. Where does that consumption flow through —
   `/polymorph` endpoint side-effects on the controller's
   `resourcesSpent`? Yes.
3. How do we represent "saving throws use base PC's stats while in
   form" (Wild Shape) vs. "saving throws use form's stats" (Polymorph)?
   New `formSaveSource: 'base' | 'form'` field on the form spec.
