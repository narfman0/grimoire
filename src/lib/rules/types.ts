// TypeScript types for the rules engine. See docs/rules-engine.md for the
// contract narrative; this file is just the types those words describe.

import type { DamageSourcePredicate } from './damage-source';
import type { MonsterDerived } from './monster-derive';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITIES: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

export type AbilityScores = Record<AbilityKey, number>;

export interface ContentRef {
  kind: string;
  slug: string;
  version?: number; // omit → latest
  /** Author of the homebrew row this ref targets. Omitted/null for pack
   *  content (SRD, grimoire-packs). Required when the character has chosen
   *  a row reached through a subscription so the lookup can disambiguate
   *  two authors' same-slug homebrew on the same sheet. */
  authorUserId?: string | null;
  choices?: Record<string, unknown>;
}

export interface ClassEntry {
  slug: string;
  level: number;
  subclass?: string;
  /** Length === level; the actual HP added at each level (avg or rolled). */
  hpRolledPerLevel: number[];
}

export interface InventorySlot {
  contentKind: string;
  contentSlug: string;
  version?: number;
  /** Homebrew author when the item came from /homebrew/browse (subscription
   *  or fork that points at someone else's row). Null/absent for pack items. */
  authorUserId?: string | null;
  equipped: boolean;
  attuned: boolean;
  charges?: number;
  slot?: string;
  /** Player picks for choice slots the item row declares via
   *  `data.choices` (see docs/rules-engine.md § Item choice slots).
   *  Per-inventory-slot state — two copies of a Spell Scroll can hold
   *  different spells. Keyed by choice-slot name; the v1 engine-read
   *  slots store a plain slug string:
   *    choices.spell      = '<spell slug>'   (parametric cast-spell)
   *    choices.baseWeapon = '<item slug>'    (generic-variant weapons) */
  choices?: Record<string, unknown>;
  /** Spells currently held by this item (Ring of Spell Storing model —
   *  the item row declares `data.spellStorage: { maxLevels }`). Each
   *  entry casts at exactly `level`, using the storer's `dc` /
   *  `attackBonus` when recorded (else the wearer's own numbers).
   *  Per-inventory-slot state, like `choices`. */
  stored?: StoredSpell[];
}

/** One spell held inside a spell-storage item (see InventorySlot.stored). */
export interface StoredSpell {
  slug: string;
  /** Slot level the spell was stored at — it casts at exactly this level. */
  level: number;
  /** Storer's save DC. Absent → the wearer's own numbers apply. */
  dc?: number;
  /** Storer's spell attack bonus. Absent → the wearer's own. */
  attackBonus?: number;
  /** Free-text attribution ("from Vortha the cleric"). Display-only. */
  label?: string;
}

export interface CharacterDocument {
  id: string;
  name: string;
  alignment?: string;

  classes: ClassEntry[];
  species: ContentRef;
  subspecies?: ContentRef;
  background?: ContentRef;
  feats: ContentRef[];

  abilityScores: AbilityScores;
  proficienciesChosen: {
    skills?: string[];
    tools?: string[];
    languages?: string[];
  };

  inventory: InventorySlot[];
  spells: { known: ContentRef[]; prepared: string[] };

  currentHp: number;
  tempHp: number;
  hitDiceSpent: Record<string, number>;
  /** Death saving throw state. Only meaningful when currentHp === 0.
   *  3 successes → stable; 3 failures → dead. Cleared on any heal above 0. */
  deathSaves?: { successes: number; failures: number };
  conditions: string[];
  /** Stacking level for conditions that accumulate (e.g. exhaustion 1–10).
   *  Key is the condition slug; value is the current stack count (≥ 1).
   *  Absence of a key means the condition has no stack (level 0 / off). */
  conditionStacks?: Record<string, number>;

  modifierToggles: Record<string, boolean>;
  /** Player picks for subclass-feature menus (Acolyte of Nature, Aspect of
   *  the Wilds, Student of War, etc.). Keyed by the feature row's slug.
   *  Value shape mirrors `ContentRef.choices`: a record of choice-decl
   *  keys (e.g. `skillProficiency`, `language`) to the picked value. */
  featureChoices?: Record<string, Record<string, unknown>>;
  /** Player picks declared on the subclass row itself (rare — most subclass
   *  picks live on the per-level feature row instead). Keyed by subclass
   *  slug. */
  subclassChoices?: Record<string, Record<string, unknown>>;
  /** Per-resource counter keyed by resource id (see derive().resources[].id). */
  resourcesSpent?: Record<string, number>;
  /** Whether the character has already used their action slot this turn.
   *  Set when a plan with cost='action' resolves; resets on turn-rise. */
  actionUsedThisRound?: boolean;
  /** Whether the character has already used their bonus action this turn. */
  bonusActionUsedThisRound?: boolean;
  /** Whether the character has already used their reaction in the current
   *  round. Auto-resets when their turn comes back around (planner watches
   *  the SSE activeParticipantId for the rising edge), or on any rest. */
  reactionUsedThisRound?: boolean;
  /** Feet of movement already consumed this turn. Capped at the character's
   *  walking speed; resets on turn-rise. */
  movementUsedThisRound?: number;
  /** Active concentration target. v0: free-text label declared by the player;
   *  ends voluntarily, on long rest, or when a new concentration starts.
   *  Damage-triggered CON saves are DM-adjudicated. */
  concentrating?: { label: string; sinceRound?: number } | null;
  /** Per-activation player state, keyed by `activation.id` declared on a
   *  feature/spell row. Tracks whether the activation is currently on,
   *  uses remaining (for per-rest activations), and the picked variant
   *  for activations with a variants[] menu. derive() reads this to
   *  decide whether to inject the activation's `condition` slug into the
   *  resolved condition set (which gates appliesWhen.condition modifiers
   *  on stat/action/outbound shapes). */
  activations?: Record<string, ActivationState>;
  /** Buffs received from an ally's spell cast (Shield of Faith, Bless,
   *  Haste, Heroism, etc.). Recipient-side model: the buff record lives
   *  on the target's own sheet — the player or DM adds an entry when an
   *  ally casts on them. derive() processes each entry by force-loading
   *  the spell row's modifiers and injecting its activation condition,
   *  so the buff's mechanical effect (e.g. +2 AC) flows through the
   *  same pipeline as self-cast activations. No cross-character RPC,
   *  no concentration cascade — the recipient removes the entry when
   *  the buff ends. */
  receivedBuffs?: ReceivedBuff[];
  /** Action ids (derived.actions[].id) the player has pinned. The planner
   *  surfaces these at the top of the picker. */
  favoriteActionIds?: string[];
  /** Portrait image URL — pre-generated gallery path (/portraits/*) or
   *  uploaded portrait served via /api/portraits/[id]. */
  portrait?: string;
  /** Currently-active polymorph form. Null/absent when in base form. The
   *  slug references a content row of kind 'monster' (the form's
   *  statblock). When present, derive() resolves the form via the
   *  ContentLookup and populates `Derived.activeForm` with a snapshot. */
  polymorphForm?: PolymorphFormState | null;
  /** Companions the PC controls (Beast Master companion, Pact of the
   *  Chain familiar, Drakewarden drake, …). Persists across encounters;
   *  derive() walks them and emits a `Derived.companions[]` entry per
   *  `summoned` row (dismissed rows are omitted from Derived). */
  companions?: CompanionState[];
}

/** Per-character polymorph state — see `CharacterDocument.polymorphForm`. */
export interface PolymorphFormState {
  /** Slug of the monster content row whose statblock the PC currently
   *  inhabits. */
  slug: string;
  /** Source feature/spell that granted the form (Wild Shape, Polymorph
   *  spell, Form of Dread, …). Used by the encounter runtime for
   *  cleanup-rule decisions (e.g. Wild Shape reverts to base on 0 HP). */
  sourceContent: { kind: string; slug: string };
  /** Form HP. Independent of `character.currentHp` — damage flows into
   *  the form's pool first, with overflow cascading to base. */
  currentHp: number;
  maxHp: number;
  /** Round count remaining at form-end. Null/absent = no timer (Wild
   *  Shape uses a per-rest resource instead of a per-encounter clock). */
  roundsRemaining?: number;
  /** RAW per Wild Shape vs Polymorph: 'base' (Wild Shape — saves use
   *  the PC's own ability scores) or 'form' (Polymorph — saves use the
   *  form's ability scores). The encounter runtime reads this when
   *  resolving forced saves on the form participant. Default 'form'. */
  formSaveSource?: 'base' | 'form';
}

