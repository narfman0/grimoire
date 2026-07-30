import { describe, it, expect } from 'vitest';
import {
  legacyCombatStateFromPlan,
  mergeCombatState,
  parseCombatState,
  readCombatState,
  serializeCombatState
} from '../combat-state';

describe('parseCombatState', () => {
  it('parses every slot', () => {
    const raw = JSON.stringify({
      combat: { reactionUsed: true, spellSlots: { 3: { max: 3, used: 2 } } },
      conditionTimers: [{ condition: 'poisoned', untilRound: 9 }],
      lair: true
    });
    expect(parseCombatState(raw)).toEqual({
      combat: { reactionUsed: true, spellSlots: { 3: { max: 3, used: 2 } } },
      conditionTimers: [{ condition: 'poisoned', untilRound: 9 }],
      lair: true
    });
  });

  // The NPC spell-slot tally lives inside `combat` (normalizeEconomy owns it,
  // and that's the only shape the poll projects). A top-level key was
  // accepted by the write schema and silently never read, so it's gone.
  it('drops a stray top-level spellSlots key rather than storing a second home', () => {
    const raw = JSON.stringify({ spellSlots: { 3: { max: 3, used: 2 } }, lair: true });
    expect(parseCombatState(raw)).toEqual({ lair: true });
  });

  it.each([[null], [undefined], [''], ['{not json'], ['null'], ['[]'], ['"nope"']])(
    'returns null for %j so the caller can fall back',
    (raw) => {
      expect(parseCombatState(raw as string | null)).toBeNull();
    }
  );

  // This is the whole reason the column exists. plan_json was safeParse'd as
  // a unit, so one over-long `notes` zeroed a creature's economy, timers and
  // lair marker for every poller. Salvage per key instead.
  it('keeps the readable slots when one is garbage', () => {
    const raw = JSON.stringify({
      combat: 'not an object',
      conditionTimers: [{ condition: 'poisoned', untilRound: 9 }],
      lair: true
    });
    expect(parseCombatState(raw)).toEqual({
      conditionTimers: [{ condition: 'poisoned', untilRound: 9 }],
      lair: true
    });
  });

  it('treats a non-true lair value as absent', () => {
    expect(parseCombatState('{"lair":"yes"}')).toEqual({});
  });
});

describe('readCombatState', () => {
  it('prefers the column', () => {
    const state = readCombatState(
      JSON.stringify({ lair: true }),
      JSON.stringify({ lair: false, combat: { reactionUsed: true } })
    );
    expect(state).toEqual({ lair: true });
  });

  // One-release fallback: a fight live at the instant of deploy keeps its
  // counters instead of losing them mid-session. Writers only ever write the
  // new column, so this converges without a backfill.
  it('falls back to the legacy plan keys when the column is empty', () => {
    const state = readCombatState(
      null,
      JSON.stringify({
        actionId: 'bite',
        notes: 'chomp',
        combat: { reactionUsed: true },
        conditionTimers: [{ condition: 'poisoned', untilRound: 9 }],
        lair: true
      })
    );
    expect(state).toEqual({
      combat: { reactionUsed: true },
      conditionTimers: [{ condition: 'poisoned', untilRound: 9 }],
      lair: true
    });
  });

  it('ignores plan intent fields in the fallback', () => {
    const state = readCombatState(null, JSON.stringify({ actionId: 'bite', notes: 'chomp' }));
    expect(state).toEqual({});
  });

  it('survives a malformed plan without throwing', () => {
    expect(readCombatState(null, '{not json')).toEqual({});
  });
});

describe('legacyCombatStateFromPlan', () => {
  it('returns null when a plan carries no combat state', () => {
    expect(legacyCombatStateFromPlan({ actionId: 'bite', notes: '' })).toBeNull();
  });
});

describe('mergeCombatState', () => {
  it('leaves absent keys alone', () => {
    const merged = mergeCombatState({ lair: true, combat: { reactionUsed: true } }, {
      conditionTimers: [{ condition: 'poisoned', untilRound: 3 }]
    });
    expect(merged.lair).toBe(true);
    expect(merged.combat).toEqual({ reactionUsed: true });
  });

  it('clears a slot on null', () => {
    expect(mergeCombatState({ lair: true }, { lair: null }).lair).toBeUndefined();
  });

  it('clears the lair marker on false rather than storing it', () => {
    expect(mergeCombatState({ lair: true }, { lair: false })).toEqual({});
  });

  it('does not mutate the input', () => {
    const current = { lair: true as const };
    mergeCombatState(current, { lair: null });
    expect(current.lair).toBe(true);
  });

  it('ignores keys outside the known set', () => {
    const merged = mergeCombatState({}, { nonsense: 1 } as Record<string, unknown>);
    expect(merged).toEqual({});
  });
});

describe('serializeCombatState', () => {
  it('collapses empty state to null so the column is dropped', () => {
    expect(serializeCombatState({})).toBeNull();
    expect(serializeCombatState({ combat: {}, conditionTimers: [] })).toBeNull();
  });

  it('round-trips through parse', () => {
    const state = {
      combat: { reactionUsed: true },
      conditionTimers: [{ condition: 'poisoned', untilRound: 9 }],
      lair: true
    };
    expect(parseCombatState(serializeCombatState(state))).toEqual(state);
  });
});
