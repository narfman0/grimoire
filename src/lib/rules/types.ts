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
   *  encounter Y.Doc activeParticipantId for the rising edge), or on any rest. */
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
  passivePerception: number;
  spellSaveDC: number | null;
  spellAttackBonus: number | null;
  spellcastingAbility: AbilityKey | null;
  spellSlots: Record<number, { max: number; used: number }>;
  totalLevel: number;
  resistances: Set<string>;
  immunities: Set<string>;
  vulnerabilities: Set<string>;
  senses: Record<string, number>; // darkvision, tremorsense, …
  /** Languages known. Populated from proficienciesChosen.languages plus any
   *  `proficiency.language.<slug>` modifier (class/species/feature/feat). */
  languages: string[];
  /** Tool proficiencies. Populated from proficienciesChosen.tools plus any
   *  `proficiency.tool.<slug>` modifier. */
  tools: string[];
}

export interface AppliedModifier {
  modifierId: string;
  sourceContent: { kind: string; slug: string };
  name: string;
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

export interface TriggerDeclaration {
  id: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  on: string[];
  scope?: unknown;
  grants?: unknown;
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