/** Per-character companion entry — see `CharacterDocument.companions`. */
export interface CompanionState {
  /** Slug of the monster content row backing this companion. */
  slug: string;
  /** Player-chosen display name ("Greymane", "Mr. Whiskers", …). */
  name: string;
  /** Source feature/spell that granted the companion (Find Familiar,
   *  Beast Master, Drakewarden, …). Display + runtime cleanup. */
  sourceContent: { kind: string; slug: string };
  currentHp: number;
  maxHp: number;
  /** 'summoned' = visible on the tracker / Derived.companions; 'dismissed'
   *  = hidden but data preserved (familiar at rest, drake recalled). */
  status: 'summoned' | 'dismissed';
  /** Whether the companion acts on the controller's initiative slot
   *  (true — default for Beast Master, Drakewarden) or rolls its own
   *  (false — default for Find Familiar). Per the design doc's open
   *  question #1: the recommendation is a data field defaulting to
   *  true. derive() defaults missing values to `true`. */
  sharesInitiative?: boolean;
}

export interface ReceivedBuff {
  /** Stable id for the entry, unique on this character. Distinct from
   *  the spell slug so the same spell can appear twice (e.g. multiple
   *  +1 enhancement spells from different casters, though that's
   *  usually nonsense). */
  id: string;
  /** Slug of the spell row to apply. */
  spellSlug: string;
  /** Cast slot, when the spell carries scalingByCastSlot in its
   *  activation template. Defaults to the spell's level if unset. */
  slot?: number;
  /** Variant pick when the spell's activation declares static
   *  variants[] (skipped for variantsFromWeapons — the recipient
   *  doesn't pick the touched weapon). */
  variant?: string;
  /** Optional free-text source attribution: "from Cleric Vortha",
   *  "from the Sanctuary cleric's wand", etc. Display-only. */
  sourceLabel?: string;
}

export interface ActivationState {
  /** Whether the activation is currently on. */
  active: boolean;
  /** Uses remaining for per-rest activations; omit / null for unlimited. */
  usesRemaining?: number;
  /** For activations with variants[], the picked variant id. The picked
   *  variant's modifiers are synthesized when active=true. */
  variant?: string;
  /** For activations cast at a spell slot, the picked slot level. The
   *  engine resolves `scalingByCastSlot` value shapes against this slot
   *  at variant-modifier synthesis time so Magic Weapon's +1/+2/+3 by
   *  cast slot, Elemental Weapon's 1d4/2d4/3d4 by cast slot, etc., flow
   *  through correctly. When omitted, scaling values default to their
   *  baseSlotLevel row in the table. */
  slot?: number;
  /** Round number when this activation was last toggled on. Set by the
   *  encounter runtime when an in-encounter activation fires; the sheet
   *  ignores it. */
  activatedAtRound?: number;
}

export interface ContentRow {
  kind: string;
  slug: string;
  version: number;
  source: string;
  name: string;
  data: Record<string, unknown>;
}

export type ContentLookup = (ref: ContentRef) => ContentRow | undefined;

/** Stable key for keyed-content maps shipped from server → client. Author
 *  '_' means "global / pack content"; any other suffix is a user UUID. */
export function contentMapKey(kind: string, slug: string, authorUserId?: string | null): string {
  return `${kind}/${slug}/${authorUserId ?? '_'}`;
}

/** Build a ContentLookup over an author-keyed map (see contentMapKey). The
 *  server's buildContentLookup populates `map` in that shape; clients that
 *  receive the shipped map can reuse this helper instead of re-deriving the
 *  same fallback semantics. */
export function lookupFromMap(map: Record<string, ContentRow>): ContentLookup {
  return (ref) => {
    const exact = map[contentMapKey(ref.kind, ref.slug, ref.authorUserId)];
    if (exact) return exact;
    if (ref.authorUserId != null) return map[contentMapKey(ref.kind, ref.slug, null)];
    // Ref has no author hint and no global row matches. Fall back to any
    // owner-scoped row in the map. Inventory slots authored before we
    // started stamping authorUserId on add stay un-stamped, so a homebrew
    // item with no pack-row twin would otherwise silently fail to resolve.
    // `map` is already scoped by buildContentLookup to (pack + character
    // owner + subscribed authors), so any leftover match is appropriate.
    const prefix = `${ref.kind}/${ref.slug}/`;
    for (const key in map) {
      if (key.startsWith(prefix)) return map[key];
    }
    return undefined;
  };
}

// --- output types ---

export interface AbilityCell {
  score: number;
  mod: number;
}

export interface SaveCell {
  bonus: number;
  proficient: boolean;
  /** Save expertise — doubles the proficiency bonus on this save. Granted
   *  by `expertise.save.<ab>` modifier targets (currently only via the
   *  `elseAlready` conditional-on-existing-proficiency choice path, used
   *  by save-prof grants that route to expertise when the character is
   *  already proficient). Always implies proficient = true. */
  expertise: boolean;
  /** Unconditional advantage on this save (e.g. Resilient + Aura of Devotion).
   *  When true, every roll on this save is made with advantage regardless of
   *  what's being saved against. */
  advantage: boolean;
  disadvantage: boolean;
}

export interface SkillCell {
  bonus: number;
  ability: AbilityKey;
  proficient: boolean;
  expertise: boolean;
  /** Advantage on checks with this skill. Set by `skill.advantage.<slug>`
   *  / `skill.advantage.all` modifiers, by `check.advantage.<ability>` on
   *  the governing ability, or by equipped armor's `stealthDisadvantage`
   *  (disadvantage side). Both flags can be true simultaneously — derive
   *  just reports; they cancel at roll time (the runtime's business). */
  advantage: boolean;
  disadvantage: boolean;
  /** Bonus dice added to checks with this skill ('1d4' from a
   *  strixhaven primer / guidance-style item). Set by
   *  `skill.bonusDice.<slug>` modifiers and by `check.bonusDice.<ab>`
   *  on the governing ability. Display + roll-time contract — the
   *  numeric `bonus` never folds these in. Absent when empty. */
  bonusDice?: string[];
}

