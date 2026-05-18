// Monster-side rules. Takes the raw `data` block off a content row of
// kind='monster' and produces a normalized view the encounter UI can render:
// ability mods, saves, skills, AC, HP, speeds, senses, plus the actions and
// traits in a stable shape.
//
// This is intentionally thin — monster statblocks already carry most of what
// the table needs to play. derive() exists so the UI can read a single shape
// regardless of which pack the statblock came from (SRD vs 5etools imports
// may have slight field-name drift).
//
// Pure function. No I/O, no random.
//
// Scope notes:
//   - Proficiency bonus is derived from CR per the 2024 PHB table when no
//     explicit pb is given. Used for save/skill bonuses where the row lists
//     proficiencies but not the rolled total.
//   - Legendary actions / lair actions are surfaced as separate arrays when
//     present in the data; UI is responsible for displaying them.

import type { AbilityKey } from './types';

const ABILITIES: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export interface MonsterAction {
  name: string;
  type?: string;
  range?: string;
  reach?: number;
  attackBonus?: number;
  damage?: Array<{ dice: string; type: string }>;
  description?: string;
}

export interface MonsterDerived {
  size?: string;
  type?: string;
  alignment?: string;
  cr?: number | string;
  xp?: number;
  ac: number | null;
  acDescription?: string;
  maxHp: number | null;
  hitDice?: string;
  speeds: Record<string, number>;
  abilityScores: Record<AbilityKey, number>;
  abilityMods: Record<AbilityKey, number>;
  saves: Record<AbilityKey, number>;
  skills: Record<string, number>;
  senses: Record<string, number>;
  languages: string[];
  proficiencyBonus: number;
  traits: Array<{ name: string; description?: string }>;
  actions: MonsterAction[];
  legendaryActions: MonsterAction[];
  reactions: MonsterAction[];
  damageImmunities: string[];
  damageResistances: string[];
  damageVulnerabilities: string[];
  conditionImmunities: string[];
}

/** Standard 2024 PHB proficiency bonus table by CR. CR 0–4 → +2, 5–8 → +3, etc. */
function proficiencyBonusForCR(cr: unknown): number {
  if (typeof cr === 'string') {
    // Fractional CRs (1/8, 1/4, 1/2) all yield +2.
    if (cr.includes('/')) return 2;
    const n = Number(cr);
    if (!Number.isFinite(n)) return 2;
    cr = n;
  }
  const n = Number(cr ?? 0);
  if (n < 5) return 2;
  if (n < 9) return 3;
  if (n < 13) return 4;
  if (n < 17) return 5;
  if (n < 21) return 6;
  if (n < 25) return 7;
  if (n < 29) return 8;
  return 9;
}

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function asNumberMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const n = typeof val === 'number' ? val : Number(val);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function asActions(v: unknown): MonsterAction[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      name: String(a.name ?? ''),
      type: typeof a.type === 'string' ? a.type : undefined,
      range: typeof a.range === 'string' ? a.range : undefined,
      reach: typeof a.reach === 'number' ? a.reach : undefined,
      attackBonus: typeof a.attackBonus === 'number' ? a.attackBonus : undefined,
      damage: Array.isArray(a.damage)
        ? (a.damage as Array<Record<string, unknown>>).map((d) => ({
            dice: String(d.dice ?? ''),
            type: String(d.type ?? '')
          }))
        : undefined,
      description: typeof a.description === 'string' ? a.description : undefined
    }));
}

export function monsterDerive(data: Record<string, unknown>): MonsterDerived {
  const scores: Record<AbilityKey, number> = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const rawScores = (data.abilityScores as Record<string, number> | undefined) ?? {};
  for (const ab of ABILITIES) {
    if (typeof rawScores[ab] === 'number') scores[ab] = rawScores[ab];
  }
  const mods: Record<AbilityKey, number> = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  for (const ab of ABILITIES) mods[ab] = abilityMod(scores[ab]);

  const pb =
    typeof data.proficiencyBonus === 'number'
      ? data.proficiencyBonus
      : proficiencyBonusForCR(data.cr);

  // Saves: explicit `savingThrows` map overrides, else just ability mod.
  const saves: Record<AbilityKey, number> = { ...mods };
  const explicitSaves = (data.savingThrows as Record<string, number> | undefined) ?? {};
  for (const ab of ABILITIES) {
    if (typeof explicitSaves[ab] === 'number') saves[ab] = explicitSaves[ab];
  }

  // Skills: explicit `skills` map carries rolled totals.
  const skills = asNumberMap(data.skills);

  // HP: rows generally use { max: number } but some 5etools imports use
  // a string average like "13 (3d6+3)" — fall back to null in that case.
  const hpData = data.hp as { max?: number; average?: number; hitDice?: string } | undefined;
  const maxHp =
    typeof hpData?.max === 'number'
      ? hpData.max
      : typeof hpData?.average === 'number'
        ? hpData.average
        : null;

  return {
    size: typeof data.size === 'string' ? data.size : undefined,
    type: typeof data.type === 'string' ? data.type : undefined,
    alignment: typeof data.alignment === 'string' ? data.alignment : undefined,
    cr: (data.cr as number | string | undefined) ?? undefined,
    xp: typeof data.xp === 'number' ? data.xp : undefined,
    ac: typeof data.ac === 'number' ? data.ac : null,
    acDescription: typeof data.acDescription === 'string' ? data.acDescription : undefined,
    maxHp,
    hitDice: hpData?.hitDice,
    speeds: asNumberMap(data.speed ?? data.speeds),
    abilityScores: scores,
    abilityMods: mods,
    saves,
    skills,
    senses: asNumberMap(data.senses),
    languages: asStringArray(data.languages),
    proficiencyBonus: pb,
    traits: Array.isArray(data.traits)
      ? (data.traits as Array<Record<string, unknown>>).map((t) => ({
          name: String(t.name ?? ''),
          description: typeof t.description === 'string' ? t.description : undefined
        }))
      : [],
    actions: asActions(data.actions),
    legendaryActions: asActions(data.legendaryActions),
    reactions: asActions(data.reactions),
    damageImmunities: asStringArray(data.damageImmunities),
    damageResistances: asStringArray(data.damageResistances),
    damageVulnerabilities: asStringArray(data.damageVulnerabilities),
    conditionImmunities: asStringArray(data.conditionImmunities)
  };
}
