# content model

Game-content catalog (races, classes, feats, items, spells…) plus the
modifier DSL the rules engine reads. Companion to [rules-engine.md](./rules-engine.md);
licensing per source lives in [seed-sources.md](./seed-sources.md).

The shape borrows heavily from Foundry VTT's `dnd5e` system (Active Effects +
Activities), adapted: we model action-level modifiers and player-invoked
triggers as first-class data instead of leaving them to community modules.

## Goals

- **Catalog as data, sheet as document.** Adding a new race, feat, or magic
  item is an `INSERT` into `content`, not a schema migration.
- **Versioned content.** Old characters keep working when content is revised.
- **Modifiers compose predictably.** A small ordered set of modes (ADD,
  MULTIPLY, OVERRIDE, UPGRADE, DOWNGRADE, CUSTOM) covers ~90% of 5e math.
- **GWM-class features expressible without bespoke code.** Action modifiers
  with predicates + declarative triggers cover the long tail.
- **Active state is explicit.** Every modifier carries a user toggle
  (`enabled`) and a derived structural check (`applicable`). The engine only
  applies modifiers where both hold.

## Database

```sql
CREATE TABLE content (
  id          TEXT PRIMARY KEY,             -- internal UUID
  kind        TEXT NOT NULL,                -- see Kinds below
  slug        TEXT NOT NULL,                -- url-safe stable identifier
  version     INTEGER NOT NULL,             -- monotonic per slug; old refs keep working
  source      TEXT NOT NULL,                -- 'srd-5.2' | 'srd-5.1' | 'homebrew' | ...
  scope_id    TEXT,                         -- null = global; else campaign UUID
  name        TEXT NOT NULL,                -- display name
  data        TEXT NOT NULL,                -- JSON; shape depends on kind
  created_at  INTEGER NOT NULL,
  UNIQUE (slug, version, scope_id)
);
CREATE INDEX content_lookup ON content (kind, slug);
```

Drizzle portability is preserved: only `text` / `integer`. `data` is JSON
serialized to TEXT — no `json` column, no Postgres-only operators in app code.

### Character references

A character document (lives in the Y.Doc) references content rows:

```ts
type ContentRef = {
  kind: string;        // 'race' | 'class' | ...
  slug: string;
  version: number;
  choices?: Record<string, unknown>;  // e.g. { fightingStyle: 'dueling' }
};
```

The `(slug, version)` pair is **immutable once referenced**. Editing a
content row creates a new version; old characters keep pointing at the old
one until they explicitly migrate.

## Kinds

| Kind         | What it represents                                              |
| ------------ | --------------------------------------------------------------- |
| `race`       | Species (Hill Dwarf, Lightfoot Halfling). Carries ASIs, speed, traits. |
| `subrace`    | Optional further specialization; can be folded into `race` for simple cases. |
| `class`      | Character class (Fighter, Wizard). Includes level progression, hit die, starting proficiencies. |
| `subclass`   | E.g., Champion, Lore Bard. References parent class slug. |
| `background` | Acolyte, etc. Skill proficiencies + a small feature.    |
| `feat`       | GWM, Tough, Lucky.                                              |
| `item`       | Weapons, armor, gear, consumables. Magic items included. |
| `spell`      | Fireball, Cure Wounds. Has level, school, casting time, components, an `Activity`. |
| `condition`  | Frightened, Prone, Restrained. Applies effects while the character has the condition. |
| `feature`    | A class-/subclass-/race-granted ability that's substantial enough to be its own row (Sneak Attack, Rage, Channel Divinity). Referenced from class/race `data.features[]`. |

## The three-kind modifier DSL

Every active piece of content can contribute zero or more **modifiers** to a
character. There are three kinds:

### 1. Stat modifier (passive, always-on while active)

Adjusts a derived stat field. Shape mirrors Foundry's Active Effect "change":

```jsonc
{
  "kind": "stat-modifier",
  "target": "ability.str",      // dot-path into the derived stat block
  "mode": "ADD",                // ADD | MULTIPLY | OVERRIDE | UPGRADE | DOWNGRADE | CUSTOM
  "value": 2,                   // number, or formula string evaluated against base stats
  "priority": 20                // defaults to mode-default; lower applies first
}
```

**Mode semantics** (and default priorities):

