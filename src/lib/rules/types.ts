// TypeScript types for the rules engine. See docs/rules-engine.md for the
// contract narrative; this file is just the types those words describe.

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
  conditions: string[];
  /** Stacking level for conditions that accumulate (e.g. exhaustion 1–10).
   *  Key is the condition slug; value is the current stack count (≥ 1).
   *  Absence of a key means the condition has no stack (level 0 / off). */
  conditionStacks?: Record<string, number>;

  modifierToggles: Record<string, boolean>;
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
  /** Action ids (derived.actions[].id) the player has pinned. The planner
   *  surfaces these at the top of the picker. */
  favoriteActionIds?: string[];
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
  appliedModifiers: AppliedModifier[];
}

export type ActionCost =
  | 'action'
  | 'bonus'
  | 'reaction'
  | 'free'
  | { uses: number; per: 'turn' | 'round' | 'short-rest' | 'long-rest' | 'day' }
  /** Movement-only action (Disengage replaced by movement-style content, etc.).
   *  `feet` is the cost from the character's movement speed budget for the turn. */
  | { movement: number };

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
  // Save / check / ability-check lifecycle
  'save.declare',
  'save.fail',
  'check.declare',
  // Damage taken (self-as-target)
  'damage.taken',
  'attack.targets-self.declare',
  'attack.targets-self.hit',
  // Spell lifecycle
  'spell.cast',
  'spell.slot-spent',
  // Turn / round lifecycle
  'turn.start',
  'turn.end',
  'round.start',
  // Ally / enemy lifecycle
  'creature.attack.hit',
  'creature.takes-fall-damage',
  'creature.turn-start'
] as const;
export type TriggerEvent = (typeof KNOWN_TRIGGER_EVENTS)[number];

/** Grant payload on a TriggerDeclaration. Discriminated by `type`. The
 *  encounter runtime maps each grant to a player choice (e.g. "do you want
 *  to use Heavy Armor Master to reduce this damage?"). */
export type TriggerGrant =
  | { type: 'force-reroll' }
  | { type: 'damage.reduce'; amount: number | string }
  | { type: 'damage.reflect'; amount: number | string }
  | { type: 'impose-disadvantage'; on: 'attack' | 'save' | 'check' }
  | { type: 'convert-hit-to-miss' }
  | { type: 'bonus-action-weapon-attack' }
  | { type: 'reaction-weapon-attack' }
  | { type: string; [k: string]: unknown }; // forward-compat: unknown grant shapes still pass through

export interface TriggerDeclaration {
  id: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  on: string[];
  scope?: unknown;
  grants?: TriggerGrant | unknown;
  limit?: { per: string; uses: number };
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

export interface Derived {
  stats: StatBlock;
  actions: Action[];
  triggers: TriggerDeclaration[];
  resources: Resource[];
  validations: ValidationIssue[];
  toggles: AvailableToggle[];
}
