// Regression (engine batch 7): every flag/set collector in phase 2 read
// `allMods` raw, so an authored `appliesWhen` gate — or a
// `defaultEnabled: false` toggle — was silently ignored. Circle of the
// Stars' Dragon form d20 floor applied outside the form, a form-gated
// skill advantage applied on the base sheet, and so on. `applyTarget`
// (the numeric channel) had always filtered correctly, which is why the
// gap went unnoticed.
//
// Each case here asserts the same shape: gated off → absent, gated on →
// present.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentRow } from '../types';

const GATE = 'starry-form-active';

function char(featSlugs: string[], conditions: string[] = []): CharacterDocument {
  return {
    id: 'applies-when-test',
    name: 'Gated',
    classes: [{ slug: 'druid', level: 6, hpRolledPerLevel: [8, 5, 5, 5, 5, 5] }],
    species: { kind: 'species', slug: 'human' },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 10, dex: 14, con: 14, int: 12, wis: 16, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 41,
    tempHp: 0,
    hitDiceSpent: {},
    conditions,
    modifierToggles: {}
  };
}

function gatedFeat(slug: string, modifiers: Array<Record<string, unknown>>): ContentRow {
  return {
    kind: 'feat',
    slug,
    version: 1,
    name: slug,
    source: 'test',
    data: {
      modifiers: modifiers.map((m) => ({ ...m, appliesWhen: { condition: GATE } }))
    }
  };
}

function lookupFor(rows: ContentRow[]) {
  const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) => map.get(`${ref.kind}/${ref.slug}`);
}

/** Derive twice — with the gating condition absent, then present. */
function bothWays(feat: ContentRow) {
  const lookup = lookupFor([feat]);
  return {
    off: derive(char([feat.slug]), lookup),
    on: derive(char([feat.slug], [GATE]), lookup)
  };
}

describe('d20 floors respect appliesWhen', () => {
  it('check.d20Floor (Circle of the Stars Dragon — treat ≤9 as 10)', () => {
    const { off, on } = bothWays(
      gatedFeat('test-dragon-form', [
        { kind: 'stat-modifier', target: 'check.d20Floor', value: 10 }
      ])
    );
    expect(off.stats.checkD20Floor).toBeUndefined();
    expect(off.stats.skills.arcana.d20Floor).toBeUndefined();
    expect(on.stats.checkD20Floor).toBe(10);
    expect(on.stats.skills.arcana.d20Floor).toBe(10);
  });

  it('skill.d20Floor.<slug> and save.d20Floor', () => {
    const { off, on } = bothWays(
      gatedFeat('test-floors', [
        { kind: 'stat-modifier', target: 'skill.d20Floor.persuasion', value: 10 },
        { kind: 'stat-modifier', target: 'save.d20Floor', value: 8 }
      ])
    );
    expect(off.stats.skills.persuasion.d20Floor).toBeUndefined();
    expect(off.stats.saveD20Floor).toBeUndefined();
    expect(on.stats.skills.persuasion.d20Floor).toBe(10);
    expect(on.stats.saveD20Floor).toBe(8);
  });
});

