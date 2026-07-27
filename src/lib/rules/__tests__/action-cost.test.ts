import { describe, it, expect } from 'vitest';
import { costLabel, slotForCost } from '../action-cost';

describe('costLabel', () => {
  it('maps the four core string costs to their display labels', () => {
    expect(costLabel('action')).toBe('Action');
    expect(costLabel('bonus')).toBe('Bonus');
    expect(costLabel('reaction')).toBe('Reaction');
    expect(costLabel('free')).toBe('Free');
  });

  it('renders movement cost as "{N} ft move"', () => {
    expect(costLabel({ movement: 30 })).toBe('30 ft move');
  });

  it('renders limited-use cost as "{N}/{per}"', () => {
    expect(costLabel({ uses: 3, per: 'long-rest' })).toBe('3/long-rest');
  });

  it('falls back to String() for unknown shapes', () => {
    expect(costLabel(null)).toBe('');
    expect(costLabel(undefined)).toBe('');
    expect(costLabel(42)).toBe('42');
    expect(costLabel('something-custom')).toBe('something-custom');
  });
});

describe('slotForCost', () => {
  it('maps the three economy slots', () => {
    expect(slotForCost('action')).toBe('action');
    expect(slotForCost('bonus')).toBe('bonus');
    expect(slotForCost('reaction')).toBe('reaction');
  });

  it('returns null for free / movement / limited-use / unknown', () => {
    // Locks: 'free' must not consume a numbered slot — the action-economy
    // picker uses this to decide whether to grey out spent slots.
    expect(slotForCost('free')).toBeNull();
    expect(slotForCost({ movement: 30 })).toBeNull();
    expect(slotForCost({ uses: 1, per: 'long-rest' })).toBeNull();
    expect(slotForCost(undefined)).toBeNull();
  });
});

describe('hit-dice costs', () => {
  it('renders "N Hit Dice" (singular Die at 1)', () => {
    expect(costLabel({ hitDice: 2 })).toBe('2 Hit Dice');
    expect(costLabel({ hitDice: 1 })).toBe('1 Hit Die');
  });

  it('maps to no action-economy slot (display-only cost)', () => {
    expect(slotForCost({ hitDice: 2 })).toBe(null);
  });
});
