// Skill / ability-check advantage channels + passive Perception ±5.
//
// Boolean targets (value === true):
//   skill.advantage.<slug> / skill.disadvantage.<slug>
//   skill.advantage.all    / skill.disadvantage.all
//   check.advantage.<ab>   / check.disadvantage.<ab>
// Numeric target:
//   check.bonus.<ab> — adds to every skill of that ability (NOT initiative).
//
// Passive Perception per RAW: advantage on the check → +5, disadvantage
// → −5; simultaneous adv+dis cancel to ±0.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import { SKILLS, SKILL_ABILITY } from '../skills';
import type { CharacterDocument, ContentRow } from '../types';

function charWithFeat(featSlug: string): CharacterDocument {
  return {
    id: 'skill-adv-test',
    name: 'Skill Advantage Subject',
    classes: [{ slug: 'wizard', level: 1, hpRolledPerLevel: [6] }],
    species: { kind: 'species', slug: 'gnome' },
    feats: [{ kind: 'feat', slug: featSlug }],
    abilityScores: { str: 10, dex: 10, con: 10, int: 16, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 6,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function featWithMods(slug: string, modifiers: Array<Record<string, unknown>>): ContentRow {
  return {
    kind: 'feat',
    slug,
    version: 1,
    name: slug,
    source: 'test',
    data: { modifiers }
  };
}

function lookupOnly(row: ContentRow) {
  return (ref: { kind: string; slug: string }) =>
    ref.kind === row.kind && ref.slug === row.slug ? row : undefined;
}

function deriveWithMods(modifiers: Array<Record<string, unknown>>) {
  const feat = featWithMods('adv-test-feat', modifiers);
  return derive(charWithFeat(feat.slug), lookupOnly(feat));
}

describe('skill advantage channel', () => {
  it('defaults every skill cell to advantage=false disadvantage=false', () => {
    const d = deriveWithMods([]);
    for (const s of SKILLS) {
      expect(d.stats.skills[s].advantage).toBe(false);
      expect(d.stats.skills[s].disadvantage).toBe(false);
    }
  });

  it('skill.advantage.stealth flags only stealth', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'skill.advantage.stealth', value: true }
    ]);
    expect(d.stats.skills.stealth.advantage).toBe(true);
    expect(d.stats.skills.stealth.disadvantage).toBe(false);
    expect(d.stats.skills.perception.advantage).toBe(false);
  });

  it('skill.disadvantage.stealth flags only stealth disadvantage', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'skill.disadvantage.stealth', value: true }
    ]);
    expect(d.stats.skills.stealth.disadvantage).toBe(true);
    expect(d.stats.skills.stealth.advantage).toBe(false);
  });

  it('skill.advantage.all / skill.disadvantage.all flag every skill', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'skill.advantage.all', value: true },
      { kind: 'stat-modifier', target: 'skill.disadvantage.all', value: true }
    ]);
    for (const s of SKILLS) {
      expect(d.stats.skills[s].advantage).toBe(true);
      expect(d.stats.skills[s].disadvantage).toBe(true);
    }
  });

  it('both advantage and disadvantage on one skill are reported simultaneously', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'skill.advantage.athletics', value: true },
      { kind: 'stat-modifier', target: 'skill.disadvantage.athletics', value: true }
    ]);
    expect(d.stats.skills.athletics.advantage).toBe(true);
    expect(d.stats.skills.athletics.disadvantage).toBe(true);
  });

  it('value !== true is ignored', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'skill.advantage.stealth', value: false },
      { kind: 'stat-modifier', target: 'skill.advantage.perception', value: 1 }
    ]);
    expect(d.stats.skills.stealth.advantage).toBe(false);
    expect(d.stats.skills.perception.advantage).toBe(false);
  });
});