| Mode       | Default priority | Behavior                                                       |
| ---------- | ---------------- | -------------------------------------------------------------- |
| `CUSTOM`   | 0                | Engine hook by `target`. Used sparingly for derived recompute. |
| `MULTIPLY` | 10               | `current * value`                                              |
| `ADD`      | 20               | `current + value`                                              |
| `DOWNGRADE`| 30               | `min(current, value)` — caps above.                            |
| `UPGRADE`  | 40               | `max(current, value)` — floors below.                          |
| `OVERRIDE` | 50               | `value` (replaces).                                            |

Modifiers apply in ascending `priority` within each `target`. Ties broken by
deterministic order: `(source.kind, content.slug, content.version, modifier.id)`.

**Target paths** (non-exhaustive):
- `ability.{str|dex|con|int|wis|cha}` — raw ability score
- `save.{ability}` — saving throw bonus
- `skill.{name}` — skill bonus (`stealth`, `perception`, …)
- `ac` — armor class
- `hp.max` — hit point maximum
- `speed.{walk|fly|swim|climb|burrow}`
- `attack.bonus.{melee|ranged|spell}` — global attack bonus
- `damage.bonus.{melee|ranged|spell}`
- `resistance.{damage-type}`, `immunity.{damage-type}`, `vulnerability.{damage-type}`
- `proficiency.{skill-name|tool-name|weapon-name|armor-category|language|save}`

### 2. Action modifier (toggle on a class of actions)

Modifies actions matched by predicates. The canonical case is GWM:

```jsonc
{
  "kind": "action-modifier",
  "id": "gwm-power",
  "name": "Power Attack (-5/+10)",
  "enabled": false,                     // user toggle, persisted per-character
  "defaultEnabled": false,
  "appliesTo": {
    "activityType": "attack",
    "predicates": [
      { "weapon.property": "heavy" },
      { "attack.range": "melee" },
      { "weapon.proficient": true }
    ]
  },
  "effects": [
    { "target": "attack.roll",  "mode": "ADD", "value": -5  },
    { "target": "damage.bonus", "mode": "ADD", "value": +10 }
  ]
}
```

**Predicate language** (v1): a list of K-V matchers ANDed together. Keys are
dot-paths into the action's resolved context. Values are scalars or arrays
(array = "any of"). Examples:

| Predicate                              | Meaning                              |
| -------------------------------------- | ------------------------------------ |
| `{ "weapon.property": "heavy" }`       | Weapon has the heavy property.       |
| `{ "weapon.property": ["heavy","two-handed"] }` | Has either property.        |
| `{ "attack.range": "melee" }`          | Action is a melee attack.            |
| `{ "weapon.proficient": true }`        | Wielder is proficient.               |
| `{ "spell.level": { "gte": 3 } }`      | Spell of level 3+ (operator form).   |

Operators: `eq` (default), `neq`, `gte`, `lte`, `in`. Resist adding more
until a real feature demands it.

When an action modifier is `active && enabled` and its predicates match, its
`effects` are applied to that specific action's resolved context. Tagged in
the UI ("Powered by Great Weapon Master") so the player can see why.

### 3. Trigger (declarative, player-invoked)

Triggers don't auto-resolve. They declare *what becomes available when
something happens* — the engine surfaces them in the UI; the player decides
whether to invoke. This is how dnd5e + a human DM actually play.

```jsonc
{
  "kind": "trigger",
  "id": "gwm-bonus-attack",
  "name": "Cleave",
  "on": ["attack.crit", "attack.reduce-to-zero"],
  "scope": {
    "activityType": "attack",
    "predicates": [
      { "attack.range": "melee" },
      { "weapon.classification": "weapon" }
    ]
  },
  "grants": {
    "activityType": "attack",
    "cost": "bonus",
    "usingWeapon": "same",
    "limit": { "per": "turn", "uses": 1 }
  }
}
```

**Event names** (v1; expand cautiously):
- Attack lifecycle: `attack.declare`, `attack.hit`, `attack.miss`,
  `attack.crit`, `attack.fumble`, `attack.reduce-to-zero`
- Turn lifecycle: `turn.start`, `turn.end`, `round.start`
- Damage: `damage.taken`, `damage.dealt`
- Saves: `save.fail`, `save.success`, `save.crit`
- Spells: `spell.cast`, `spell.concentration-broken`

The engine maintains a small state — `pendingTriggers[]` — populated when
the UI signals an event. The trigger registration in the engine is purely
declarative; UI is responsible for firing events and showing the pending
list.

