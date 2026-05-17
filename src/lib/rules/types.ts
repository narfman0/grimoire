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
  | { uses: number; per: 'turn' | 'round' | 'short-rest' | 'long-rest' | 'day' };

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

export interface Derived {
  stats: StatBlock;
  actions: Action[];
  triggers: TriggerDeclaration[];
  resources: Resource[];
  validations: ValidationIssue[];
}
