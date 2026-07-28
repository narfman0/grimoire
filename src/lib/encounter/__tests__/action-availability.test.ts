// Planner action legality — the encounter-side counterpart to the character
// sheet's `unavailable` computation. The resource verdict is precomputed
// server-side (hasResourceBudget); this layer folds it with the live
// action-economy flags and produces the reason string the picker shows.

import { describe, it, expect } from 'vitest';
import {
  actionAvailability,
  labelWithReason,
  resourceSuffix
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