## Activities

The action surface on items, features, and spells. Mirrors Foundry's `dnd5e`
Activity types but trims to what we need in v1.

```ts
type Activity = {
  id: string;
  type: ActivityType;
  name: string;
  cost: ActivityCost;
  range?: { value: number; units: 'ft' | 'self' | 'touch' | 'sight' };
  target?: { affects: 'self' | 'creature' | 'area'; count?: number; template?: ... };
  effects?: Array<{ modifierId: string; minLevel?: number; maxLevel?: number }>;
  // type-specific:
  attack?: AttackActivityData;
  save?: SaveActivityData;
  damage?: DamageActivityData;
  // ...
};

type ActivityType =
  | 'attack' | 'save' | 'damage' | 'heal' | 'utility' | 'check'
  | 'cast' | 'summon';

type ActivityCost =
  | 'action' | 'bonus' | 'reaction' | 'free'
  | { uses: number; per: 'turn' | 'round' | 'short-rest' | 'long-rest' | 'day' };
```

**Level-gated effects.** Activity `effects[]` reference modifier IDs with
optional `{minLevel, maxLevel}`. Cleanly handles Sneak Attack scaling
(1d6 at L1, 2d6 at L3, …) without bespoke fields per feature.

**Sub-types** (sketch — flesh out in code):

- `AttackActivityData`: `{ ability, classification: 'weapon'|'spell', range: 'melee'|'ranged', damage: [{dice, type}], critical?: {threshold, bonus} }`
- `SaveActivityData`: `{ ability, dc: { calc: 'spell' | 'fixed', value? } }`
- `DamageActivityData`: `{ parts: [{dice, type, scaling?: ...}] }`

## Active-state derivation

Every modifier has two state fields:

- **`enabled`**: user-controlled toggle. Whether the player has flipped it on
  (Power Attack, prepared spell, raging). Lives in
  `character.modifierToggles: Record<modifierId, boolean>`. Defaults to
  `modifier.defaultEnabled ?? true`.
- **`applicable`**: derived from source state, computed by the engine. True
  iff the source content is currently contributing the modifier:
  - **Item modifiers**: source item is `equipped` (and `attuned` if the item
    requires it). Charges > 0 for charge-consuming items.
  - **Class/subclass features**: character level in that class meets
    `feature.minLevel` (and ≤ `feature.maxLevel` if bounded).
  - **Prepared-caster spells**: spell is in `character.spells.prepared[]`.
  - **Condition-gated** ("while raging"): the named condition is on the
    character.
  - **Subrace traits**: character's subrace matches.

**`active = enabled && applicable`**. The engine only applies active modifiers.

Two fields, not one, because Foundry collapsed them in places and shipped
real bugs (notably attunement-slot accounting). User intent and structural
eligibility belong apart.

## Worked examples (per kind)

### Race — Hill Dwarf

```jsonc
{
  "kind": "race",
  "slug": "hill-dwarf",
  "version": 1,
  "source": "srd-5.2",
  "name": "Hill Dwarf",
  "data": {
    "size": "medium",
    "speed": { "walk": 25 },
    "languages": ["common", "dwarvish"],
    "modifiers": [
      { "kind": "stat-modifier", "target": "ability.con", "mode": "ADD", "value": 2 },
      { "kind": "stat-modifier", "target": "ability.wis", "mode": "ADD", "value": 1 },
      { "kind": "stat-modifier", "target": "save.poison", "mode": "ADD", "value": "advantage" },
      { "kind": "stat-modifier", "target": "resistance.poison", "mode": "OVERRIDE", "value": true },
      { "kind": "stat-modifier", "target": "hp.max", "mode": "ADD", "value": "totalLevel" }
    ],
    "features": ["darkvision-60", "stonecunning", "dwarven-combat-training"]
  }
}
```

### Class — Fighter (excerpt)

```jsonc
{
  "kind": "class",
  "slug": "fighter",
  "version": 1,
  "source": "srd-5.2",
  "name": "Fighter",
  "data": {
    "hitDie": 10,
    "primaryAbility": ["str", "dex"],
    "saves": ["str", "con"],
    "armorProficiencies": ["light", "medium", "heavy", "shield"],
    "weaponProficiencies": ["simple", "martial"],
    "skillChoices": { "from": ["acrobatics","animal-handling","athletics","history","insight","intimidation","perception","survival"], "pick": 2 },
    "features": [
      { "level": 1, "slug": "fighting-style", "kind": "feature", "choice": { "from": ["defense","dueling","great-weapon-fighting","protection","two-weapon-fighting","archery"], "pick": 1 } },
      { "level": 1, "slug": "second-wind" },
      { "level": 2, "slug": "action-surge" },
      { "level": 3, "slug": "martial-archetype" },
      { "level": 5, "slug": "extra-attack" }
    ]
  }
}
```