export interface StatBlock {
  abilities: Record<AbilityKey, AbilityCell>;
  saves: Record<AbilityKey, SaveCell>;
  skills: Record<string, SkillCell>;
  ac: number;
  hp: { current: number; max: number; temp: number };
  speeds: Record<string, number>;
  proficiencyBonus: number;
  initiative: number;
  /** Whether the character rolls initiative with advantage (Feywild Gift,
   *  Dread Ambusher, etc.). The encounter layer chooses how to use it. */
  initiativeAdvantage: boolean;
  /** Conditions/circumstances under which every save is made with advantage
   *  (e.g. "advantage on saves against being Frightened"). The
   *  damage/condition resolution layer matches the condition slug against
   *  this list. */
  savesAdvantageVs: string[];
  savesDisadvantageVs: string[];
  passivePerception: number;
  spellSaveDC: number | null;
  spellAttackBonus: number | null;
  spellcastingAbility: AbilityKey | null;
  spellSlots: Record<number, { max: number; used: number }>;
  totalLevel: number;
  resistances: Set<string>;
  immunities: Set<string>;
  vulnerabilities: Set<string>;
  /** Qualifiers per damage type, when the resist/immune/vulnerable applies
   *  only under a condition (`nonmagical`, `spell`, or a creature-type
   *  slug). Unqualified entries do not appear here. The flat
   *  resistances/immunities/vulnerabilities sets still contain every type
   *  for backward compatibility — the UI can iterate them; the
   *  damage-resolution layer consults these maps to decide whether the
   *  incoming damage actually qualifies. An unqualified entry trumps a
   *  qualified one (an unconditional resistance wins). */
  resistanceQualifiers: Record<string, string>;
  immunityQualifiers: Record<string, string>;
  vulnerabilityQualifiers: Record<string, string>;
  /** Structured source-predicates for resistance/immunity/vulnerability
   *  entries, keyed by damage type. Populated whenever a modifier
   *  carries a `sourcePredicate` field OR a legacy `qualifier` string
   *  that has a source-side interpretation (`'spell'`, `'magical'`,
   *  `'creatureType:<slug>'`). The encounter runtime evaluates these
   *  via `matchesDamageSource(predicate, event)` at damage-application
   *  time to decide whether the resistance actually applies to the
   *  incoming damage event. Unqualified entries (and qualifiers like
   *  `'nonmagical'` that only narrow the damage *kind*, not its source)
   *  do not appear here. */
  resistanceSourcePredicates: Record<string, DamageSourcePredicate>;
  immunitySourcePredicates: Record<string, DamageSourcePredicate>;
  vulnerabilitySourcePredicates: Record<string, DamageSourcePredicate>;
  /** Source-narrowed save-advantage entries. Captures the Gnome's Magic
   *  Resistance ("advantage on saves against magic") and Circle of the
   *  Land's "advantage on charmed/frightened saves against fey or
   *  elementals" patterns — flavors of save-advantage that the
   *  source-agnostic `save.advantage.X` / `savesAdvantageVs` lists
   *  can't express. Each entry has either an `ability` (a specific
   *  ability or `'all'`) or a `vsCondition` (the condition the save
   *  is against), plus a `sourcePredicate` to narrow by source. The
   *  encounter runtime evaluates entries when adjudicating saves;
   *  matching entries grant advantage on the roll.
   *
   *  An entry with no `sourcePredicate` is currently disallowed at
   *  derive() — unconditional save advantage flows through the
   *  existing `save.advantage.*` channels. The runtime treats an
   *  absent predicate as "matches everything" via
   *  `matchesDamageSource(undefined, …) === true`, so authoring an
   *  entry without a predicate is harmless but redundant. */
  savesAdvantageSourceQualified: SaveAdvantageSourceQualified[];
  senses: Record<string, number>; // darkvision, tremorsense, …
  /** Languages known. Populated from proficienciesChosen.languages plus any
   *  `proficiency.language.<slug>` modifier (class/species/feature/feat). */
  languages: string[];
  /** Tool proficiencies. Populated from proficienciesChosen.tools plus any
   *  `proficiency.tool.<slug>` modifier. */
  tools: string[];
  /** Armor proficiencies (`light`, `medium`, `heavy`, `shields`, plus any
   *  homebrew slug). Populated from `proficiency.armor.<slug>` modifiers. */
  armorProficiencies: string[];
  /** Weapon proficiency categories / slugs (`simple`, `martial`, individual
   *  weapon slugs like `longsword`). Populated from
   *  `proficiency.weapon.<slug>` modifiers. The class-based heuristic in
   *  computeAttackProficiency falls back to this set. */
  weaponProficiencies: string[];
  /** All attack rolls against this creature have Advantage (Paralyzed,
   *  Stunned, Unconscious, Petrified, Restrained, Blinded). Read by the
   *  encounter layer when adjudicating incoming attacks. */
  attackedAdvantage: boolean;
  /** All attack rolls against this creature have Disadvantage (Invisible). */
  attackedDisadvantage: boolean;
  /** Melee attack rolls against this creature have Advantage (Prone). */
  attackedByMeleeAdvantage: boolean;
  /** Ranged attack rolls against this creature have Disadvantage (Prone). */
  attackedByRangedDisadvantage: boolean;
  /** Any attack that hits this creature within 5 ft is a Critical Hit
   *  (Paralyzed, Petrified, Unconscious). Read by the encounter layer. */
  attackedWithin5ftAutoCrit: boolean;
  /** Raw ability-check advantage state per ability, from
   *  `check.advantage.<ab>` / `check.disadvantage.<ab>` modifiers.
   *  Skill cells of the ability already fold this in; this record is for
   *  raw (non-skill) checks. 'both' means both flags were granted — they
   *  cancel at roll time. Abilities with neither flag are absent. */
  abilityCheckAdvantage: Partial<Record<AbilityKey, 'advantage' | 'disadvantage' | 'both'>>;
  /** Bonus dice on raw ability checks per ability, from
   *  `check.bonusDice.<ab>` modifiers (value: a die string like '1d4').
   *  Skill cells of the ability already fold these into their own
   *  `bonusDice`; this record is for raw (non-skill) checks. Abilities
   *  with no dice are absent. */
  abilityCheckBonusDice: Partial<Record<AbilityKey, string[]>>;
  /** Curated capability flags from `trait.<slug>` modifiers (value true).
   *  Sorted + deduped. Any slug is allowed; canonical slugs are listed in
   *  docs/rules-engine.md (water-breathing, x-ray-vision, …). Consumers
   *  (UI badges, encounter runtime) interpret slugs they know. */
  traits: string[];
  /** Critical hits against this creature become normal hits (adamantine
   *  armor). Set by `tag.incoming-crit-immune`. Derive+type only — the
   *  encounter runtime consumes it when adjudicating incoming crits. */
  incomingCritImmune: boolean;
  /** Death saving throws are rolled with advantage. Set by
   *  `deathsave.advantage`. The sheet/runtime chooses how to surface it. */
  deathSaveAdvantage: boolean;
}

/** A single source-qualified save-advantage entry. Either an `ability`
 *  (a specific ability key, or 'all' for every save) is set OR
 *  `vsCondition` (the condition-against-which the save is made), but
 *  not both — and at least one must be set. `sourcePredicate` narrows
 *  by the source of the save (spell, magical, creature-type). */
export interface SaveAdvantageSourceQualified {
  /** Which save(s) the advantage applies to. 'all' means every
   *  ability save; an AbilityKey ('wis', 'con', …) means just that
   *  one. Mutually exclusive with `vsCondition`. */
  ability?: AbilityKey | 'all';
  /** Condition the save is against (e.g. 'charmed', 'frightened').
   *  The runtime matches against the save's `vsCondition` tag.
   *  Mutually exclusive with `ability`. */
  vsCondition?: string;
  /** Source narrowing — when set, the runtime only grants advantage
   *  if `matchesDamageSource(sourcePredicate, saveEvent)` is true. */
  sourcePredicate?: DamageSourcePredicate;
  /** Originating content row for UI attribution / debugging. */
  sourceContent?: { kind: string; slug: string };
}

export interface AppliedModifier {
  modifierId: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  /** Surface the limit declared on an action-modifier so the UI can show
   *  "1/turn", "1/short-rest", etc. The encounter runtime consumes the same
   *  shape from the resources model to actually enforce uses. */
  limit?: { per: string; uses: number };
}

export interface Action {
  id: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  type: string;
  cost: ActionCost;
  range?: { value: number; units: string };
  attackBonus?: number;
  damageRolls?: Array<{ formula: string; type: string }>;
  saveDC?: { ability: string; value: number };
  attackAbility?: AbilityKey;
  attackRange?: 'melee' | 'ranged';
  weaponProperties?: string[];
  /** Description prose surfaced to the planner UI / hover tooltip. Populated
   *  on synthesized Actions (maneuvers etc.) so the player can read the
   *  RAW effect without leaving the planner. Optional everywhere else. */
  description?: string;
  /** Class-resource id that this Action debits when it fires (e.g.
   *  `'superiority'` for Battle Master maneuvers, `'ki'` for Monk
   *  abilities). The planner reads `Derived.classResources` to size the
   *  spend (die or point); the encounter runtime debits via
   *  `spendResource(character, derived.classResources, action.spendsResource)`
   *  on resolution. */
  spendsResource?: string;
  /** How many units of `spendsResource` one use of this Action debits.
   *  Set on item-activity actions that declare `chargeCost` against
   *  their item's shared charge pool (Wand of Fireballs: 1 charge base,
   *  sibling activities author higher chargeCosts for bigger effects).
   *  Absent → the runtime debits 1 (legacy class-resource behavior). */
  resourceCost?: number;
  /** Free-text label for an optional extra damage rider added to this
   *  Action by a maneuver / class-resource spend (e.g.
   *  `"+1 superiority die (d8)"`). Display-only; the runtime resolves the
   *  actual die from `spendsResource` at roll time. */
  riderLabel?: string;
  /** Optional structured maneuver-rider attached to this Action. Surfaced
   *  by derive() when the action represents a maneuver effect; the
   *  planner reads this to render save / damage / movement riders without
   *  free-form parsing of `description`. */
  maneuverRider?: ManeuverRider;
  /** How the action selects affected creatures. Heuristic in derive(): self
   *  when range.units === 'self' or range.value === 0 with no attack/save;
   *  single when there's an attack roll; multi when there's a save DC with
   *  no attack; single fallback otherwise. Content rows can override via a
   *  `target` field on the spell/feature row or per-activity. */
  targetMode: 'self' | 'single' | 'multi';
  targetCount?: number;
  /** Number of times this attack action may be made as part of a single
   *  action (populated by Extra Attack feature; 1 = no extra attacks). */
  attackCount?: number;
  /** Natural-roll threshold at which this attack crits. Default 20.
   *  Champion's Improved Critical pushes it to 19, Superior Critical to 18.
   *  The crit.threshold modifier target is applied via DOWNGRADE mode. */
  critThreshold?: number;
  /** Number of extra weapon dice rolled on a crit (Savage Attacks etc.). */
  critExtraDie?: number;
  /** Minimum value on every damage die rolled (Great Weapon Fighting reroll
   *  1s and 2s — modeled here as a floor of 3). */
  damageDieMin?: number;
  /** Damage from this attack ignores the target's resistance (Magic Weapon
   *  master / certain feature riders). */
  damageIgnoreResistance?: boolean;
  /** Reroll all damage dice once and keep the higher result (Savage Attacker
   *  feat). */
  damageRerollAndKeepHigher?: boolean;
  /** Ranged attacks made with this action don't suffer disadvantage when an
   *  enemy is within 5 ft (Crossbow Expert). */
  attackNoDisadvantageWithin5ft?: boolean;
  /** This attack ignores half and three-quarters cover (Sharpshooter). */
  attackIgnoresCover?: boolean;
  /** Ranged attacks made with this action don't suffer disadvantage from
   *  long range (Sharpshooter). */
  attackNoDisadvantageLongRange?: boolean;
  /** Set when the action references an item choice slot (e.g. a
   *  cast-spell activity with `spell: { fromChoice: 'spell' }`) whose
   *  pick hasn't been recorded on the inventory slot yet. The value is
   *  the choice-slot name. The action realizes as a stub (no inlined
   *  attack/save/damage) and the gap is surfaced on
   *  `Derived.pendingItemChoices` — no validation warning fires. */
  needsChoice?: string;
  /** Trigger id this action is gated on. When set, the action is only
   *  available *after* the named trigger has fired this turn/round (e.g.
   *  War Magic grants a bonus-action weapon attack after casting a
   *  cantrip — the BA attack is gated on the spell-cast trigger). The UI
   *  shows the action with a "available after X" hint; the encounter
   *  runtime gates execution. */
  gatedOnTrigger?: string;
  /** For leveled spells whose damage / target count / heal scales with
   *  the slot level expended. The base values on this Action are written
   *  for `baseSlotLevel`; the encounter runtime / planner picks an
   *  actual slot and calls `applyUpcast(action, slot)` to get the
   *  scaled Action. Absent → no scaling (cantrips with character-level
   *  scaling use the activity's `perTotalLevel` table, not this field). */
  upcastScaling?: UpcastScaling;
  /** Side effects on the caster that apply when this Action resolves —
   *  granted resources / temp HP / conditions. Surfaced from a spell or
   *  feature activity's `grants` field. Encounter runtime / planner
   *  folds these into character state (e.g. tempHp into HpState.tempHp
   *  via applyDamageDelta). Spells like Armor of Agathys (5 temp HP on
   *  cast) drive this. */
  grants?: ActionGrants;
  /** Companion-summoning payload — set on `type: 'summon'` activities.
   *  The sheet / encounter runtime reads this to append CompanionState
   *  entries to `character.companions` when the action resolves (see
   *  ActionSummons for the choice-vs-all semantics). */
  summons?: ActionSummons;
  /** Structured self-teleport payload, mirrored from the activity's
   *  `teleport` block (boots of the winding path, shard solitaire's
   *  Rift Step). Display contract — movement/positioning stays
   *  DM-adjudicated. `distanceFt` absent → unlimited/scene-scoped;
   *  `mode` 'line-of-sight' (default reading) vs 'unrestricted'
   *  (can pass barriers / no sight needed). */
  teleport?: { distanceFt?: number; mode?: 'line-of-sight' | 'unrestricted' };
  appliedModifiers: AppliedModifier[];
}

