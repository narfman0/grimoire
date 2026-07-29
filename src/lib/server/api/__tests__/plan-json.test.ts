// Reading a stored plan_json blob back.
//
// `PlanJson` is strict on the way in (a bad request gets a 400 and the
// writer fixes it) but a stored row has to be read back leniently: the blob
// carries four independent concerns — the declared intent, the combat
// economy (incl. the DM's NPC spell slots), the condition-duration overlay
// and the lair marker — and an all-or-nothing parse let one bad field
// silently zero all of them for every poller.

import { describe, it, expect, vi } from 'vitest';
import { PlanJson, salvagePlanJson } from '../encounter-schemas';

const VALID = {
  actionId: 'bite',
  actionLabel: 'Bite',
  targetParticipantIds: ['pc-1'],
  notes: 'chomp',
  updatedAt: 1700000000000,
  combat: { legendaryUsed: 2, round: 3, spellSlots: { '3': { max: 3, used: 2 } } },
  conditionTimers: [{ condition: 'poisoned', untilRound: 5 }],
  lair: true
};

describe('salvagePlanJson', () => {
  it('returns the strict parse untouched when the blob is valid', () => {
    const onSalvage = vi.fn();
    expect(salvagePlanJson(VALID, onSalvage)).toEqual(PlanJson.parse(VALID));
    expect(onSalvage).not.toHaveBeenCalled();
  });

  it('rejects non-objects', () => {
    expect(salvagePlanJson(null)).toBeNull();
    expect(salvagePlanJson('nope')).toBeNull();
    expect(salvagePlanJson([1, 2])).toBeNull();
  });

  // The regression: `notes` is capped at 500, so a longer one failed the
  // whole parse and took the economy, slots, timers and lair with it.
  it('keeps every sibling key when one field is invalid', () => {
    const onSalvage = vi.fn();
    const salvaged = salvagePlanJson({ ...VALID, notes: 'x'.repeat(600) }, onSalvage);

    expect(salvaged).not.toBeNull();
    expect(salvaged!.combat).toEqual({
      actionUsed: false,
      bonusUsed: false,
      reactionUsed: false,
      movementUsed: 0,
      legendaryUsed: 2,
      round: 3,
      spellSlots: { 3: { max: 3, used: 2 } }
    });
    expect(salvaged!.conditionTimers).toEqual([{ condition: 'poisoned', untilRound: 5 }]);
    expect(salvaged!.lair).toBe(true);
    // The intent survives too, with the offending field repaired.
    expect(salvaged!.actionId).toBe('bite');
    expect(salvaged!.notes).toHaveLength(500);
    // …and the repair is reported rather than swallowed.
    expect(onSalvage).toHaveBeenCalledTimes(1);
    expect(onSalvage.mock.calls[0][0].join(' ')).toContain('notes');
  });

  it('a broken extra does not cost the other extras', () => {
    const salvaged = salvagePlanJson({
      ...VALID,
      // Bogus level key: rejected by SpellSlotsJson, coerced away by
      // normalizeEconomy without touching the legendary tally.
      combat: { legendaryUsed: 1, round: 2, spellSlots: { cantrip: { max: 3, used: 1 } } }
    });
    expect(salvaged!.combat).toMatchObject({ legendaryUsed: 1, round: 2 });
    expect(salvaged!.combat).not.toHaveProperty('spellSlots');
    expect(salvaged!.conditionTimers).toEqual([{ condition: 'poisoned', untilRound: 5 }]);
    expect(salvaged!.lair).toBe(true);
  });

  it('drops a malformed timer without dropping the rest of the overlay', () => {
    const salvaged = salvagePlanJson({
      ...VALID,
      conditionTimers: [
        { condition: 'poisoned', untilRound: 5 },
        { condition: '', untilRound: 'soon' }
      ]
    });
    expect(salvaged!.conditionTimers).toEqual([{ condition: 'poisoned', untilRound: 5 }]);
    expect(salvaged!.combat).toMatchObject({ legendaryUsed: 2 });
  });

  it('fills in a plan missing its required intent fields', () => {
    const salvaged = salvagePlanJson({ combat: { legendaryUsed: 1 } });
    expect(salvaged).toMatchObject({
      actionId: '',
      actionLabel: '',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 0
    });
    expect(salvaged!.combat).toMatchObject({ legendaryUsed: 1 });
  });

  it('produces a blob the strict schema accepts', () => {
    const salvaged = salvagePlanJson({
      ...VALID,
      notes: 'x'.repeat(600),
      updatedAt: -1,
      targetParticipantIds: ['pc-1', 42, null]
    });
    expect(() => PlanJson.parse(salvaged)).not.toThrow();
  });
});