describe('ability-check advantage channel', () => {
  it('check.advantage.dex flags every dex skill and records abilityCheckAdvantage', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'check.advantage.dex', value: true }
    ]);
    for (const s of SKILLS) {
      const expected = SKILL_ABILITY[s] === 'dex';
      expect(d.stats.skills[s].advantage).toBe(expected);
    }
    expect(d.stats.abilityCheckAdvantage.dex).toBe('advantage');
    expect(d.stats.abilityCheckAdvantage.str).toBeUndefined();
  });

  it('check.disadvantage.wis records disadvantage; adv+dis on one ability records both', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'check.disadvantage.wis', value: true },
      { kind: 'stat-modifier', target: 'check.advantage.wis', value: true }
    ]);
    expect(d.stats.abilityCheckAdvantage.wis).toBe('both');
    expect(d.stats.skills.perception.advantage).toBe(true);
    expect(d.stats.skills.perception.disadvantage).toBe(true);
  });

  it('check.bonus.int adds to every int skill only, and never to initiative', () => {
    const base = deriveWithMods([]);
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'check.bonus.int', value: 2 },
      { kind: 'stat-modifier', target: 'check.bonus.dex', value: 3 }
    ]);
    for (const s of SKILLS) {
      const delta = SKILL_ABILITY[s] === 'int' ? 2 : SKILL_ABILITY[s] === 'dex' ? 3 : 0;
      expect(d.stats.skills[s].bonus).toBe(base.stats.skills[s].bonus + delta);
    }
    // Initiative is deliberately not part of check.bonus.dex — it has its
    // own `initiative` target.
    expect(d.stats.initiative).toBe(base.stats.initiative);
  });

  it('unknown ability slug on check.* is ignored', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'check.advantage.luck', value: true },
      { kind: 'stat-modifier', target: 'check.bonus.luck', value: 5 }
    ]);
    expect(Object.keys(d.stats.abilityCheckAdvantage)).toEqual([]);
    const base = deriveWithMods([]);
    for (const s of SKILLS) expect(d.stats.skills[s].bonus).toBe(base.stats.skills[s].bonus);
  });
});

describe('passive Perception advantage math', () => {
  // WIS 12, no proficiency → perception bonus +1 → base passive 11.
  it('baseline: 10 + perception bonus', () => {
    const d = deriveWithMods([]);
    expect(d.stats.passivePerception).toBe(10 + d.stats.skills.perception.bonus);
  });

  it('advantage on Perception → +5', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'skill.advantage.perception', value: true }
    ]);
    expect(d.stats.passivePerception).toBe(10 + d.stats.skills.perception.bonus + 5);
  });

  it('disadvantage on Perception → −5 (via check.disadvantage.wis too)', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'check.disadvantage.wis', value: true }
    ]);
    expect(d.stats.passivePerception).toBe(10 + d.stats.skills.perception.bonus - 5);
  });

  it('simultaneous advantage + disadvantage cancel to ±0', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'skill.advantage.perception', value: true },
      { kind: 'stat-modifier', target: 'skill.disadvantage.perception', value: true }
    ]);
    expect(d.stats.passivePerception).toBe(10 + d.stats.skills.perception.bonus);
  });
});

describe('dice-valued check bonuses', () => {
  it('check.bonusDice.int lands on every int skill and on abilityCheckBonusDice', () => {
    const base = deriveWithMods([]);
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'check.bonusDice.int', value: '1d4' }
    ]);
    for (const s of SKILLS) {
      if (SKILL_ABILITY[s] === 'int') {
        expect(d.stats.skills[s].bonusDice).toEqual(['1d4']);
      } else {
        expect(d.stats.skills[s].bonusDice).toBeUndefined();
      }
      // Numeric bonus never folds the die in.
      expect(d.stats.skills[s].bonus).toBe(base.stats.skills[s].bonus);
    }
    expect(d.stats.abilityCheckBonusDice.int).toEqual(['1d4']);
    expect(d.stats.abilityCheckBonusDice.dex).toBeUndefined();
  });

  it('skill.bonusDice.arcana lands on arcana only, composing with ability-level dice', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'skill.bonusDice.arcana', value: '1d6' },
      { kind: 'stat-modifier', target: 'check.bonusDice.int', value: '1d4' }
    ]);
    // Skill-scoped dice sort before the governing ability's dice.
    expect(d.stats.skills.arcana.bonusDice).toEqual(['1d6', '1d4']);
    expect(d.stats.skills.history.bonusDice).toEqual(['1d4']);
    expect(d.stats.skills.stealth.bonusDice).toBeUndefined();
    // Raw-check record only carries ability-level entries.
    expect(d.stats.abilityCheckBonusDice.int).toEqual(['1d4']);
  });

  it('ignores non-string values and unknown ability slugs', () => {
    const d = deriveWithMods([
      { kind: 'stat-modifier', target: 'check.bonusDice.int', value: 4 },
      { kind: 'stat-modifier', target: 'check.bonusDice.luck', value: '1d4' }
    ]);
    for (const s of SKILLS) expect(d.stats.skills[s].bonusDice).toBeUndefined();
    expect(Object.keys(d.stats.abilityCheckBonusDice)).toEqual([]);
  });
});