describe('sibling collectors respect appliesWhen', () => {
  it('skill / check advantage', () => {
    const { off, on } = bothWays(
      gatedFeat('test-advantage', [
        { kind: 'stat-modifier', target: 'skill.advantage.stealth', value: true },
        { kind: 'stat-modifier', target: 'check.advantage.wis', value: true }
      ])
    );
    expect(off.stats.skills.stealth.advantage).toBe(false);
    expect(off.stats.abilityCheckAdvantage.wis).toBeUndefined();
    expect(on.stats.skills.stealth.advantage).toBe(true);
    expect(on.stats.abilityCheckAdvantage.wis).toBe('advantage');
  });

  it('bonus dice on skills and raw checks', () => {
    const { off, on } = bothWays(
      gatedFeat('test-bonus-dice', [
        { kind: 'stat-modifier', target: 'skill.bonusDice.medicine', value: '1d4' },
        { kind: 'stat-modifier', target: 'check.bonusDice.int', value: '1d4' }
      ])
    );
    expect(off.stats.skills.medicine.bonusDice).toBeUndefined();
    expect(off.stats.abilityCheckBonusDice.int).toBeUndefined();
    expect(on.stats.skills.medicine.bonusDice).toEqual(['1d4']);
    expect(on.stats.abilityCheckBonusDice.int).toEqual(['1d4']);
  });

  it('check.bonus.<ability>', () => {
    const { off, on } = bothWays(
      gatedFeat('test-check-bonus', [
        { kind: 'stat-modifier', target: 'check.bonus.cha', value: 3 }
      ])
    );
    expect(on.stats.skills.persuasion.bonus).toBe(off.stats.skills.persuasion.bonus + 3);
  });

  it('curated trait flags', () => {
    const { off, on } = bothWays(
      gatedFeat('test-traits', [
        { kind: 'stat-modifier', target: 'trait.water-breathing', value: true }
      ])
    );
    expect(off.stats.traits).toEqual([]);
    expect(on.stats.traits).toEqual(['water-breathing']);
  });

  it('senses', () => {
    const { off, on } = bothWays(
      gatedFeat('test-senses', [
        { kind: 'stat-modifier', target: 'sense.darkvision', mode: 'UPGRADE', value: 60 }
      ])
    );
    expect(off.stats.senses.darkvision).toBeUndefined();
    expect(on.stats.senses.darkvision).toBe(60);
  });

  it('save proficiency / expertise and save advantage', () => {
    const { off, on } = bothWays(
      gatedFeat('test-saves', [
        { kind: 'stat-modifier', target: 'proficiency.save.con', value: true },
        { kind: 'stat-modifier', target: 'save.advantage.vs-condition.frightened', value: true }
      ])
    );
    expect(off.stats.saves.con.proficient).toBe(false);
    expect(off.stats.savesAdvantageVs).toEqual([]);
    expect(on.stats.saves.con.proficient).toBe(true);
    expect(on.stats.savesAdvantageVs).toEqual(['frightened']);
  });

  it('skill proficiency / expertise', () => {
    const { off, on } = bothWays(
      gatedFeat('test-skill-prof', [
        { kind: 'stat-modifier', target: 'proficiency.skill.athletics', value: true }
      ])
    );
    expect(off.stats.skills.athletics.proficient).toBe(false);
    expect(on.stats.skills.athletics.proficient).toBe(true);
  });

  it('language / tool / armor / weapon proficiencies', () => {
    const { off, on } = bothWays(
      gatedFeat('test-proficiencies', [
        { kind: 'stat-modifier', target: 'proficiency.language.draconic', value: true },
        { kind: 'stat-modifier', target: 'proficiency.tool.thieves-tools', value: true },
        { kind: 'stat-modifier', target: 'proficiency.armor.heavy', value: true },
        { kind: 'stat-modifier', target: 'proficiency.weapon.longsword', value: true }
      ])
    );
    expect(off.stats.languages).toEqual([]);
    expect(off.stats.tools).toEqual([]);
    expect(off.stats.armorProficiencies).toEqual([]);
    expect(off.stats.weaponProficiencies).toEqual([]);
    expect(on.stats.languages).toEqual(['draconic']);
    expect(on.stats.tools).toEqual(['thieves-tools']);
    expect(on.stats.armorProficiencies).toEqual(['heavy']);
    expect(on.stats.weaponProficiencies).toEqual(['longsword']);
  });

  it('boolean tag targets', () => {
    const { off, on } = bothWays(
      gatedFeat('test-tags', [
        { kind: 'stat-modifier', target: 'initiative.advantage', value: true },
        { kind: 'stat-modifier', target: 'attacked.disadvantage', value: true },
        { kind: 'stat-modifier', target: 'tag.incoming-crit-immune', value: true },
        { kind: 'stat-modifier', target: 'deathsave.advantage', value: true },
        { kind: 'stat-modifier', target: 'hitDice.maximize', value: true }
      ])
    );
    expect(off.stats.initiativeAdvantage).toBe(false);
    expect(off.stats.attackedDisadvantage).toBe(false);
    expect(off.stats.incomingCritImmune).toBe(false);
    expect(off.stats.deathSaveAdvantage).toBe(false);
    expect(off.stats.hitDiceMaximized).toBe(false);
    expect(on.stats.initiativeAdvantage).toBe(true);
    expect(on.stats.attackedDisadvantage).toBe(true);
    expect(on.stats.incomingCritImmune).toBe(true);
    expect(on.stats.deathSaveAdvantage).toBe(true);
    expect(on.stats.hitDiceMaximized).toBe(true);
  });

  it('Jack of All Trades half-proficiency', () => {
    const { off, on } = bothWays(
      gatedFeat('test-jack', [
        { kind: 'stat-modifier', target: 'skill.half-proficiency-bonus', value: true }
      ])
    );
    expect(on.stats.skills.athletics.bonus).toBeGreaterThan(off.stats.skills.athletics.bonus);
  });

  it('overlay HP pools', () => {
    const { off, on } = bothWays(
      gatedFeat('test-ward', [
        { kind: 'overlay-hp-pool', id: 'test-ward-pool', name: 'Ward', max: 10, refreshOn: 'manual' }
      ])
    );
    expect(off.overlayHpPools).toEqual([]);
    expect(on.overlayHpPools).toHaveLength(1);
  });
});

describe('triggers respect appliesWhen', () => {
  it('a form-gated trigger does not register outside the form', () => {
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'test-form-of-dread',
      version: 1,
      name: 'Form of Dread',
      source: 'test',
      data: {
        triggers: [
          {
            kind: 'trigger',
            id: 'form-of-dread-frighten',
            name: 'Form of Dread',
            on: ['attack.hit'],
            appliesWhen: { condition: GATE }
          }
        ]
      }
    };
    const lookup = lookupFor([feat]);
    expect(derive(char([feat.slug]), lookup).triggers).toEqual([]);
    expect(derive(char([feat.slug], [GATE]), lookup).triggers).toHaveLength(1);
  });
});

describe('modifierToggles are honored by the collectors too', () => {
  it('a defaultEnabled:false skill advantage stays off until switched on', () => {
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'test-opt-in-advantage',
      version: 1,
      name: 'Opt-in',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            name: 'Magical Ambush',
            target: 'skill.advantage.stealth',
            value: true,
            defaultEnabled: false
          }
        ]
      }
    };
    const lookup = lookupFor([feat]);
    const off = derive(char([feat.slug]), lookup);
    expect(off.stats.skills.stealth.advantage).toBe(false);

    const c = char([feat.slug]);
    c.modifierToggles = { 'feat/test-opt-in-advantage/mod/0': true };
    expect(derive(c, lookup).stats.skills.stealth.advantage).toBe(true);
  });
});
