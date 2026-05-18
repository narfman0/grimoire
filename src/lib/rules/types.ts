// TypeScript types for the rules engine. See docs/rules-engine.md for the
// contract narrative; this file is just the types those words describe.

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITIES: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

export type AbilityScores = Record<AbilityKey, number>;

export interface ContentRef {
  kind: string;
  slug: string;
  version?: number; // omit → latest
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
  /** Whether the character has already used their reaction in the current
   *  round. Auto-resets when their turn comes back around (planner watches
   *  encounter Y.Doc activeParticipantId for the rising edge), or on any rest. */
  reactionUsedThisRound?: boolean;
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