### Feat — Great Weapon Master

(see [the action-modifier + trigger section above](#2-action-modifier-toggle-on-a-class-of-actions)).
Full row:

```jsonc
{
  "kind": "feat",
  "slug": "great-weapon-master",
  "version": 1,
  "source": "srd-5.2",
  "name": "Great Weapon Master",
  "data": {
    "prerequisite": { "ability": { "str": 13 } },
    "modifiers": [/* gwm-power action-modifier */],
    "triggers": [/* gwm-bonus-attack trigger */]
  }
}
```

### Item — Greatsword

```jsonc
{
  "kind": "item",
  "slug": "greatsword",
  "version": 1,
  "source": "srd-5.2",
  "name": "Greatsword",
  "data": {
    "category": "weapon",
    "weaponType": "martial-melee",
    "properties": ["heavy", "two-handed"],
    "weight": 6,
    "cost": { "gp": 50 },
    "activities": [{
      "id": "greatsword-attack",
      "type": "attack",
      "name": "Greatsword Attack",
      "cost": "action",
      "attack": {
        "ability": "str",
        "classification": "weapon",
        "range": "melee",
        "damage": [{ "dice": "2d6", "type": "slashing" }]
      }
    }]
  }
}
```

### Item — Belt of Giant Strength (Hill)

```jsonc
{
  "kind": "item",
  "slug": "belt-of-hill-giant-strength",
  "version": 1,
  "source": "srd-5.2",
  "name": "Belt of Hill Giant Strength",
  "data": {
    "category": "wondrous",
    "rarity": "rare",
    "requiresAttunement": true,
    "slot": "belt",
    "modifiers": [
      { "kind": "stat-modifier", "target": "ability.str", "mode": "OVERRIDE", "value": 21, "priority": 50 }
    ]
  }
}
```

### Spell — Magic Missile

```jsonc
{
  "kind": "spell",
  "slug": "magic-missile",
  "version": 1,
  "source": "srd-5.2",
  "name": "Magic Missile",
  "data": {
    "level": 1,
    "school": "evocation",
    "castingTime": "1 action",
    "range": { "value": 120, "units": "ft" },
    "components": ["v", "s"],
    "activities": [{
      "id": "magic-missile-cast",
      "type": "cast",
      "name": "Cast Magic Missile",
      "cost": "action",
      "damage": {
        "parts": [{ "dice": "3d4+3", "type": "force",
                    "scaling": { "per-slot-above": 1, "addDice": "1d4+1" } }]
      },
      "target": { "affects": "creature", "count": 3 }
    }]
  }
}
```

## Scope & versioning

- **Global content** (`scope_id IS NULL`): SRD 5.2, SRD 5.1, anything we
  publish as canonical.
- **Campaign-scoped homebrew** (`scope_id = campaign.id`): only visible to
  that campaign's characters. Pickers filter `scope_id IN (NULL, current_campaign)`.
- **User-scoped homebrew** (M2+; `scope_id = user.id` with a separate scope
  column): visible to that user across campaigns.

Once a row is referenced by any character, **don't edit it in place** —
write a new row with `version + 1`. Old refs keep resolving. Migration is a
separate explicit operation, not a side effect of editing.

## What's deliberately out of scope for v1

- **Polymorph/Wild Shape statblock replacement** — model as a "form overlay"
  in v2; not a modifier stack.
- **Concentration tracking** — validation only; UI prompt on cast.
- **Cover, lighting, terrain** — combat-time modifiers; the engine accepts
  them as ad-hoc per-attack context but doesn't store them.
- **Reaction timing windows** — UI surfaces declared triggers; players adjudicate.

## Related

- [rules-engine.md](./rules-engine.md) — how `derive()` turns content +
  character into a sheet.
- [seed-sources.md](./seed-sources.md) — license + attribution per source.
- [data-model.md](./data-model.md) — the existing Drizzle schema this extends.
