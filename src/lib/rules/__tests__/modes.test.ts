import { describe, it, expect } from 'vitest';
import { applyNumericMode, defaultPriority, type Mode } from '../modes';

describe('applyNumericMode', () => {
  it('ADD sums current + value', () => {
    expect(applyNumericMode(10, 'ADD', 3)).toBe(13);
    expect(applyNumericMode(10, 'ADD', -5)).toBe(5);
  });

  it('MULTIPLY multiplies', () => {
    expect(applyNumericMode(10, 'MULTIPLY', 2)).toBe(20);
    expect(applyNumericMode(10, 'MULTIPLY', 0.5)).toBe(5);
  });

  // UPGRADE / DOWNGRADE keep the better/worse of the two — used for AC
  // mage-armor ("13 + dex" vs base 10 + dex), darkvision range upgrades,
  // etc. Regression here would silently corrupt the ceiling/floor logic.
  it('UPGRADE keeps the larger of current and value', () => {
    expect(applyNumericMode(10, 'UPGRADE', 15)).toBe(15);
    expect(applyNumericMode(15, 'UPGRADE', 10)).toBe(15);
  });

  it('DOWNGRADE keeps the smaller of current and value', () => {
    expect(applyNumericMode(10, 'DOWNGRADE', 5)).toBe(5);
    expect(applyNumericMode(5, 'DOWNGRADE', 10)).toBe(5);
  });

  it('OVERRIDE replaces with value', () => {
    expect(applyNumericMode(10, 'OVERRIDE', 99)).toBe(99);
  });

  it('CUSTOM is a no-op in v0 (returns current)', () => {
    expect(applyNumericMode(10, 'CUSTOM', 99)).toBe(10);
  });
});

describe('defaultPriority', () => {
  // Locks the relative ordering — modifiers apply in ascending priority,
  // so CUSTOM first, OVERRIDE last. A reordering would silently break
  // stack-order assumptions in derive().
  it('preserves the documented ordering', () => {
    const order: Mode[] = ['CUSTOM', 'MULTIPLY', 'ADD', 'DOWNGRADE', 'UPGRADE', 'OVERRIDE'];
    const priorities = order.map(defaultPriority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThan(priorities[i - 1]);
    }
  });
});
