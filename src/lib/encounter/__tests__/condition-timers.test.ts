import { describe, it, expect } from 'vitest';
import {
  clearTimer,
  expiryPromptsForTurn,
  lapsedTimers,
  normalizeTimers,
  promptKey,
  pruneTimers,
  roundsRemaining,
  setTimer,
  timerFor,
  type ConditionTimer
} from '../condition-timers';

describe('normalizeTimers', () => {
  it('drops malformed entries and keeps one timer per condition', () => {
    expect(
      normalizeTimers([
        { condition: 'poisoned', untilRound: 4 },
        { condition: 'poisoned', untilRound: 7 },
        { condition: '', untilRound: 3 },
        { condition: 'stunned' },
        { untilRound: 2 },
        'nope',
        null,
        { condition: 'prone', untilRound: 5.9 }
      ])
    ).toEqual([
      { condition: 'poisoned', untilRound: 7 },
      { condition: 'prone', untilRound: 5 }
    ]);
  });

  it('returns an empty list for non-array input', () => {
    expect(normalizeTimers(undefined)).toEqual([]);
    expect(normalizeTimers({ condition: 'poisoned', untilRound: 3 })).toEqual([]);
  });
});

describe('setTimer / clearTimer', () => {
  it('lapses N rounds after the round it was applied in', () => {
    const timers = setTimer([], 'poisoned', 5, 3);
    expect(timers).toEqual([{ condition: 'poisoned', untilRound: 8 }]);
    expect(roundsRemaining(timers[0], 5)).toBe(3);
    expect(roundsRemaining(timers[0], 8)).toBe(0);
  });

  it('replaces an existing timer for the same condition', () => {
    const first = setTimer([], 'poisoned', 1, 2);
    const second = setTimer(first, 'poisoned', 3, 5);
    expect(second).toEqual([{ condition: 'poisoned', untilRound: 8 }]);
  });

  it('treats a non-positive duration as "no timer"', () => {
    const timers = setTimer([{ condition: 'poisoned', untilRound: 9 }], 'poisoned', 4, 0);
    expect(timers).toEqual([]);
    expect(setTimer([], 'prone', 2, Number.NaN)).toEqual([]);
  });

  it('clearTimer leaves other conditions alone', () => {
    const timers: ConditionTimer[] = [
      { condition: 'poisoned', untilRound: 4 },
      { condition: 'prone', untilRound: 6 }
    ];
    expect(clearTimer(timers, 'poisoned')).toEqual([{ condition: 'prone', untilRound: 6 }]);
    expect(timerFor(timers, 'prone')?.untilRound).toBe(6);
    expect(timerFor(timers, 'blinded')).toBeUndefined();
  });
});

describe('pruneTimers', () => {
  it('drops timers whose condition is no longer applied', () => {
    const timers: ConditionTimer[] = [
      { condition: 'poisoned', untilRound: 4 },
      { condition: 'prone', untilRound: 6 }
    ];
    expect(pruneTimers(timers, ['prone'])).toEqual([{ condition: 'prone', untilRound: 6 }]);
    expect(pruneTimers(timers, [])).toEqual([]);
  });
});

describe('lapsedTimers', () => {
  it('only reports timers whose condition is still on', () => {
    const timers: ConditionTimer[] = [{ condition: 'poisoned', untilRound: 3 }];
    expect(lapsedTimers(timers, ['poisoned'], 3)).toHaveLength(1);
    expect(lapsedTimers(timers, [], 3)).toHaveLength(0);
  });

  it('does not report a timer before its round', () => {
    const timers: ConditionTimer[] = [{ condition: 'poisoned', untilRound: 4 }];
    expect(lapsedTimers(timers, ['poisoned'], 3)).toHaveLength(0);
    expect(lapsedTimers(timers, ['poisoned'], 4)).toHaveLength(1);
    expect(lapsedTimers(timers, ['poisoned'], 9)).toHaveLength(1);
  });

  it('orders the most overdue first', () => {
    const timers: ConditionTimer[] = [
      { condition: 'prone', untilRound: 5 },
      { condition: 'poisoned', untilRound: 2 }
    ];
    expect(lapsedTimers(timers, ['prone', 'poisoned'], 6).map((t) => t.condition)).toEqual([
      'poisoned',
      'prone'
    ]);
  });
});

describe('expiryPromptsForTurn', () => {
  const participants = [
    { id: 'goblin-2', name: 'Goblin 2' },
    { id: 'pc-1', name: 'Kribwynn' }
  ];

  function input(over: Partial<Parameters<typeof expiryPromptsForTurn>[0]> = {}) {
    return {
      round: 4,
      activeParticipantId: 'goblin-2',
      participants,
      conditionsFor: (id: string) => (id === 'goblin-2' ? ['poisoned'] : ['prone']),
      timersFor: (id: string) =>
        id === 'goblin-2'
          ? [{ condition: 'poisoned', untilRound: 4 }]
          : [{ condition: 'prone', untilRound: 1 }],
      ...over
    };
  }

  it('raises the lapsed condition for the active participant', () => {
    expect(expiryPromptsForTurn(input())).toEqual([
      { participantId: 'goblin-2', participantName: 'Goblin 2', condition: 'poisoned', untilRound: 4 }
    ]);
  });

  it('ignores other participants, however overdue they are', () => {
    const prompts = expiryPromptsForTurn(input({ activeParticipantId: 'goblin-2' }));
    expect(prompts.every((p) => p.participantId === 'goblin-2')).toBe(true);
  });

  it('raises nothing before the timer lapses', () => {
    expect(expiryPromptsForTurn(input({ round: 3 }))).toEqual([]);
  });

  it('raises nothing when no participant is active', () => {
    expect(expiryPromptsForTurn(input({ activeParticipantId: null }))).toEqual([]);
  });

  it('raises nothing when the active id is not in the list', () => {
    expect(expiryPromptsForTurn(input({ activeParticipantId: 'ghost' }))).toEqual([]);
  });

  it('keys prompts by participant + condition + round so a lapse queues once', () => {
    const [prompt] = expiryPromptsForTurn(input());
    expect(promptKey(prompt)).toBe('goblin-2:poisoned:4');
  });
});
