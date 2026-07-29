import { describe, expect, it } from 'vitest';
import type { StatBlock } from '$lib/rules/types';
import {
  abilityCheckAutoFails,
  d20OptionsForAbilityCheck,
  d20OptionsForAttack,
  d20OptionsForDeathSave,
  d20OptionsForInitiative,
  d20OptionsForSave,
  d20OptionsForSkill,
  d20OptionsForToolCheck,
  poolOptionsForDamage,
  poolOptionsForHealing,
  poolOptionsForHitDice,
  skillAutoFails
} from '../from-derived';
import { rollD20, rollPool } from '../roll';
import { faceRng } from '../rng';

// Coverage here reads as "flag X is consumed". Every assertion names the
// engine flag it activates, because the point of this file is that ~35
// roll-time flags existed with zero consumers outside src/lib/rules/.

const skill = (over: Partial<Parameters<typeof d20OptionsForSkill>[0]> = {}) => ({
  bonus: 5,
  ability: 'dex' as const,
  proficient: true,
  expertise: false,
  advantage: false,
  disadvantage: false,
  ...over
});

const stats = (over: Partial<StatBlock> = {}) => over as StatBlock;

describe('skill checks', () => {
  it('consumes SkillCell.advantage', () => {
    expect(d20OptionsForSkill(skill({ advantage: true })).advantage).toBe(true);
  });

  it('consumes SkillCell.disadvantage (equipped armor stealth penalty)', () => {
    expect(d20OptionsForSkill(skill({ disadvantage: true })).disadvantage).toBe(true);
  });

  it('consumes SkillCell.bonusDice', () => {
    expect(d20OptionsForSkill(skill({ bonusDice: ['1d4'] })).bonusDice).toEqual(['1d4']);
  });

  it('omits bonusDice when empty rather than passing []', () => {
    expect(d20OptionsForSkill(skill({ bonusDice: [] })).bonusDice).toBeUndefined();
  });

  it('consumes SkillCell.d20Floor (Reliable Talent, Silver Tongue)', () => {
    expect(d20OptionsForSkill(skill({ d20Floor: 10 })).d20Floor).toBe(10);
  });

  it('falls back to the stat-block check floor when the cell has none', () => {
    expect(d20OptionsForSkill(skill(), stats({ checkD20Floor: 8 })).d20Floor).toBe(8);
  });

  it('prefers the cell floor over the stat-block floor', () => {
    // The cell already folds check.d20Floor in and takes the highest, so it
    // wins — reading both and taking the max here could double-apply a rule.
    expect(d20OptionsForSkill(skill({ d20Floor: 10 }), stats({ checkD20Floor: 8 })).d20Floor).toBe(
      10
    );
  });

  it('reports autoFail separately from disadvantage', () => {
    // RAW says the check *fails*; modeling it as disadvantage would be a
    // different rule that still sometimes succeeds.
    const cell = skill({ autoFail: true });
    expect(skillAutoFails(cell)).toBe(true);
    expect(d20OptionsForSkill(cell).disadvantage).toBe(false);
  });

  it('rolls end-to-end with the flags applied', () => {
    const opts = d20OptionsForSkill(skill({ advantage: true, d20Floor: 10 }));
    const r = rollD20(5, opts, faceRng([2, 7], 20));
    expect(r.total).toBe(15); // advantage picks 7, floored to 10, +5
  });
});

describe('saving throws', () => {
  const save = (over = {}) => ({
    bonus: 3,
    proficient: true,
    expertise: false,
    advantage: false,
    disadvantage: false,
    ...over
  });

  it('consumes SaveCell.advantage', () => {
    expect(d20OptionsForSave(save({ advantage: true })).advantage).toBe(true);
  });

  it('consumes StatBlock.saveD20Floor', () => {
    expect(d20OptionsForSave(save(), stats({ saveD20Floor: 10 })).d20Floor).toBe(10);
  });
});

describe('raw ability checks', () => {
  it('consumes abilityCheckAdvantage', () => {
    const s = stats({ abilityCheckAdvantage: { str: 'advantage' } });
    expect(d20OptionsForAbilityCheck('str', s)).toMatchObject({
      advantage: true,
      disadvantage: false
    });
  });

  it("passes 'both' through as both flags so rollD20 applies the RAW cancel", () => {
    const s = stats({ abilityCheckAdvantage: { str: 'both' } });
    const opts = d20OptionsForAbilityCheck('str', s);
    expect(opts).toMatchObject({ advantage: true, disadvantage: true });
    // One die, not three.
    expect(rollD20(0, opts, faceRng([9, 20], 20)).dice).toHaveLength(1);
  });

  it('consumes abilityCheckBonusDice and checkD20Floor', () => {
    const s = stats({ abilityCheckBonusDice: { int: ['1d4'] }, checkD20Floor: 10 });
    expect(d20OptionsForAbilityCheck('int', s)).toMatchObject({
      bonusDice: ['1d4'],
      d20Floor: 10
    });
  });

  it('consumes abilityCheckAutoFail', () => {
    expect(abilityCheckAutoFails('int', stats({ abilityCheckAutoFail: { int: true } }))).toBe(true);
    expect(abilityCheckAutoFails('int', stats({}))).toBe(false);
  });

  it('yields no advantage for an ability with no entry', () => {
    expect(d20OptionsForAbilityCheck('wis', stats({ abilityCheckAdvantage: {} }))).toMatchObject({
      advantage: false,
      disadvantage: false
    });
  });
});

