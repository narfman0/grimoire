// Planner action legality — the encounter-side counterpart to the character
// sheet's `unavailable` computation. The resource verdict is precomputed
// server-side (hasResourceBudget); this layer folds it with the live
// action-economy flags and produces the reason string the picker shows.

import { describe, it, expect } from 'vitest';
import {
  actionAvailability,
  labelWithReason,
  normalizeSpentPools,
  resourceSuffix,
  withLiveResources
} from '../action-availability';

describe('actionAvailability', () => {
  const spent = { actionUsed: true, bonusUsed: true, reactionUsed: true };

  it('allows an action with a free slot and enough budget', () => {
    expect(actionAvailability({ cost: 'action', affordable: true }, {})).toEqual({
      unavailable: false,
      reason: null
    });
  });

  it('treats a bare statblock choice (no annotations) as available', () => {
    expect(actionAvailability({}, spent)).toEqual({ unavailable: false, reason: null });
  });

  it('blocks an action pick once the action slot is spent', () => {
    expect(actionAvailability({ cost: 'action', affordable: true }, spent)).toEqual({
      unavailable: true,
      reason: 'no action left'
    });
  });

  it('blocks a bonus pick once the bonus slot is spent', () => {
    expect(actionAvailability({ cost: 'bonus', affordable: true }, spent)).toEqual({
      unavailable: true,
      reason: 'no bonus action left'
    });
  });

  it('blocks a reaction pick once the reaction is spent', () => {
    expect(actionAvailability({ cost: 'reaction', affordable: true }, spent)).toEqual({
      unavailable: true,
      reason: 'no reaction left'
    });
  });

  it('leaves free / movement costs alone even when every slot is spent', () => {
    expect(actionAvailability({ cost: 'free', affordable: true }, spent).unavailable).toBe(false);
    expect(
      actionAvailability({ cost: { movement: 10 }, affordable: true }, spent).unavailable
    ).toBe(false);
  });

  it('reports an empty pool as "out of uses"', () => {
    expect(
      actionAvailability(
        { cost: 'action', spendsResource: 'ki', resourceRemaining: 0, resourceMax: 3, affordable: false },
        {}
      )
    ).toEqual({ unavailable: true, reason: 'out of uses' });
  });

  it('reports a partially-drained pool that cannot cover the cost as "not enough charges"', () => {
    expect(
      actionAvailability(
        {
          cost: 'action',
          spendsResource: 'wand',
          resourceCost: 3,
          resourceRemaining: 2,
          resourceMax: 7,
          affordable: false
        },
        {}
      )
    ).toEqual({ unavailable: true, reason: 'not enough charges' });
  });

  it('falls back to "out of uses" when the pool could not be resolved at all', () => {
    expect(
      actionAvailability({ cost: 'action', spendsResource: 'ghost-pool', affordable: false }, {})
    ).toEqual({ unavailable: true, reason: 'out of uses' });
  });

  it('prefers the economy reason over the resource reason', () => {
    // Both blockers apply; the slot message is the actionable one.
    expect(
      actionAvailability(
        { cost: 'action', spendsResource: 'ki', resourceRemaining: 0, affordable: false },
        spent
      ).reason
    ).toBe('no action left');
  });

  it('does not block on economy when no flags are supplied', () => {
    expect(actionAvailability({ cost: 'action', affordable: true }, undefined).unavailable).toBe(
      false
    );
  });

  it('allows when the server verdict is missing (unknown = permissive)', () => {
    expect(actionAvailability({ cost: 'action', spendsResource: 'ki' }, {}).unavailable).toBe(false);
  });
});

describe('resourceSuffix', () => {
  it('is empty for actions that spend nothing', () => {
    expect(resourceSuffix({ cost: 'action', affordable: true })).toBe('');
  });

  it('renders remaining/max plus the pool name', () => {
    expect(
      resourceSuffix({
        spendsResource: 'ki',
        resourceName: 'Ki',
        resourceRemaining: 2,
        resourceMax: 5
      })
    ).toBe(' — 2/5 Ki left');
  });

  it('omits the max when unknown', () => {
    expect(resourceSuffix({ spendsResource: 'ki', resourceRemaining: 1 })).toBe(' — 1 left');
  });
});

