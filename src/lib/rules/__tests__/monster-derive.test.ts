import { describe, expect, it } from 'vitest';
import { monsterDerive } from '../monster-derive';

describe('monsterDerive legendary actions', () => {
  const base = {
    abilityScores: { str: 20, dex: 10, con: 18, int: 14, wis: 12, cha: 16 },
    cr: 17
  };

  it('parses per-action cost from the "(Costs N Actions)" name suffix', () => {
    const d = monsterDerive({
      ...base,
      legendaryActions: [
        { name: 'Tail Attack', description: 'One tail attack.' },
        { name: 'Wing Attack (Costs 2 Actions)', description: 'Beats its wings.' },
        { name: 'Conjure Snakes (costs 3 actions)' }
      ]
    });
    expect(d.legendaryActions.map((a) => a.cost)).toEqual([undefined, 2, 3]);
  });

  it('prefers an explicit numeric cost field over the name parse', () => {
    const d = monsterDerive({
      ...base,
      legendaryActions: [{ name: 'Odd One (Costs 2 Actions)', cost: 1 }]
    });
    expect(d.legendaryActions[0].cost).toBe(1);
  });

  it('defaults the budget to 3 for creatures with legendary actions', () => {
    const d = monsterDerive({ ...base, legendaryActions: [{ name: 'Detect' }] });
    expect(d.legendaryBudget).toBe(3);
  });

  it('reports a zero budget for ordinary creatures', () => {
    expect(monsterDerive(base).legendaryBudget).toBe(0);
  });

  it('honors an explicit legendaryActionCount', () => {
    const d = monsterDerive({
      ...base,
      legendaryActionCount: 5,
      legendaryActions: [{ name: 'Detect' }]
    });
    expect(d.legendaryBudget).toBe(5);
  });

  it('parses "can take N legendary actions" prose, digits or words', () => {
    const d = monsterDerive({
      ...base,
      legendaryDescription: 'The kraken can take two legendary actions, choosing from…',
      legendaryActions: [{ name: 'Tentacle' }]
    });
    expect(d.legendaryBudget).toBe(2);
    const digits = monsterDerive({
      ...base,
      legendaryDescription: 'It can take 4 legendary actions each round.',
      legendaryActions: [{ name: 'Tentacle' }]
    });
    expect(digits.legendaryBudget).toBe(4);
  });

  it('regular actions never grow a cost', () => {
    const d = monsterDerive({
      ...base,
      actions: [{ name: 'Multiattack' }, { name: 'Bite', attackBonus: 11 }]
    });
    expect(d.actions.every((a) => a.cost === undefined)).toBe(true);
  });
});

describe('monsterDerive damage defences', () => {
  const base = {
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    cr: 1
  };

  // The SRD pack ships one combined `immunities` list with `-damage` /
  // `-condition` suffixes; the homebrew editor writes the split
  // `damageImmunities` / `conditionImmunities` fields. Reading only the
  // latter meant the SRD skeleton's poison immunity and bludgeoning
  // vulnerability never reached MonsterDerived — so it took full damage
  // from both and the resistance engine had nothing to work with.
  it('splits the content-pack combined immunities list by suffix', () => {
    const d = monsterDerive({
      ...base,
      immunities: ['poison-damage', 'exhaustion', 'poisoned-condition'],
      vulnerabilities: ['bludgeoning']
    });
    expect(d.damageImmunities).toEqual(['poison']);
    expect(d.conditionImmunities).toEqual(['exhaustion', 'poisoned']);
    expect(d.damageVulnerabilities).toEqual(['bludgeoning']);
  });

  it('reads the explicit split fields too', () => {
    const d = monsterDerive({
      ...base,
      damageResistances: ['Cold', 'fire'],
      damageImmunities: ['poison'],
      conditionImmunities: ['charmed']
    });
    expect(d.damageResistances).toEqual(['cold', 'fire']);
    expect(d.damageImmunities).toEqual(['poison']);
    expect(d.conditionImmunities).toEqual(['charmed']);
  });

  it('merges both shapes without duplicating a type', () => {
    const d = monsterDerive({
      ...base,
      damageImmunities: ['poison'],
      immunities: ['poison-damage', 'paralyzed-condition']
    });
    expect(d.damageImmunities).toEqual(['poison']);
    expect(d.conditionImmunities).toEqual(['paralyzed']);
  });

  it('treats an untagged non-damage entry as a condition', () => {
    const d = monsterDerive({ ...base, immunities: ['charmed', 'fire'] });
    expect(d.damageImmunities).toEqual(['fire']);
    expect(d.conditionImmunities).toEqual(['charmed']);
  });

  it('yields empty lists when nothing is declared', () => {
    const d = monsterDerive(base);
    expect(d.damageImmunities).toEqual([]);
    expect(d.damageResistances).toEqual([]);
    expect(d.damageVulnerabilities).toEqual([]);
    expect(d.conditionImmunities).toEqual([]);
  });
});