/** Resolved summon payload on an Action (from a `type: 'summon'`
 *  activity's `summon` block). Creature counts are evaluateValue-resolved
 *  at derive() time (default 1). */
export interface ActionSummons {
  creatures: Array<{
    /** Monster content-row slug backing the summoned creature. */
    slug: string;
    /** How many copies one use of the action summons (already resolved
     *  from the authored number / magic string; default 1). */
    count: number;
    /** Authored display-name override for the summoned creature. */
    name?: string;
    /** Monster row's name when the ContentLookup resolved the slug.
     *  Absent → the row wasn't found (a `summon-missing-content` soft
     *  warning fires in that case). */
    resolvedName?: string;
  }>;
  /** true → the player picks ONE entry from `creatures`; false → every
   *  entry is summoned together. */
  choice: boolean;
  /** Display-only duration, mirrored from the authored activity. The
   *  engine doesn't tick a countdown — dismissal is manual. */
  duration?: ActivationDuration;
}

/** Battle Master / Martial Adept / Superior Technique maneuver content
 *  model. Authored on a parent class/subclass feature row's
 *  `data.maneuvers: ManeuverDecl[]`. The player picks N of them via
 *  `data.choices.maneuvers = { picks: ..., allowedIds?: [...] }` and
 *  records picks in `character.featureChoices[slug].maneuvers =
 *  [{ maneuverId: '...' }, ...]`. derive() finds each picked maneuver
 *  in the catalog and synthesizes the corresponding Action / Trigger /
 *  OutboundEffect (per `effect.kind`) carrying `spendsResource:
 *  'superiority'` so the planner knows which class resource to debit. */
export interface ManeuverDecl {
  /** Slug-style identifier — referenced from
   *  `character.featureChoices[slug].maneuvers[].maneuverId` and used
   *  as the synthesized Action / Trigger id suffix. */
  id: string;
  name: string;
  description: string;
  /** Action-economy cost to invoke the maneuver. RAW maneuvers cost
   *  `'free'` (riders on an attack), `'reaction'` (Riposte, Parry),
   *  `'bonus'` (Commander's Strike, Rally), or rarely `'action'`. */
  cost: 'free' | 'bonus' | 'reaction' | 'action';
  /** Class-resource id whose pool funds this maneuver. v1: always
   *  `'superiority'`; the field is future-proofed for Monk Focus etc. */
  spendsResource: string;
  effect: ManeuverEffect;
}

/** Discriminated union of maneuver effect shapes. Each kind drives a
 *  different derive() emission (Action vs. Trigger vs. OutboundEffect).
 *  See WS1 design plan ("Synthesis" section) for the per-kind output. */
export type ManeuverEffect =
  | {
      kind: 'on-hit-rider';
      /** Adds a damage die from the spent class-resource pool to the
       *  triggering attack's damage on hit. */
      damageRider?: { dieFromResource: string; type: string };
      /** Save imposed on the target on hit. */
      save?: {
        ability: AbilityKey;
        dc: { calc: 'maneuver' } | { value: number };
        onFail: ManeuverSaveEffect;
      };
      /** Caps the maneuver to targets of the given size or smaller
       *  (RAW Trip Attack / Pushing Attack exclude Huge+). */
      maxTargetSize?: 'medium' | 'large';
    }
  | {
      kind: 'pre-roll';
      /** Adds the spent resource's die to a roll BEFORE seeing the
       *  result. RAW Precision Attack adds to the attack roll. */
      addsToRoll: 'attack';
      dieFromResource: string;
    }
  | {
      kind: 'damage-reduction';
      /** Reduces incoming damage by `dieFromResource` (+ optional ability
       *  mod). Powers Parry. */
      reduceBy: { dieFromResource: string; addAbilityMod?: AbilityKey };
      /** Trigger event slug surfaced by the encounter runtime when the
       *  player takes damage matching the maneuver's RAW filter (e.g.
       *  `'damage.taken'` for Parry's melee filter). */
      triggerOn: string;
    }
  | {
      kind: 'reaction-attack';
      /** Trigger event slug that arms the maneuver (e.g.
       *  `'attack.targets-self.miss'` for Riposte's "creature misses you
       *  with a melee attack"). */
      triggerOn: string;
      attackType: 'melee-weapon' | 'weapon';
      damageRider: { dieFromResource: string; type: string };
    }
  | {
      kind: 'ally-attack';
      /** Resource cost on the maneuver user (bonus action). */
      costOnSelf: 'bonus' | 'action';
      /** Resource cost on the ally who gets the bonus weapon attack. */
      costOnAlly: 'reaction';
      attackType: 'weapon';
      damageRider: { dieFromResource: string; type: string };
    }
  | {
      kind: 'temp-hp-grant';
      costOnSelf: 'bonus' | 'action';
      tempHp: { dieFromResource: string; addAbilityMod?: AbilityKey };
      /** When set, the maneuver targets `'self'` or `'ally'`. RAW Rally
       *  grants temp HP to one ally. */
      targets?: 'self' | 'ally';
    }
  | {
      kind: 'target-free-move';
      /** Distance the target may move without provoking opportunity
       *  attacks (RAW Maneuvering Attack: "up to half the ally's
       *  speed"). The encounter runtime evaluates the distance at
       *  resolution time. */
      distance: 'half-ally-speed' | { feet: number };
    };

/** Effect applied to a saving-throw target on a failed save (`save.onFail`
 *  on an `on-hit-rider` maneuver). Discriminated by `kind`. */
export type ManeuverSaveEffect =
  | { kind: 'condition'; condition: 'prone' | 'frightened' | 'restrained' | 'grappled' }
  | { kind: 'drop-item'; targets: 'held-item' }
  | { kind: 'forced-move'; distance: number }
  | { kind: 'disadvantage-against-others' }
  | { kind: 'forced-move-target'; distance: number };

/** Subset of ManeuverEffect surfaced on a synthesized Action.maneuverRider
 *  so the planner UI can render save / damage / movement riders structured.
 *  Mirrors the authoring shape minus the discriminating `kind` (since the
 *  Action's `type` already encodes the synthesis kind). */