describe('tool checks', () => {
  it('consumes ToolCheckCell riders plus the check-wide floor', () => {
    const cell = { advantage: true, disadvantage: false, bonusDice: ['1d4'] };
    expect(d20OptionsForToolCheck(cell, stats({ checkD20Floor: 10 }))).toMatchObject({
      advantage: true,
      bonusDice: ['1d4'],
      d20Floor: 10
    });
  });
});

describe('initiative and death saves', () => {
  it('consumes initiativeAdvantage — the flag the NPC auto-roll ignores', () => {
    expect(d20OptionsForInitiative(stats({ initiativeAdvantage: true })).advantage).toBe(true);
    expect(d20OptionsForInitiative(stats({ initiativeAdvantage: false })).advantage).toBe(false);
  });

  it('consumes deathSaveAdvantage', () => {
    expect(d20OptionsForDeathSave(stats({ deathSaveAdvantage: true })).advantage).toBe(true);
  });

  it('leaves death-save crit thresholds alone', () => {
    // A natural 20 regains 1 HP and a natural 1 is two failures; nothing
    // moves those, so the adapter must not carry a threshold.
    expect(d20OptionsForDeathSave(stats({ deathSaveAdvantage: true })).critThreshold).toBeUndefined();
  });
});

describe('attack rolls', () => {
  it('consumes critThreshold (Champion Improved Critical)', () => {
    expect(d20OptionsForAttack({ critThreshold: 19 }).critThreshold).toBe(19);
    const r = rollD20(0, d20OptionsForAttack({ critThreshold: 19 }), faceRng([19], 20));
    expect(r.d20!.isCrit).toBe(true);
  });

  it('omits the threshold when the action has none, defaulting to 20', () => {
    expect(d20OptionsForAttack({}).critThreshold).toBeUndefined();
    expect(rollD20(0, d20OptionsForAttack({}), faceRng([19], 20)).d20!.isCrit).toBe(false);
  });
});

describe('damage rolls', () => {
  it('consumes damageDieMin (Great Weapon Fighting)', () => {
    expect(poolOptionsForDamage({ damageDieMin: 3 }).dieMin).toBe(3);
  });

  it('consumes damageRerollAndKeepHigher (Savage Attacker)', () => {
    expect(poolOptionsForDamage({ damageRerollAndKeepHigher: true }).rerollAndKeepHigher).toBe(true);
  });

  it('consumes damageMaximized (Overchannel)', () => {
    expect(poolOptionsForDamage({ damageMaximized: true }).maximize).toBe(true);
  });

  it('consumes damageDiceDoubled (Death Strike) without a crit', () => {
    expect(poolOptionsForDamage({ damageDiceDoubled: true }).doubleDice).toBe(true);
  });

  it('doubles dice on a crit', () => {
    expect(poolOptionsForDamage({}, { crit: true }).doubleDice).toBe(true);
    expect(poolOptionsForDamage({}, { crit: false }).doubleDice).toBeUndefined();
  });

  it('adds critExtraDie only on a crit', () => {
    expect(poolOptionsForDamage({ critExtraDie: 1 }, { crit: true }).extraDice).toBe(1);
    expect(poolOptionsForDamage({ critExtraDie: 1 }, {}).extraDice).toBeUndefined();
  });

  describe('vs-objects variants', () => {
    it('maximizes only against objects', () => {
      const action = { damageMaximizedVsObjects: true };
      expect(poolOptionsForDamage(action, { vsObject: true }).maximize).toBe(true);
      expect(poolOptionsForDamage(action, { vsObject: false }).maximize).toBeUndefined();
    });

    it('doubles only against objects', () => {
      const action = { damageDiceDoubledVsObjects: true };
      expect(poolOptionsForDamage(action, { vsObject: true }).doubleDice).toBe(true);
      expect(poolOptionsForDamage(action, {}).doubleDice).toBeUndefined();
    });
  });

  it('rolls a Great Weapon Fighting crit end-to-end', () => {
    // 2d6 doubled to 4 dice, every face floored to 3, plus a Savage Attacks
    // die that must *not* also be doubled: 5 dice, all 3s, = 15.
    const opts = poolOptionsForDamage(
      { damageDieMin: 3, critExtraDie: 1 },
      { crit: true }
    );
    const r = rollPool('2d6', opts, faceRng([1], 6))!;
    expect(r.dice).toHaveLength(5);
    expect(r.total).toBe(15);
  });
});

describe('healing and hit dice', () => {
  it('consumes healMaximized (Supreme Healing)', () => {
    expect(poolOptionsForHealing({ healMaximized: true }).maximize).toBe(true);
    expect(poolOptionsForHealing({}).maximize).toBeUndefined();
  });

  it('consumes hitDiceMaximized (periapt of wound closure)', () => {
    expect(poolOptionsForHitDice(stats({ hitDiceMaximized: true })).maximize).toBe(true);
    const r = rollPool('1d10', poolOptionsForHitDice(stats({ hitDiceMaximized: true })), faceRng([1], 10))!;
    expect(r.total).toBe(10);
  });
});
