// Combat-economy projection helpers. These sit between two untrusted
// sources (a JSON column and a character document) and the planner UI, so
// the contract is "never throw, always produce a usable shape".

import { describe, it, expect } from 'vitest';
import {
  EMPTY_ECONOMY,
  economyFromCharacterDoc,
  economyIsClear,
  economyToCharacterDocFields,
  legendaryUsedForRound,
  normalizeEconomy,
  resetTurnEconomy
} from '../economy';

describe('normalizeEconomy', () => {
  it('returns the empty state for null / non-objects', () => {
    expect(normalizeEconomy(null)).toEqual(EMPTY_ECONOMY);
    expect(normalizeEconomy(undefined)).toEqual(EMPTY_ECONOMY);
    expect(normalizeEconomy('nope')).toEqual(EMPTY_ECONOMY);
  });

  it('coerces wrong-typed fields instead of trusting them', () => {
    expect(
      normalizeEconomy({
        actionUsed: 'yes',
        bonusUsed: 1,
        movementUsed: -5,
        legendaryUsed: 'two',
        round: 'four'
      })
    ).toEqual(EMPTY_ECONOMY);
  });

  it('keeps a well-formed blob, flooring fractional counters', () => {
    expect(
      normalizeEconomy({
        actionUsed: true,
        bonusUsed: true,
        reactionUsed: true,
        movementUsed: 22.7,
        legendaryUsed: 2,
        round: 4
      })
    ).toEqual({
      actionUsed: true,
      bonusUsed: true,
      reactionUsed: true,
      movementUsed: 22,
      legendaryUsed: 2,
      round: 4
    });
  });

  it('omits round when it is absent', () => {
    expect(normalizeEconomy({ actionUsed: true })).not.toHaveProperty('round');
  });
});

describe('economyFromCharacterDoc', () => {
  it('reads the *UsedThisRound fields the character sheet writes', () => {
    expect(
      economyFromCharacterDoc({
        actionUsedThisRound: true,
        bonusActionUsedThisRound: false,
        reactionUsedThisRound: true,
        movementUsedThisRound: 15
      })
    ).toEqual({
      actionUsed: true,
      bonusUsed: false,
      reactionUsed: true,
      movementUsed: 15,
      legendaryUsed: 0
    });
  });

  it('treats a document with none of the fields as all-clear', () => {
    expect(economyFromCharacterDoc({ name: 'Hero' })).toEqual(EMPTY_ECONOMY);
    expect(economyFromCharacterDoc(undefined)).toEqual(EMPTY_ECONOMY);
  });

  it('round-trips back to the document field names', () => {
    const doc = { actionUsedThisRound: true, movementUsedThisRound: 10 };
    expect(economyToCharacterDocFields(economyFromCharacterDoc(doc))).toEqual({
      actionUsedThisRound: true,
      bonusActionUsedThisRound: false,
      reactionUsedThisRound: false,
      movementUsedThisRound: 10
    });
  });
});

describe('legendaryUsedForRound', () => {
  const spent = { ...EMPTY_ECONOMY, legendaryUsed: 2, round: 4 };

  it('reports the counter during its own round', () => {
    expect(legendaryUsedForRound(spent, 4)).toBe(2);
  });

  it('expires the counter once the round moves on — no write needed', () => {
    expect(legendaryUsedForRound(spent, 5)).toBe(0);
    expect(legendaryUsedForRound(spent, 3)).toBe(0);
  });

  it('reports zero for a counter with no round stamp', () => {
    expect(legendaryUsedForRound({ ...EMPTY_ECONOMY, legendaryUsed: 3 }, 1)).toBe(0);
    expect(legendaryUsedForRound(undefined, 1)).toBe(0);
  });
});

describe('economyIsClear', () => {
  it('is true for nothing spent', () => {
    expect(economyIsClear(undefined)).toBe(true);
    expect(economyIsClear(EMPTY_ECONOMY)).toBe(true);
  });

  it('ignores the legendary counter — it is per round, not per turn', () => {
    expect(economyIsClear({ ...EMPTY_ECONOMY, legendaryUsed: 3, round: 1 })).toBe(true);
  });

  it('is false once any turn slot is spent', () => {
    expect(economyIsClear({ ...EMPTY_ECONOMY, actionUsed: true })).toBe(false);
    expect(economyIsClear({ ...EMPTY_ECONOMY, movementUsed: 5 })).toBe(false);
  });
});

describe('resetTurnEconomy', () => {
  it('clears every turn slot but preserves the round-scoped legendary tally', () => {
    expect(
      resetTurnEconomy({
        actionUsed: true,
        bonusUsed: true,
        reactionUsed: true,
        movementUsed: 30,
        legendaryUsed: 2,
        round: 4
      })
    ).toEqual({ ...EMPTY_ECONOMY, legendaryUsed: 2, round: 4 });
  });

  it('handles a missing prior value', () => {
    expect(resetTurnEconomy(undefined)).toEqual(EMPTY_ECONOMY);
  });
});