describe('labelWithReason', () => {
  it('appends the reason for a blocked pick', () => {
    expect(labelWithReason('Second Wind', { unavailable: true, reason: 'out of uses' })).toBe(
      'Second Wind — out of uses'
    );
  });

  it('leaves an available pick untouched', () => {
    expect(labelWithReason('Second Wind', { unavailable: false, reason: null })).toBe('Second Wind');
  });
});

// The SSR half of a planner action goes stale the moment the player spends
// the pool on their character sheet: page data only re-runs on
// invalidateAll, while the poll ticks every 2s. `withLiveResources` folds
// the poll's spend counter over the SSR pool so "2/5 Ki left" keeps up.
describe('normalizeSpentPools', () => {
  it('returns undefined when nothing is spent', () => {
    expect(normalizeSpentPools(undefined)).toBeUndefined();
    expect(normalizeSpentPools({})).toBeUndefined();
    expect(normalizeSpentPools({ ki: 0 })).toBeUndefined();
    expect(normalizeSpentPools('nope')).toBeUndefined();
  });

  it('keeps positive counters and floors fractions', () => {
    expect(normalizeSpentPools({ ki: 2.9, rage: 0, bogus: 'x', neg: -3 })).toEqual({ ki: 2 });
  });
});

describe('withLiveResources', () => {
  const ki = {
    cost: 'action',
    spendsResource: 'ki',
    resourceName: 'Ki',
    resourceCost: 1,
    resourceRemaining: 5,
    resourceMax: 5,
    affordable: true
  };

  it('recomputes remaining from the live spend counter', () => {
    expect(withLiveResources(ki, { ki: 3 })).toMatchObject({
      resourceRemaining: 2,
      affordable: true
    });
  });

  it('flips the affordability verdict when the pool runs dry', () => {
    expect(withLiveResources(ki, { ki: 5 })).toMatchObject({
      resourceRemaining: 0,
      affordable: false
    });
    expect(actionAvailability(withLiveResources(ki, { ki: 5 }), {})).toEqual({
      unavailable: true,
      reason: 'out of uses'
    });
  });

  it('refuses a multi-unit cost the drained pool cannot cover', () => {
    const fireball = { ...ki, spendsResource: 'charges', resourceCost: 3, resourceMax: 7 };
    const live = withLiveResources(fireball, { charges: 5 });
    expect(live.resourceRemaining).toBe(2);
    expect(actionAvailability(live, {})).toEqual({
      unavailable: true,
      reason: 'not enough charges'
    });
  });

  it('clamps a spend counter that overshoots the pool', () => {
    expect(withLiveResources(ki, { ki: 99 }).resourceRemaining).toBe(0);
  });

  it('re-fills the readout when the sheet restores the pool', () => {
    const drained = { ...ki, resourceRemaining: 0, affordable: false };
    expect(withLiveResources(drained, { ki: 1 })).toMatchObject({
      resourceRemaining: 4,
      affordable: true
    });
    // A rest clears the counter entirely — the pool reads full again.
    expect(withLiveResources(drained, {})).toMatchObject({
      resourceRemaining: 5,
      affordable: true
    });
  });

  it('passes through actions with no pool, and returns the same object', () => {
    const plain = { cost: 'action' as const };
    expect(withLiveResources(plain, { ki: 2 })).toBe(plain);
    // Pool the loader could not resolve (no max) — nothing to recompute.
    const unknownPool = { cost: 'action', spendsResource: 'mystery', affordable: false };
    expect(withLiveResources(unknownPool, { mystery: 1 })).toBe(unknownPool);
    // No live data yet (pre-first-poll): keep the SSR numbers.
    expect(withLiveResources(ki, undefined)).toBe(ki);
  });
});