export interface ManeuverRider {
  /** Damage die added to the action on hit/cast. */
  damageRider?: { dieFromResource: string; type: string };
  /** Save imposed on the target. `dcValue` is the resolved DC at
   *  derive() time (8 + PB + best STR/DEX mod for `{calc: 'maneuver'}`). */
  save?: {
    ability: AbilityKey;
    dcValue: number;
    onFail: ManeuverSaveEffect;
  };
  /** Caps target size for the rider (e.g. Trip Attack — Large or smaller). */
  maxTargetSize?: 'medium' | 'large';
  /** Temp HP granted on resolution (Rally). */
  tempHp?: { dieFromResource: string; addAbilityMod?: AbilityKey };
  /** Reduction die / mod applied to incoming damage (Parry — flagged so
   *  the planner can preview the reduction amount). */
  reduceBy?: { dieFromResource: string; addAbilityMod?: AbilityKey };
  /** Free-move distance for the target (Maneuvering Attack). */
  freeMove?: 'half-ally-speed' | { feet: number };
}

export interface ActionGrants {
  /** Temp HP granted to the caster on resolution. Numeric values are
   *  resolved against the caster's context at derive() time; dice
   *  formulas (e.g. '1d4+4' for False Life) pass through as strings for
   *  the runtime / player to roll. Casting at a higher slot scales via
   *  UpcastScaling.extraTempHpPerSlot (numeric additions stack on top
   *  of the formula as a separate display: '1d4+4 (+5 per slot above 1)'). */
  tempHp?: number | string;
  /** Conditions removed from the target when the activity resolves
   *  (Lesser Restoration, a paladin's Restoring Touch, potions). A plain
   *  string removes the condition entirely; the object form with `stacks`
   *  decrements `conditionStacks` by N, removing the condition at 0.
   *  `stacks` is numeric-only (no evaluateValue formulas). Currently
   *  display-only on the sheet — grants have no auto-apply path yet. */
  removeConditions?: Array<string | { condition: string; stacks?: number }>;
  /** Expended spell slots restored when the activity resolves
   *  (spell-refueling ring: one slot of level ≤ 3). `level` is the
   *  maximum slot level restorable; `count` is how many slots (default
   *  1). Display-only like tempHp / removeConditions — the player
   *  un-spends the slot on the sheet. */
  restoreSpellSlots?: { level: number; count?: number };
}

export interface UpcastScaling {
  /** Slot level the base values on this Action are written for.
   *  Casting at slot < baseSlotLevel is illegal (engine clamps).
   *  Casting at slot >= baseSlotLevel applies (slot - baseSlotLevel)
   *  steps of each scaling field. */
  baseSlotLevel: number;
  /** Per-slot-above-base extra damage roll added to the first damage
   *  part (Fireball: '1d6'; Burning Hands: '1d6'). */
  extraDamagePerSlot?: string;
  /** Per-slot-above-base flat damage add to the first damage part
   *  (Inflict Wounds: 1d10 per slot, but the prose phrases as flat
   *  additional dice — same shape as extraDamagePerSlot for that case;
   *  this field is reserved for rare numeric-only adds). */
  extraFlatDamagePerSlot?: number;
  /** Per-slot-above-base extra target count (Magic Missile: 1 dart per
   *  slot; Hold Person: 1 additional target per slot). */
  extraTargetsPerSlot?: number;
  /** Per-slot-above-base extra heal die (Cure Wounds: '1d8'; Healing
   *  Word: '1d4'). Applied to the activity's heal-die formula. */
  extraHealPerSlot?: string;
  /** Per-slot-above-base extra temp HP granted on cast (Armor of
   *  Agathys: 5 per slot; False Life: 5 per slot). Stacks onto
   *  Action.grants.tempHp. */
  extraTempHpPerSlot?: number;
}

export type ActionCost =
  | 'action'
  | 'bonus'
  | 'reaction'
  | 'free'
  | { uses: number; per: 'turn' | 'round' | 'short-rest' | 'long-rest' | 'day' }
  /** Movement-only action (Disengage replaced by movement-style content, etc.).
   *  `feet` is the cost from the character's movement speed budget for the turn. */
  | { movement: number }
  /** Activation funded by spending Hit Dice (crown of the wrath bringer,
   *  delver's claws). Display contract — `costLabel` renders "N Hit
   *  Dice"; the player debits `character.hitDiceSpent` manually via the
   *  sheet's hit-dice row (no auto-spend path exists for action costs). */
  | { hitDice: number };

/** Known trigger event names. The engine validates trigger declarations
 *  against this list and emits a soft validation warning on unknowns so
 *  pack authors get feedback on typos. The encounter runtime is what
 *  actually fires events. Add new names here when a pack legitimately
 *  needs a new lifecycle hook. */
export const KNOWN_TRIGGER_EVENTS = [
  // Attack lifecycle (self-as-attacker)
  'attack.declare',
  'attack.hit',
  'attack.crit',
  'attack.miss',
  'attack.reduce-to-zero',
  // Alias of attack.hit used by weapon-scoped triggers in some pack versions
  // (e.g. Soulknife Psychic Blades' sneak-attack rider)
  'weapon.hit',
  // Action-taken lifecycle: fires when a participant takes a whole action.
  // The action log classifies rows by actionId ('attack:*' → the Attack
  // action); Crossbow Expert / War Priest bonus-action attacks ride these.
  'action.attack',
  'action.dash',
  // Save / check / ability-check lifecycle
  'save.declare',
  'save.fail',
  'check.declare',
  // Specialized save.declare: a save/check made to end the grappled
  // condition (Goliath Powerful Build advantage rider)
  'save.to-end-grappled',
  // A death saving throw is about to be rolled — gambler's-blade
  // death-save penalty / periapt-style death-save riders
  'death-save.declare',
  // Condition lifecycle: fires when the named condition is applied to a
  // participant (Goliath Hill's Tumble knock-prone rider)
  'condition.apply.prone',
  // Damage taken (self-as-target)
  'damage.taken',
  'damage.reduce-to-zero',
  'attack.targets-self.declare',
  'attack.targets-self.hit',
  // Alias used by rogue uncanny-dodge / monk deflect-attacks in some pack versions
  'self.hit-by-attack',
  // Spell lifecycle
  'spell.cast',
  'spell.cast.within-5ft',
  'spell.slot-spent',
  // A spell targeting the wearer was absorbed via a `spell.absorb`
  // trigger grant (rod of absorption / ioun stone of absorption) —
  // downstream riders can key off the absorption having happened
  'spell.absorbed',
  // The participant spends sorcery points on a Metamagic option —
  // Tasha's sorcerer shards (astral / feywild / far-realm / shadowfell
  // shard, elemental- and outer-essence shards) ride it
  'metamagic.used',
  // Turn / round lifecycle
  'turn.start',
  'turn.end',
  'round.start',
  // Rest lifecycle
  'rest.short-rest.end',
  'rest.long-rest.end',
  // Alias of rest.long-rest.end used by some pack versions (PHB-2024
  // Human Resourceful heroic-inspiration refresh)
  'rest.long',
  // Ally / enemy lifecycle
  'creature.attack.hit',
  // Enemy-POV declare/damage lifecycle: an enemy declares an attack roll /
  // ability check, or deals damage — SRD Cutting Words rides all three
  // (fireable from the enemy participant's action-log rows)
  'enemy.attack.declare',
  'enemy.check.declare',
  'enemy.damage.dealt',
  'creature.takes-fall-damage',
  'creature.turn-start',
  'creature.reduce-to-zero',
  'enemy.reduce-to-zero',
  'enemy.dies-within-range',
  'enemy.disengages-within-5ft',
  'enemy.enters-reach',
  // Alias of enemy.enters-reach used by Battle Master maneuver
  // `effect.triggerOn` in some pack versions (Brace / opportunist riders)
  'creature.enters-reach',
  // A creature starts moving within the participant's threat range —
  // Battle Master maneuver riders (e.g. Brace) declare this via
  // `effect.triggerOn`; the DM raises it from the encounter log
  'movement.start',
  'ally.attacked-within-5ft',
  // Alias of enemy.reduce-to-zero used by some pack versions (XGtE
  // Hexblade's Curse kill-to-refresh rider)
  'creature.killed',
  // An ally rolls a natural 1 on a d20 test — fireable from action-log
  // rows with hit='fumble' scoped to allies (XGtE Bountiful Luck)
  'ally.rolls.1'
] as const;
export type TriggerEvent = (typeof KNOWN_TRIGGER_EVENTS)[number];

/** Grant payload on a TriggerDeclaration. Discriminated by `type`. The
 *  encounter runtime maps each grant to a player choice (e.g. "do you want
 *  to use Heavy Armor Master to reduce this damage?").
 *
 *  The three `*.rider` / `hp.max-reduce` shapes are the canonical on-hit
 *  rider contracts for magic weapons (Flame Tongue's fire rider, a Sword
 *  of Wounding's max-HP drain, a venomous blade's poison save). Runtime
 *  stays DM-adjudicated — these are structured display contracts so the
 *  planner / sheet can render the rider without parsing prose. */
