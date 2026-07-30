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
