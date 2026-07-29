import { describe, it, expect } from 'vitest';
import { lairReminderForTurn, lairSlotParticipantId, lairSources } from '../lair';

/** Rows arrive already in initiative order (the list the page renders). */
const ordered = [
  { id: 'wyrm', name: 'Ancient Wyrm', initiative: 24, legendaryActionCount: 3 },
  { id: 'rogue', name: 'Rogue', initiative: 20 },
  { id: 'fighter', name: 'Fighter', initiative: 18 },
  { id: 'goblin', name: 'Goblin', initiative: 9 }
];

describe('lairSlotParticipantId', () => {
  it('anchors to the first participant below initiative 20', () => {
    expect(lairSlotParticipantId(ordered)).toBe('fighter');
  });

  it('loses ties — a participant on exactly 20 acts before the lair', () => {
    expect(
      lairSlotParticipantId([
        { id: 'a', initiative: 20 },
        { id: 'b', initiative: 20 },
        { id: 'c', initiative: 19 }
      ])
    ).toBe('c');
  });

  it('is null when nobody rolled below 20', () => {
    expect(
      lairSlotParticipantId([
        { id: 'a', initiative: 25 },
        { id: 'b', initiative: 20 }
      ])
    ).toBeNull();
  });

  it('skips unrolled rows rather than anchoring to them', () => {
    expect(
      lairSlotParticipantId([
        { id: 'a', initiative: null },
        { id: 'b', initiative: 12 }
      ])
    ).toBe('b');
    expect(lairSlotParticipantId([{ id: 'a', initiative: null }])).toBeNull();
  });
});

describe('lairSources', () => {
  it('picks up legendary-action bearers and DM-flagged lairs', () => {
    const sources = lairSources([
      ...ordered,
      { id: 'cave', name: 'Cave', initiative: 5, lair: true }
    ]);
    expect(sources.map((s) => s.id)).toEqual(['wyrm', 'cave']);
  });

  it('ignores participants with an empty legendary list', () => {
    expect(lairSources([{ id: 'a', name: 'A', initiative: 10, legendaryActionCount: 0 }])).toEqual(
      []
    );
  });
});

describe('lairReminderForTurn', () => {
  it('fires on the turn the initiative-20 slot precedes', () => {
    const reminder = lairReminderForTurn({
      participants: ordered,
      activeParticipantId: 'fighter'
    });
    expect(reminder).toEqual({ sourceNames: ['Ancient Wyrm'], hasLair: false });
  });

  it('stays quiet on every other turn in the round', () => {
    for (const id of ['wyrm', 'rogue', 'goblin']) {
      expect(lairReminderForTurn({ participants: ordered, activeParticipantId: id })).toBeNull();
    }
  });

  it('stays quiet when no participant has legendary or lair actions', () => {
    const plain = ordered.map((p) => ({ ...p, legendaryActionCount: 0 }));
    expect(
      lairReminderForTurn({ participants: plain, activeParticipantId: 'fighter' })
    ).toBeNull();
  });

  it('reports hasLair when the DM flagged a lair, not just legendary actions', () => {
    const withLair = ordered.map((p) => (p.id === 'wyrm' ? { ...p, lair: true } : p));
    expect(
      lairReminderForTurn({ participants: withLair, activeParticipantId: 'fighter' })?.hasLair
    ).toBe(true);
  });

  it('stays quiet with no active participant', () => {
    expect(lairReminderForTurn({ participants: ordered, activeParticipantId: null })).toBeNull();
  });
});