export type TriggerGrant =
  | { type: 'force-reroll' }
  | { type: 'damage.reduce'; amount: number | string }
  | { type: 'damage.reflect'; amount: number | string }
  | { type: 'impose-disadvantage'; on: 'attack' | 'save' | 'check' }
  | { type: 'convert-hit-to-miss' }
  | { type: 'bonus-action-weapon-attack' }
  | { type: 'reaction-weapon-attack' }
  /** Extra damage added to the triggering hit ("+2d6 fire on hit"). The
   *  optional save halves (`half: true`) or negates the rider damage. */
  | {
      type: 'damage.rider';
      amount: string;
      damageType: string;
      save?: { ability: AbilityKey; dc: number; half?: boolean };
    }
  /** Condition imposed on the target of the triggering hit ("target is
   *  poisoned for 1 minute, CON 15 negates"). */
  | {
      type: 'condition.rider';
      condition: string;
      save?: { ability: AbilityKey; dc: number };
      duration?: { value: number; units: string };
    }
  /** The target's HP maximum is reduced (Sword of Life Stealing /
   *  Wounding patterns). `amount` is a dice formula or flat number
   *  string; restoration timing is the DM's business. */
  | { type: 'hp.max-reduce'; amount: string }
  /** Forgo the triggering d20 roll and use `value` instead (clockwork
   *  amulet's take-10 on an attack roll). Display contract — the DM
   *  applies the substitution at the table. */
  | { type: 'd20.replace'; value: number }
  /** The triggering failed save becomes a success (ring of evasion's
   *  DEX conversion, mind-sharpener's INT patterns). Usually rides
   *  `save.fail`; uses are metered by `limit` / `spendsResource`. */
  | { type: 'save.convert-fail-to-success' }
  /** Grants a reroll of the triggering d20 test — luck / fragment-of-
   *  possibility style. `die` names the extra die rolled alongside
   *  (default the d20 itself); the pool funding the reroll is declared
   *  via `spendsResource` / `limit` on the trigger. */
  | { type: 'reroll.grant'; die?: string }
  /** On-death contingency: instead of dying / dropping to 0 HP, the
   *  wearer returns with `hp` hit points (ring of temporal salvation,
   *  amulet of duplicity). `hp` is a flat number or dice formula;
   *  absent → 1 HP. Display contract — the DM adjudicates timing. */
  | { type: 'contingency.revive'; hp?: number | string }
  /** Absorb the triggering spell instead of suffering its effect (rod
   *  of absorption / ioun stone of absorption capture reaction).
   *  `maxLevels` caps total absorbable spell levels. Display contract
   *  only — there is no runtime absorption; items that also cast from
   *  the absorbed pool model that side via `data.spellStorage`. */
  | { type: 'spell.absorb'; maxLevels?: number }
  | { type: string; [k: string]: unknown }; // forward-compat: unknown grant shapes still pass through

export interface TriggerDeclaration {
  id: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  on: string[];
  scope?: unknown;
  grants?: TriggerGrant;
  limit?: { per: string; uses: number };
  /** Class-resource id whose pool funds invocation of this trigger
   *  (e.g. `'superiority'` for Battle Master Riposte / Parry). The
   *  planner reads this to decide whether the player has budget left;
   *  the encounter runtime debits the pool on use. */
  spendsResource?: string;
  /** Description prose surfaced to the encounter / planner UI when
   *  surfacing the trigger opportunity. */
  description?: string;
  /** Optional structured rider attached to the trigger (e.g. Parry's
   *  damage-reduction die + ability mod) so the planner can render the
   *  effect without parsing prose. */
  maneuverRider?: ManeuverRider;
}

export interface Resource {
  id: string;
  name: string;
  max: number;
  used: number;
  per: string;
  sourceContent: { kind: string; slug: string };
  /** Condition slug auto-applied when the player consumes this resource. */
  appliesCondition?: string;
  /** Description prose shown on hover in the UI. */
  description?: string;
}

/** Per-class spendable pool (Bardic Inspiration, Ki / Focus, Sorcery Points,
 *  Superiority Dice, Psionic Energy Dice, Channel Divinity uses, Wild Shape
 *  uses, Rage uses, etc.). Authored on the class content row's
 *  `data.resources` array; derive() surfaces the resolved pool on
 *  `Derived.classResources` after composing levels and proficiency bonus.
 *
 *  Both die-based pools (Bardic Inspiration, Superiority Dice, Psi-Energy)
 *  and point-based pools (Ki, Sorcery Points, Channel Divinity uses, Rage
 *  uses) are first-class — `spendKind` disambiguates. The pool's `max`
 *  field accepts the same value shapes that activation `uses.max` does:
 *  a literal number, a string token (`'proficiencyBonus'`, `'monkLevel'`,
 *  arithmetic like `'2 * proficiencyBonus'`), or the perClass-table shape
 *  (`{perClass: 'fighter', table: [0, 0, 4, 4, ...]}`). Same for `dieSize`
 *  — fixed string ('d6') or perClass-table of strings for level-scaled
 *  dice. */
export interface ClassResourceDecl {
  /** Stable id — keyed in `character.resourcesSpent` and on
   *  `Derived.classResources`. */
  id: string;
  /** Human label rendered by the sheet. */
  name: string;
  /** Pool maximum. Evaluated by `evaluateValue` against the character
   *  context, so any shape that resolver accepts is legal. */
  max: number | string | { perClass: string; table: Array<number | string> };
  /** Die size for die-based pools ('d4'|'d6'|'d8'|'d10'|'d12'). Use a
   *  perClass-table of strings (`{perClass: 'bard', table: ['d6', 'd6', ...,
   *  'd8', ..., 'd10', ..., 'd12']}`) for level-scaling dice. Omit on
   *  point-based pools (Ki, Sorcery Points). */
  dieSize?: string | { perClass: string; table: string[] };
  /** When the pool refills. `'per-turn'` / `'per-round'` are reserved for
   *  future use (no current consumer); `'short-rest'` and `'long-rest'`
   *  drive the `refreshResourcesOnRest` helper today. Per RAW, long rest
   *  refreshes short-rest pools too. */
  refresh: 'short-rest' | 'long-rest' | 'per-turn' | 'per-round';
  /** Whether each spend consumes a single die from the pool (BI,
   *  Superiority, Psi-Energy) or a stackable point count (Ki, Sorcery,
   *  Channel Divinity, Rage). The shapes are equivalent for
   *  bookkeeping — the field is informational for the UI and downstream
   *  spend semantics. */
  spendKind: 'die' | 'point';
}

/** Resolved class-resource snapshot emitted on `Derived.classResources`.
 *  Created by walking each active class row's declared `data.resources`
 *  array, evaluating `max` / `dieSize` against the character's context,
 *  and folding in any spend recorded on `character.resourcesSpent[id]`. */
export interface ResolvedClassResource {
  id: string;
  name: string;
  /** Slug of the class row that contributed the declaration. */
  sourceClassSlug: string;
  /** Resolved pool maximum. */
  max: number;
  /** Resolved die size ('d10', etc.) when the underlying declaration had
   *  one. Omitted for point-based pools. */
  dieSize?: string;
  refresh: 'short-rest' | 'long-rest' | 'per-turn' | 'per-round';
  spendKind: 'die' | 'point';
  /** `max - (character.resourcesSpent[id] ?? 0)`, clamped to [0, max]. */
  current: number;
}

export interface ValidationIssue {
  severity: 'warning' | 'error';
  code: string;
  message: string;
}

export interface AvailableToggle {
  id: string;
  name: string;
  defaultEnabled: boolean;
  currentlyEnabled: boolean;
  sourceContent: { kind: string; slug: string };
}

/** Effects this character emanates onto allies/enemies within a radius —
 *  Paladin auras, Bardic Inspiration, Aura of Warding, etc. The encounter
 *  layer reads this manifest and applies the contained modifiers to
 *  affected creature tokens. Derive only emits the declaration. */
export interface OutboundEffect {
  id: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  /** Radius in feet, measured from this character's space. */
  rangeFt: number;
  /** Selector for affected creatures. `ally` includes self by default
   *  unless `excludeSelf` is set; `creature` matches anyone in range. */
  targets: 'ally' | 'enemy' | 'creature' | 'self';
  excludeSelf?: boolean;
  /** Whether the effect requires the source to be conscious / not
   *  incapacitated. Encounter layer enforces. */
  requiresAlive?: boolean;
  /** Stat-modifier entries applied to each affected creature. */
  modifiers?: Array<Record<string, unknown>>;
  /** Gated on a condition the source must be in (Rage, Concentrating). */
  appliesWhen?: { condition?: string };
}

