# content model

Game-content catalog (species, classes, feats, items, spells…) plus the modifier DSL the rules engine reads. Companion to [rules-engine.md](./rules-engine.md); licensing per source in [seed-sources.md](./seed-sources.md).

## Database

Table: `content`. Key columns: `kind`, `slug`, `version`, `source`, `scope_id`, `name`, `data` (JSON). Full schema in `src/lib/server/db/schema.ts`. Zod shapes per kind in `src/lib/server/content/schemas.ts`.

A character document references content rows by `{ kind, slug, version }`. The `(slug, version)` pair is immutable once referenced — edits create a new version; old characters keep pointing at the old one.

## Kinds

| Kind         | What it represents |
| ------------ | ------------------ |
| `species`    | Player species. Carries ability score modifiers, speed, traits. |
| `subspecies` | Optional further specialization of a species. |
| `class`      | Character class. Hit die, proficiencies, feature list per level. |
| `subclass`   | Subclass specialization. References parent class slug. |
| `background` | Background. Skill proficiencies and a small feature. |
| `feat`       | Feat. May carry action modifiers and triggers. |
| `item`       | Weapons, armor, gear, consumables, magic items. |
| `spell`      | Spell. Level, school, casting time, components, activity. |
| `condition`  | Condition (Frightened, Prone, etc.). Applies modifiers while present on the character. |
| `feature`    | Named class/species ability substantial enough for its own row (Rage, Sneak Attack, Channel Divinity). Referenced from class/species `data.features[]`. |
| `monster`    | NPC/monster statblock for the encounter builder. |

## The modifier DSL

Every active content row can contribute zero or more modifiers. There are three kinds.

### 1. Stat modifier

Adjusts a derived stat passively while the source is active. Target paths include `ability.{str|dex|…}`, `save.{ability}`, `skill.{name}`, `ac`, `hp.max`, `speed.{walk|fly|…}`, `attack.bonus.{melee|ranged|spell}`, `damage.bonus.{…}`, `resistance.{damage-type}`, `proficiency.{name}`.

Modes: `ADD`, `MULTIPLY`, `OVERRIDE`, `UPGRADE` (floor), `DOWNGRADE` (cap), `CUSTOM`. Applied in ascending priority order per target.

### 2. Action modifier

Modifies actions matched by predicates — the canonical case is a feat like Great Weapon Master that conditionally changes attack and damage rolls. Predicates are K-V matchers on the action's context (weapon properties, attack range, spell level, etc.). When matched, effects adjust the action's resolved fields and tag it for UI display (so the player can see why).

### 3. Trigger

Declares what becomes available when an event fires. The engine registers triggers and surfaces them to the UI; the player decides whether to invoke. Events include attack lifecycle (`attack.hit`, `attack.crit`, `attack.reduce-to-zero`), spell events, turn/round lifecycle, and enemy/ally events. Full event list in `src/lib/rules/types.ts`.

Triggers support a `limit` (e.g., once per short rest).

## Active state

Every modifier has two orthogonal state fields:

- **`enabled`**: user-controlled toggle (Power Attack on/off, etc.). Persisted in `character.modifierToggles`.
- **`applicable`**: derived structural check — equipped item, level gate met, condition present, etc. Computed by the engine; never stored.

`active = enabled && applicable`. The engine only applies active modifiers.

## Scope and versioning

- **Global** (`scope_id IS NULL`): SRD content and published packs. Visible to all campaigns.
- **Campaign-scoped** (`scope_id = campaign.id`): homebrew visible only to that campaign.
- **User-scoped** (`owner_user_id`): homebrew authored by a specific user via the in-app editor. Visible to that user across campaigns; can be published to `unlisted` or `public` visibility.

## Packs

Content is grouped into packs (a directory of JSON files). Each pack has a `meta.json` with `slug`, `name`, `version`, `author`, `default_source`. The in-repo SRD pack is seeded once at first boot; non-SRD content is imported per-user via `POST /api/homebrew/import`. See `docs/content-distribution.md`.

## Related

- [rules-engine.md](./rules-engine.md) — how `derive()` reads and applies this content.
- [content-distribution.md](./content-distribution.md) — how content gets from JSON files (or upload) into the DB.
- [seed-sources.md](./seed-sources.md) — license and attribution per source.
- [data-model.md](./data-model.md) — full DB schema.
