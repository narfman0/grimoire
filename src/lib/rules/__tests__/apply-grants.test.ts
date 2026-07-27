// applyActionUse / hasResourceBudget — the runtime consumption path for
// Action.grants (temp HP, condition removal, spell-slot restore) and the
// spendsResource debit honoring resourceCost. Pure draft-mutation helpers;
// the sheet calls them inside one patchDocument updater.

import { describe, it, expect } from 'vitest';
import { applyActionUse, hasResourceBudget } from '../apply-grants';
import type { CharacterDocument } from '../types';

function doc(overrides: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    id: 'apply-grants-test',
    name: 'Grants Subject',
    classes: [{ slug: 'cleric', level: 5, hpRolledPerLevel: [8, 5, 5, 5, 5] }],
    species: { kind: 'species', slug: 'human' },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 30,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...overrides
  };
}

const noSlots = {} as Record<number, { max: number; used: number }>;

describe('spendsResource debit', () => {
  const pool = { id: 'item/wand-of-fireballs/charges', name: 'Wand Charges', max: 7, used: 0 };

  it('debits resourceCost units in one call (not the legacy 1)', () => {
    const d = doc();
    const res = applyActionUse(
      d,
      { spendsResource: pool.id, resourceCost: 3 },
      { resources: [pool], spellSlots: noSlots }
    );
    expect(d.resourcesSpent?.[pool.id]).toBe(3);
    expect(res.applied).toContain('spent 3 Wand Charges');
  });

  it('defaults resourceCost to 1 and clamps at the pool max', () => {
    const d = doc({ resourcesSpent: { [pool.id]: 6 } });
    applyActionUse(d, { spendsResource: pool.id }, { resources: [pool], spellSlots: noSlots });
    expect(d.resourcesSpent?.[pool.id]).toBe(7);
    const d2 = doc({ resourcesSpent: { [pool.id]: 6 } });
    applyActionUse(
      d2,
      { spendsResource: pool.id, resourceCost: 4 },
      { resources: [pool], spellSlots: noSlots }
    );
    expect(d2.resourcesSpent?.[pool.id]).toBe(7); // clamped, never over max
  });

  it('leaves the draft untouched for an unknown pool id', () => {
    const d = doc();
    const res = applyActionUse(
      d,
      { spendsResource: 'item/missing/charges', resourceCost: 2 },
      { resources: [pool], spellSlots: noSlots }
    );
    expect(d.resourcesSpent).toBeUndefined();
    expect(res.applied).toEqual([]);
  });
});

describe('hasResourceBudget', () => {
  const pool = { id: 'item/wand/charges', max: 7, used: 5 };

  it('actions without spendsResource always fit', () => {
    expect(hasResourceBudget({}, [])).toBe(true);
  });

  it('compares remaining against resourceCost', () => {
    expect(hasResourceBudget({ spendsResource: pool.id, resourceCost: 2 }, [pool])).toBe(true);
    expect(hasResourceBudget({ spendsResource: pool.id, resourceCost: 3 }, [pool])).toBe(false);
    expect(hasResourceBudget({ spendsResource: pool.id }, [pool])).toBe(true); // default 1
  });

  it('unknown pool id → no budget', () => {
    expect(hasResourceBudget({ spendsResource: 'nope' }, [pool])).toBe(false);
  });
});

describe('grants.tempHp', () => {
  it('applies numeric temp HP with max (no-stack) semantics', () => {
    const d = doc({ tempHp: 2 });
    const res = applyActionUse(d, { grants: { tempHp: 5 } }, { resources: [], spellSlots: noSlots });
    expect(d.tempHp).toBe(5);
    expect(res.applied).toContain('+5 temp HP');
  });

  it('keeps a higher existing pool (RAW: take the max, never add)', () => {
    const d = doc({ tempHp: 8 });
    const res = applyActionUse(d, { grants: { tempHp: 5 } }, { resources: [], spellSlots: noSlots });
    expect(d.tempHp).toBe(8);
    expect(res.applied.some((s) => s.includes('kept at 8'))).toBe(true);
  });

  it('surfaces dice-formula temp HP as a manual follow-up (no RNG in rules)', () => {
    const d = doc({ tempHp: 3 });
    const res = applyActionUse(
      d,
      { grants: { tempHp: '1d4+4' } },
      { resources: [], spellSlots: noSlots }
    );
    expect(d.tempHp).toBe(3); // untouched
    expect(res.manual.some((s) => s.includes('1d4+4'))).toBe(true);
  });
});