export interface Derived {
  stats: StatBlock;
  actions: Action[];
  triggers: TriggerDeclaration[];
  resources: Resource[];
  validations: ValidationIssue[];
  toggles: AvailableToggle[];
  /** Spell slugs auto-prepared by a feature/subclass/feat `spellListAdditions`
   *  field. Composited with the player's `character.spells.prepared` list.
   *  The UI labels them as "always prepared from <source>". */
  alwaysPreparedFromContent: string[];
  /** Aura/multi-target effects this character emanates onto nearby
   *  creatures. Consumed by the encounter layer to derive ally-side
   *  modifiers. */
  outboundEffects: OutboundEffect[];
  /** Overlay HP pools — independent HP buckets that absorb damage before
   *  the character's main HP and that can persist across encounters.
   *  Emitted from `overlay-hp-pool` modifier rows on features like
   *  Arcane Ward. Pool current values are tracked by the encounter
   *  runtime; derive() only declares the pool's existence, max, and
   *  refresh policy. */
  overlayHpPools: OverlayHpPool[];
  /** Per-feature menu picks that the player either has recorded or still
   *  needs to record. Emitted from any active feature / subclass row
   *  carrying a `data.choices` declaration. The UI walks this to render
   *  picker affordances (skill prof, expertise, language, sub-feature, …)
   *  and writes selections back into `character.featureChoices[slug]`
   *  (or `character.subclassChoices[slug]` for subclass-row picks). */
  pendingFeatureChoices: PendingFeatureChoice[];
  /** Per-inventory-slot choice manifest — one entry per choice slot
   *  declared by an equipped item's `data.choices`. Mirrors the intent
   *  of pendingFeatureChoices but keyed by inventory position, since
   *  the pick lives on the InventorySlot (two copies of a Spell Scroll
   *  hold different spells). The sheet walks this to render pickers and
   *  writes selections into `character.inventory[slotIndex].choices`. */
  pendingItemChoices: PendingItemChoice[];
  /** Player-toggleable activations declared on active feature / spell rows
   *  (Bladesong, Rage, Form of Dread, Magic Weapon, etc.). The sheet
   *  renders a toggle per entry; toggling on writes
   *  `character.activations[id].active = true`, which derive() reads back
   *  on the next pass to inject the activation's `condition` slug into
   *  resolved conditions (gating appliesWhen.condition modifiers) and
   *  to synthesize the picked variant's modifiers when applicable. */
  availableActivations: AvailableActivation[];
  /** Denormalized equipped-inventory summary, shared by the AC formula
   *  and the activation auto-cancel walk. armorType is null when the
   *  character has no armor body slot equipped (i.e. unarmored). shield
   *  reflects whether any equipped item is `armorType: 'shield'`. */
  equipped: EquippedInventory;
  /** Statblock active when the character is polymorphed. Absent in
   *  base form. The encounter layer / sheet renders this in place of
   *  the base stats when present; base resources / spell slots remain
   *  visible because the form doesn't consume them (with the exception
   *  of Wild Shape uses, which is a separate resource entry). */
  activeForm?: ActiveForm;
  /** Companions the character controls. derive() walks
   *  `character.companions` (filtered to `status: 'summoned'`) and
   *  produces a Derived-shaped snapshot per entry by running
   *  `monsterDerive` against the form's statblock data. The encounter
   *  participant row for the PC will eventually carry a
   *  `controllerForParticipants: string[]` field that links companion
   *  participant rows back to their controller — that's a follow-on
   *  phase (5a API). */
  companions?: DerivedCompanion[];
  /** Resolved class-resource pools currently available to the character
   *  (Bardic Inspiration, Ki / Focus, Sorcery Points, Superiority Dice,
   *  Psionic Energy Dice, Channel Divinity uses, Wild Shape uses, Rage
   *  uses, …). Sourced from active class rows' `data.resources`
   *  declarations. Multi-class edge: when two class rows declare the
   *  same resource id, the first class with the declaration wins (the
   *  later declaration is dropped silently in v1; the runtime emits no
   *  validation since this is a vanishingly rare RAW collision). */
  classResources?: ResolvedClassResource[];
}

/** Polymorph form snapshot emitted by derive() — see `Derived.activeForm`. */
export interface ActiveForm {
  sourceContent: { kind: string; slug: string };
  statblock: MonsterDerived;
  /** Modifiers from base feature/feat/species rows carrying
   *  `persistsInForm: true`. The encounter runtime overlays these on
   *  top of `statblock` when rendering form actions / saves. Without
   *  the flag, base PC modifiers don't propagate to the form snapshot. */
  persistentModifiers: Array<Record<string, unknown>>;
  /** Mirrored from `PolymorphFormState.formSaveSource`, defaulted to
   *  'form' when omitted on the source state. */
  formSaveSource: 'base' | 'form';
  /** Mirrored from `PolymorphFormState.currentHp`. */
  currentHp: number;
  /** Mirrored from `PolymorphFormState.maxHp`. */
  maxHp: number;
  /** Mirrored from `PolymorphFormState.roundsRemaining`, defaulted to
   *  null when the form has no timer. */
  roundsRemaining: number | null;
}

/** Companion snapshot emitted by derive() — see `Derived.companions`. */
export interface DerivedCompanion {
  slug: string;
  name: string;
  statblock: MonsterDerived;
  currentHp: number;
  maxHp: number;
  /** Always 'summoned' on Derived (dismissed entries are filtered out
   *  by derive()). Kept on the shape so downstream code reading the
   *  Derived view doesn't have to special-case absent status. */
  status: 'summoned';
  /** Defaulted to true when omitted on the underlying `CompanionState`. */
  sharesInitiative: boolean;
}

export interface EquippedInventory {
  armorType: 'light' | 'medium' | 'heavy' | null;
  shield: boolean;
}

export interface ActivationDuration {
  value: number;
  units: 'round' | 'turn' | 'minute' | 'hour';
}

export interface ActivationVariant {
  id: string;
  label: string;
  /** Modifier rows synthesized when this variant is the picked variant
   *  AND the parent activation is active. Same shape as modifierFromChoice
   *  option modifiers — stat-modifier / action-modifier / overlay-hp-pool. */
  modifiers?: Array<Record<string, unknown>>;
}

