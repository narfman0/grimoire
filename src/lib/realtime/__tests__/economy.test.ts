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
  normalizeSpellSlots,
  resetTurnEconomy,
  setSpellSlotMax,
  setSpellSlotUsed,
  spellSlotsOf
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

  // Regression: the NPC spell-slot tally is encounter-scoped. A turn rise
  // (or the same helper's use as a rest reset) must not hand the lich back
  // its fireballs.
  it('preserves the spell-slot tally — slots are not per-turn state', () => {
    const spent = {
      ...EMPTY_ECONOMY,
      actionUsed: true,
      spellSlots: { 3: { max: 3, used: 2 } }
    };
    expect(resetTurnEconomy(spent).spellSlots).toEqual({ 3: { max: 3, used: 2 } });
  });
});

describe('normalizeSpellSlots', () => {
  it('returns undefined for junk and for an empty table', () => {
    expect(normalizeSpellSlots(null)).toBeUndefined();
    expect(normalizeSpellSlots('nope')).toBeUndefined();
    expect(normalizeSpellSlots({})).toBeUndefined();
  });

  it('parses the string keys JSON round-trips into numeric levels', () => {
    expect(normalizeSpellSlots(JSON.parse('{"1":{"max":4,"used":1}}'))).toEqual({
      1: { max: 4, used: 1 }
    });
  });

  it('drops out-of-range levels and zero-max levels', () => {
    expect(
      normalizeSpellSlots({
        0: { max: 2, used: 0 },
        10: { max: 2, used: 0 },
        cantrip: { max: 2, used: 0 },
        4: { max: 0, used: 0 },
        5: { max: 1, used: 1 }
      })
    ).toEqual({ 5: { max: 1, used: 1 } });
  });

  it('clamps used into the pool and floors fractions', () => {
    expect(normalizeSpellSlots({ 2: { max: 2.9, used: 99 } })).toEqual({
      2: { max: 2, used: 2 }
    });
    expect(normalizeSpellSlots({ 2: { max: 3, used: -4 } })).toEqual({
      2: { max: 3, used: 0 }
    });
  });

  it('caps a hostile max at the per-level ceiling', () => {
    expect(normalizeSpellSlots({ 1: { max: 5000, used: 5000 } })).toEqual({
      1: { max: 9, used: 9 }
    });
  });
});

describe('normalizeEconomy spell slots', () => {
  it('carries a well-formed table through', () => {
    expect(normalizeEconomy({ spellSlots: { 3: { max: 3, used: 1 } } })).toEqual({
      ...EMPTY_ECONOMY,
      spellSlots: { 3: { max: 3, used: 1 } }
    });
  });

  it('omits the key entirely when nothing survives normalization', () => {
    expect(normalizeEconomy({ actionUsed: true, spellSlots: { 0: { max: 1, used: 0 } } })).not.toHaveProperty(
      'spellSlots'
    );
  });

  it('leaves PC economies alone — the tracker is non-PC only', () => {
    expect(economyFromCharacterDoc({ spellSlots: { 1: { max: 4, used: 0 } } })).not.toHaveProperty(
      'spellSlots'
    );
  });
});

describe('setSpellSlotMax / setSpellSlotUsed', () => {
  it('adds a level and starts it unspent', () => {
    expect(spellSlotsOf(setSpellSlotMax(undefined, 3, 3))).toEqual({ 3: { max: 3, used: 0 } });
  });

  it('shrinking the pool clamps what was already spent', () => {
    const three = setSpellSlotUsed(setSpellSlotMax(undefined, 3, 3), 3, 3);
    expect(spellSlotsOf(setSpellSlotMax(three, 3, 1))).toEqual({ 3: { max: 1, used: 1 } });
  });

  it('setting a level to zero drops it, and dropping the last one drops the key', () => {
    const one = setSpellSlotMax(undefined, 1, 2);
    expect(setSpellSlotMax(one, 1, 0)).not.toHaveProperty('spellSlots');
  });

  it('ignores a used-write for a level with no slots configured', () => {
    expect(setSpellSlotUsed({ ...EMPTY_ECONOMY }, 9, 2)).not.toHaveProperty('spellSlots');
  });

  it('keeps the rest of the economy intact', () => {
    const e = setSpellSlotMax(
      { ...EMPTY_ECONOMY, actionUsed: true, legendaryUsed: 2, round: 5 },
      2,
      2
    );
    expect(e.actionUsed).toBe(true);
    expect(e.legendaryUsed).toBe(2);
    expect(e.round).toBe(5);
  });

  it('clamps used into [0, max]', () => {
    const e = setSpellSlotMax(undefined, 4, 2);
    expect(spellSlotsOf(setSpellSlotUsed(e, 4, 99))[4].used).toBe(2);
    expect(spellSlotsOf(setSpellSlotUsed(e, 4, -1))[4].used).toBe(0);
  });
});