describe('grants.removeConditions', () => {
  it('string entry removes the condition and its stack record', () => {
    const d = doc({ conditions: ['poisoned', 'prone'], conditionStacks: { poisoned: 2 } });
    const res = applyActionUse(
      d,
      { grants: { removeConditions: ['poisoned'] } },
      { resources: [], spellSlots: noSlots }
    );
    expect(d.conditions).toEqual(['prone']);
    expect(d.conditionStacks?.poisoned).toBeUndefined();
    expect(res.applied).toContain('removed poisoned');
  });

  it('stacks entry decrements and removes at 0', () => {
    const d = doc({ conditions: ['exhaustion'], conditionStacks: { exhaustion: 3 } });
    applyActionUse(
      d,
      { grants: { removeConditions: [{ condition: 'exhaustion', stacks: 2 }] } },
      { resources: [], spellSlots: noSlots }
    );
    expect(d.conditionStacks?.exhaustion).toBe(1);
    expect(d.conditions).toEqual(['exhaustion']);
    const res = applyActionUse(
      d,
      { grants: { removeConditions: [{ condition: 'exhaustion', stacks: 2 }] } },
      { resources: [], spellSlots: noSlots }
    );
    expect(d.conditions).toEqual([]);
    expect(d.conditionStacks?.exhaustion).toBeUndefined();
    expect(res.applied).toContain('removed exhaustion');
  });

  it('a condition the character does not have is a silent no-op', () => {
    const d = doc({ conditions: ['prone'] });
    const res = applyActionUse(
      d,
      { grants: { removeConditions: ['poisoned', { condition: 'exhaustion', stacks: 1 }] } },
      { resources: [], spellSlots: noSlots }
    );
    expect(d.conditions).toEqual(['prone']);
    expect(res.applied).toEqual([]);
  });
});

describe('grants.restoreSpellSlots (level N or lower, pick-best)', () => {
  const slots = {
    1: { max: 4, used: 0 },
    2: { max: 3, used: 0 },
    3: { max: 2, used: 0 }
  };

  it('restores the highest-level spent slot ≤ level', () => {
    const d = doc({ resourcesSpent: { 'spell-slot/L2': 1, 'spell-slot/L3': 1 } });
    const res = applyActionUse(
      d,
      { grants: { restoreSpellSlots: { level: 3 } } },
      { resources: [], spellSlots: slots }
    );
    expect(d.resourcesSpent?.['spell-slot/L3']).toBe(0);
    expect(d.resourcesSpent?.['spell-slot/L2']).toBe(1); // untouched
    expect(res.applied).toContain('restored 1 level-3 slot');
  });

  it('never restores above the grant level even when higher slots are spent', () => {
    const d = doc({ resourcesSpent: { 'spell-slot/L3': 2, 'spell-slot/L1': 1 } });
    applyActionUse(
      d,
      { grants: { restoreSpellSlots: { level: 2 } } },
      { resources: [], spellSlots: slots }
    );
    expect(d.resourcesSpent?.['spell-slot/L3']).toBe(2); // untouched
    expect(d.resourcesSpent?.['spell-slot/L1']).toBe(0);
  });

  it('count > 1 walks down the levels as pools empty', () => {
    const d = doc({ resourcesSpent: { 'spell-slot/L3': 1, 'spell-slot/L2': 1 } });
    const res = applyActionUse(
      d,
      { grants: { restoreSpellSlots: { level: 3, count: 3 } } },
      { resources: [], spellSlots: slots }
    );
    // L3 restored first, then L2; third restore finds nothing spent.
    expect(d.resourcesSpent?.['spell-slot/L3']).toBe(0);
    expect(d.resourcesSpent?.['spell-slot/L2']).toBe(0);
    expect(res.applied).toContain('restored 1 level-3 slot');
    expect(res.applied).toContain('restored 1 level-2 slot');
  });

  it('nothing spent → no change, clamped at 0', () => {
    const d = doc();
    const res = applyActionUse(
      d,
      { grants: { restoreSpellSlots: { level: 3, count: 2 } } },
      { resources: [], spellSlots: slots }
    );
    expect(d.resourcesSpent?.['spell-slot/L3'] ?? 0).toBe(0);
    expect(res.applied).toEqual([]);
  });

  it('spent counts above max are treated as max (defensive clamp)', () => {
    const d = doc({ resourcesSpent: { 'spell-slot/L2': 9 } });
    applyActionUse(
      d,
      { grants: { restoreSpellSlots: { level: 2 } } },
      { resources: [], spellSlots: slots }
    );
    expect(d.resourcesSpent?.['spell-slot/L2']).toBe(2); // clamped to max 3, then −1
  });
});

describe('combined use', () => {
  it('debit + grants land on the same draft in one call', () => {
    const pool = { id: 'item/ring/charges', name: 'Ring Charges', max: 3, used: 0 };
    const d = doc({ tempHp: 0, conditions: ['poisoned'], resourcesSpent: { 'spell-slot/L1': 2 } });
    const res = applyActionUse(
      d,
      {
        spendsResource: pool.id,
        resourceCost: 2,
        grants: {
          tempHp: 5,
          removeConditions: ['poisoned'],
          restoreSpellSlots: { level: 1 }
        }
      },
      { resources: [pool], spellSlots: { 1: { max: 4, used: 2 } } }
    );
    expect(d.resourcesSpent?.[pool.id]).toBe(2);
    expect(d.tempHp).toBe(5);
    expect(d.conditions).toEqual([]);
    expect(d.resourcesSpent?.['spell-slot/L1']).toBe(1);
    expect(res.applied).toHaveLength(4);
  });
});