/** Authored on a feature / spell / item row's `data.activations[]`. */
export interface ActivationDeclaration {
  /** Stable slug used as the key in `character.activations`. Distinct
   *  from `condition` (the slug injected into resolvedConditions when
   *  active) so multiple activations can target the same condition slug
   *  if needed. */
  id: string;
  name: string;
  description?: string;
  /** Inventory-state gate for item-sourced activations. `requires:
   *  'equipped:attuned'` hides the activation until the item's slot is
   *  attuned; `'equipped'` (or absence, on a non-attunement item) is the
   *  baseline. See derive.ts itemRequirementMet for full semantics. */
  appliesWhen?: { requires?: string };
  /** Action economy cost to activate. Display-only — the planner uses
   *  this to surface "BA to start" in the activation panel. */
  cost?: 'action' | 'bonus' | 'reaction' | 'free' | 'none';
  /** Display-only duration string the sheet renders alongside the toggle.
   *  Game-time only — the engine doesn't tick a count-down. Player toggles
   *  off manually when the in-fiction duration ends. */
  duration?: ActivationDuration | 'persistent';
  /** Per-rest use cap. `max` is evaluated via evaluateValue — accepts
   *  literal numbers, magic strings ('proficiencyBonus', 'wisMod',
   *  `classLevel:<slug>`, arithmetic like 'max(1, intMod)'), and the
   *  perClass-table shape used by activity-level uses for things like
   *  rage (`{perClass: 'barbarian', table: [2,2,3,3,3,4,…]}`). `per`
   *  controls when refreshActivations() resets uses back to max.
   *  `'week'` (night-caller, cauldron of rebirth) is never reset by any
   *  rest — the player restores uses manually via the resource counter
   *  when the in-fiction week has passed (the sheet has no calendar). */
  uses?: {
    max: number | string | { perClass: string; table: Array<number | string> };
    per: 'short-rest' | 'long-rest' | 'day' | 'week';
  };
  /** True if this activation requires concentration. Toggling on cancels
   *  any other concentration the character is currently maintaining. */
  concentration?: boolean;
  /** Mutually-exclusive band — only one activation per group can be
   *  active at a time. Toggling one on auto-cancels others in the group
   *  (Wild Heart Aspect: owl/panther/salmon are in the same group; Rage
   *  of the Wilds: bear/eagle/wolf are in the same group). */
  group?: string;
  /** Slug injected into resolvedConditions when active=true. Existing
   *  appliesWhen.condition modifiers gated on this slug fire on the
   *  next derive() pass. */
  condition: string;
  /** Conditions and inventory states whose presence auto-cancels this
   *  activation. String entries match the character's conditions[] list
   *  (e.g. "incapacitated"). Object entries match equipped inventory:
   *  `{wearing: 'armor.medium'|'armor.heavy'|'armor.light'|'shield'}`
   *  fires when the character currently has that armor type / a shield
   *  equipped. The activations module's auto-cancel walk evaluates both
   *  kinds against character + EquippedInventory state. */
  autoCancelOn?: AutoCancelEntry[];
  /** Variant menu — when set, the player picks one variant when
   *  activating; the picked variant's modifiers are synthesized while
   *  the activation is active (replaces the now-deprecated
   *  modifierFromChoice usage for activation-tied picks). */
  variants?: ActivationVariant[];
  /** Dynamic per-weapon variants. When set, derive() generates a
   *  variant per equipped weapon in the character's inventory and
   *  exposes the menu on availableActivations[]. On activation, the
   *  picked weapon's slug is substituted for any `"__weapon__"` string
   *  literal in the template (typically in an action-modifier's
   *  `appliesTo.predicates[].weapon.slug`). Powers spells like Magic
   *  Weapon / Elemental Weapon that enchant "the weapon you touched"
   *  rather than all weapons. Mutually exclusive with `variants[]` —
   *  authoring both is a content bug. */
  variantsFromWeapons?: { modifiers: Array<Record<string, unknown>> };
  /** Per-rest variant pick. When set, the player picks one of the
   *  declared `variants[]` at the end of the named rest and that pick
   *  remains in effect until the next matching rest, at which point it
   *  clears (the player picks again). The activation has no toggle
   *  button — `active` is derived from "variant recorded" instead, and
   *  the picked variant's modifiers + condition slug flow through the
   *  same synthesis path as any other activation variant. Powers
   *  Fiendish Resilience ("choose one damage type when you finish a
   *  short or long rest; resistance to that type until you choose a
   *  different one"), Inquisitive's Insightful Fighting target lock,
   *  and similar "pick-at-rest" features. Long rest covers short-rest
   *  picks (rest semantics mirror refreshActivations). Authors should
   *  not also declare `uses`, `concentration`, `group`, or `cost` on a
   *  rest-pick activation — those modes assume player-driven on/off
   *  toggling that doesn't exist here. */
  restPickRequired?: 'short-rest' | 'long-rest';
  /** Optional display label for the rest-pick dropdown ("Damage type",
   *  "Target creature"). Defaults to the activation name in the UI. */
  restPickLabel?: string;
  /** Creature-type protection ward the activation raises while active
   *  (scrolls of protection, icon of ravenloft, condensed order).
   *  Display contract — the DM adjudicates what the ward blocks; the
   *  engine performs no creature-type validation (any slug is legal).
   *  `radiusFt` is the ward's radius (default: the RAW 5-ft cylinder is
   *  the usual authored value); `barrier: true` marks a physical
   *  can't-cross barrier vs a mere-hindrance ward. */
  ward?: ActivationWard;
}

/** Creature-type ward payload on an activation — see
 *  `ActivationDeclaration.ward`. Mirrored verbatim onto
 *  `AvailableActivation.ward` for the activation panel. */
export interface ActivationWard {
  /** Creature-type slugs the ward protects against ('aberration',
   *  'fiend', …). Soft — no validation gate; homebrew slugs pass. */
  creatureTypes: string[];
  /** Ward radius in feet, when the source declares one. */
  radiusFt?: number;
  /** True when warded creatures physically cannot pass the barrier
   *  (vs merely attacking/affecting at disadvantage). */
  barrier?: boolean;
}

/** A condition slug, or an inventory-state predicate, that can appear
 *  in an activation's autoCancelOn list. */
export type AutoCancelEntry = string | InventoryPredicate;

/** Inventory-state predicate for activation auto-cancel. `armor.light`
 *  / `armor.medium` / `armor.heavy` match the equipped armor's
 *  `armorType` (the unarmored case is when no armor is equipped, and
 *  matches none of these). `shield` matches any equipped shield. */
export interface InventoryPredicate {
  wearing: 'armor.light' | 'armor.medium' | 'armor.heavy' | 'shield';
}

/** Per-character snapshot of an authored activation declaration plus the
 *  player's current state. */
export interface AvailableActivation {
  id: string;
  name: string;
  sourceContent: { kind: string; slug: string };
  description?: string;
  cost?: ActivationDeclaration['cost'];
  /** Display-only duration string (e.g. "1 minute", "persistent"). */
  duration?: string;
  /** Per-rest cap; null = unlimited. */
  usesMax: number | null;
  /** Uses remaining; null = unlimited. */
  usesRemaining: number | null;
  /** Refresh policy from the declaration's `uses.per`, null when
   *  unlimited. `'week'` never refreshes on rest — manual restore only. */
  refreshOn: 'short-rest' | 'long-rest' | 'day' | 'week' | null;
  concentration?: boolean;
  group?: string;
  condition: string;
  autoCancelOn?: AutoCancelEntry[];
  variants?: Array<{ id: string; label: string }>;
  /** Currently-picked variant id, when the activation has variants. */
  activeVariant?: string;
  /** Set when the activation's modifier templates reference one or
   *  more `scalingByCastSlot` value shapes. The panel renders a slot
   *  picker; synthesis substitutes the picked slot into the scaling
   *  table. `baseSlotLevel` is the spell's base slot — the picker's
   *  minimum. */
  slotScaling?: { baseSlotLevel: number };
  /** Currently-picked cast slot for this activation. Defaults to
   *  slotScaling.baseSlotLevel when unset; only meaningful when
   *  slotScaling is set on the manifest. */
  activeSlot?: number;
  /** Rest-pick semantics, mirrored from the declaration. When set, the
   *  panel renders a variant dropdown with an empty "pick at rest"
   *  option instead of an Activate/Deactivate button; the activation is
   *  considered active whenever a variant is recorded. `refreshActivations`
   *  clears the variant on the matching rest. */
  restPickRequired?: 'short-rest' | 'long-rest';
  /** Display label for the rest-pick dropdown (e.g. "Damage type"). */
  restPickLabel?: string;
  /** Creature-type ward raised while the activation is on, mirrored
   *  from the declaration. Display contract (DM adjudicates); the
   *  panel renders a compact "wards vs …" line. */
  ward?: ActivationWard;
  /** Whether the activation is currently on. For rest-pick activations,
   *  derived from "variant recorded" rather than a stored boolean. */
  active: boolean;
}

export interface PendingFeatureChoice {
  featureSlug: string;
  featureName: string;
  /** Source row kind. v0: 'feature' | 'subclass' (the only two kinds
   *  whose picks the engine reads from a per-slug map). */
  kind: string;
  /** Declared choice slots from the row's data.choices. Slot name (e.g.
   *  'skillProficiency', 'expertise', 'language', 'feature', 'spell')
   *  maps to the slot's declaration object (allowedSkills, allowedSpells,
   *  allowedAbilities, etc.). */
  declarations: Record<string, Record<string, unknown>>;
  /** Picks the player has recorded so far for this row, keyed by slot
   *  name. Missing keys → that slot is unresolved. */
  picks: Record<string, unknown>;
  /** True when at least one declared slot has no pick recorded. */
  unresolved: boolean;
}

/** One declared item choice slot + the player's current pick (if any).
 *  Emitted for every choice slot on every equipped item that declares
 *  `data.choices` — resolved and unresolved alike (`picked` is absent
 *  when the slot has no recorded pick). */
export interface PendingItemChoice {
  /** Index into `character.inventory` — where the pick is written. */
  slotIndex: number;
  itemSlug: string;
  itemName: string;
  /** Choice-slot name from the item's `data.choices` (e.g. 'spell',
   *  'baseWeapon', or any homebrew-defined generic slot). */
  choice: string;
  /** The slot's declaration object as authored (label, maxLevel,
   *  allowedLevels, allowedClasses, allowedSchools, allowedCategories,
   *  …). Opaque to the engine beyond the v1 slots it interprets. */
  declaration: Record<string, unknown>;
  /** The recorded pick, when present (v1 engine-read slots: a slug
   *  string). Absent → unresolved. */
  picked?: unknown;
}

export interface OverlayHpPool {
  /** Stable id derived from the source row + modifier index. */
  id: string;
  /** Content row that declared the pool. */
  sourceContent: { kind: string; slug: string };
  /** Display name. */
  name: string;
  /** Maximum HP of this pool, evaluated against character context at
   *  derive() time. */
  max: number;
  /** When the pool refreshes to max. `'manual'` means it never auto-
   *  refreshes — the consumer (typically the feature itself) controls
   *  restoration (Arcane Ward refreshes on cast, not on rest). */
  refreshOn: 'short-rest' | 'long-rest' | 'manual';
}
