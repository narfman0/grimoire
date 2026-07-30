import { describe, it, expect } from 'vitest';
import {
  mergeDisplayParticipants,
  redactLiveParticipants,
  showsExactHp,
  type DisplayParticipant
} from '../display-list';
import type { LiveParticipant } from '$lib/realtime/participants';
import type { ParticipantReveals } from '$lib/realtime/reveals';

const NONE: ParticipantReveals = { identity: false, vitals: false, combat: false, hidden: false };
const ALL: ParticipantReveals = { identity: true, vitals: true, combat: true, hidden: false };

function live(
  over: Partial<LiveParticipant> & { id: string }
): LiveParticipant {
  return {
    kind: 'npc',
    characterId: null,
    name: over.name ?? 'Monster',
    placeholderName: over.name ?? 'Monster',
    initiative: 10,
    sortOrder: 0,
    reveals: NONE,
    ...over
  };
}

function ssr(over: Partial<DisplayParticipant> & { id: string }): DisplayParticipant {
  return {
    name: 'Monster',
    kind: 'npc',
    initiative: 10,
    currentHp: null,
    maxHp: null,
    tempHp: 0,
    conditions: [],
    reveals: NONE,
    ...over
  };
}

describe('redactLiveParticipants', () => {
  // The reason this function exists: the poll redacts for the *viewer*, and
  // the viewer of a table-mode screen is usually the DM. Their snapshot
  // carries the hidden ambush with its real name — projecting it verbatim is
  // the action-log leak all over again.
  it('drops hidden non-PCs from a DM-shaped snapshot', () => {
    const out = redactLiveParticipants([
      live({ id: 'a', name: 'Goblin', initiative: 15, reveals: ALL }),
      live({ id: 'b', name: 'Assassin', initiative: 20, reveals: { ...NONE, hidden: true } })
    ]);
    expect(out.map((p) => p.id)).toEqual(['a']);
    expect(JSON.stringify(out)).not.toContain('Assassin');
  });

  it('keeps a hidden PC — the party is never redacted away', () => {
    const out = redactLiveParticipants([
      live({ id: 'p', kind: 'pc', name: 'Vortha', reveals: { ...ALL, hidden: true } })
    ]);
    expect(out.map((p) => p.name)).toEqual(['Vortha']);
  });

  it('renames identity-unrevealed non-PCs to Enemy N by visible position', () => {
    const out = redactLiveParticipants([
      live({ id: 'a', name: 'Ogre', initiative: 18 }),
      live({ id: 'p', kind: 'pc', name: 'Vortha', initiative: 16, reveals: ALL }),
      live({ id: 'b', name: 'Goblin', initiative: 14, reveals: ALL }),
      live({ id: 'c', name: 'Wolf', initiative: 12 })
    ]);
    expect(out.map((p) => p.name)).toEqual(['Enemy 1', 'Vortha', 'Goblin', 'Enemy 2']);
  });

  // The wire shape carries no dex score, so a naive re-sort would reshuffle
  // rows the server ordered by the dex tiebreaker.
  it('preserves server order for rows tied on initiative', () => {
    const out = redactLiveParticipants([
      live({ id: 'hi-dex', name: 'A', initiative: 12, reveals: ALL, sortOrder: 9 }),
      live({ id: 'lo-dex', name: 'B', initiative: 12, reveals: ALL, sortOrder: 1 })
    ]);
    expect(out.map((p) => p.id)).toEqual(['hi-dex', 'lo-dex']);
  });

  it('is idempotent over an already player-redacted list', () => {
    const once = redactLiveParticipants([
      live({ id: 'a', name: 'Ogre', initiative: 18 }),
      live({ id: 'b', name: 'Goblin', initiative: 14, reveals: ALL })
    ]);
    expect(redactLiveParticipants(once)).toEqual(once);
  });
});

describe('mergeDisplayParticipants', () => {
  it('falls back to the SSR rows before the first poll lands', () => {
    const rows = [ssr({ id: 'a', name: 'Goblin', currentHp: 3, maxHp: 7, reveals: ALL })];
    // `hpBucket` is normalized to null when neither side carries one — the
    // display prefers the server's band over bucketing the numbers itself.
    expect(mergeDisplayParticipants(rows, null)).toEqual(rows.map((r) => ({ ...r, hpBucket: null })));
  });

  // The band is what a viewer gets when the numbers are redacted, so it has
  // to survive the merge from either side.
  it('prefers the poll band, then the SSR one', () => {
    const rows = [ssr({ id: 'a', name: 'Enemy 1', currentHp: null, maxHp: null })];
    rows[0].hpBucket = 'bloodied';
    // No poll yet → the SSR band stands.
    expect(mergeDisplayParticipants(rows, null)[0].hpBucket).toBe('bloodied');
    // Poll lands with a fresher band → it wins.
    const merged = mergeDisplayParticipants(rows, [live({ id: 'a', name: 'Enemy 1' })], {
      a: { currentHp: null, tempHp: 0, hpBucket: 'critical', conditions: [] }
    });
    expect(merged[0].hpBucket).toBe('critical');
  });

  it('takes order, names and reveals from the poll and max HP from SSR', () => {
    const rows = [
      ssr({ id: 'a', name: 'Goblin', initiative: 5, currentHp: 7, maxHp: 7, reveals: ALL }),
      ssr({ id: 'b', name: 'Enemy 1', initiative: 4, currentHp: 30, maxHp: 59 })
    ];
    const out = mergeDisplayParticipants(
      rows,
      [
        live({ id: 'b', name: 'Ogre', initiative: 18 }),
        live({ id: 'a', name: 'Goblin', initiative: 15, reveals: ALL })
      ],
      {
        b: { currentHp: 12, tempHp: 0, maxHp: 59, conditions: ['prone'] },
        a: { currentHp: 4, tempHp: 2, maxHp: 7, conditions: [] }
      }
    );
    expect(out.map((p) => [p.id, p.name, p.initiative])).toEqual([
      ['b', 'Enemy 1', 18],
      ['a', 'Goblin', 15]
    ]);
    expect(out[0].currentHp).toBe(12);
    expect(out[0].maxHp).toBe(59);
    expect(out[0].conditions).toEqual(['prone']);
    expect(out[1].tempHp).toBe(2);
  });

  it('drops a hidden participant even when the SSR pass shipped one', () => {
    // Belt and braces: SSR runs the player branch so this shouldn't happen,
    // but the poll list is the authority on membership either way.
    const rows = [ssr({ id: 'a', name: 'Goblin', reveals: ALL }), ssr({ id: 'z', name: 'Assassin' })];
    const out = mergeDisplayParticipants(rows, [
      live({ id: 'a', name: 'Goblin', reveals: ALL }),
      live({ id: 'z', name: 'Assassin', reveals: { ...NONE, hidden: true } })
    ]);
    expect(out.map((p) => p.id)).toEqual(['a']);
  });

  it('renders a participant the poll knows about but SSR does not', () => {
    const out = mergeDisplayParticipants([], [live({ id: 'new', name: 'Enemy 1', initiative: 9 })]);
    expect(out).toEqual([
      {
        id: 'new',
        name: 'Enemy 1',
        kind: 'npc',
        initiative: 9,
        currentHp: null,
        maxHp: null,
        tempHp: 0,
        hpBucket: null,
        conditions: [],
        reveals: NONE
      }
    ]);
  });

  // PC HP lives on the character document; the poll can't cheaply derive max
  // HP, so it sends null and the SSR row has to win.
  it('keeps the SSR max HP when the poll omits it for a PC', () => {
    const out = mergeDisplayParticipants(
      [ssr({ id: 'p', kind: 'pc', name: 'Vortha', currentHp: 10, maxHp: 12, reveals: ALL })],
      [live({ id: 'p', kind: 'pc', name: 'Vortha', reveals: ALL })],
      { p: { currentHp: 6, tempHp: 0, maxHp: null, conditions: [] } }
    );
    expect(out[0]).toMatchObject({ currentHp: 6, maxHp: 12 });
  });
});

describe('showsExactHp', () => {
  it('shows numbers for PCs and vitals-revealed creatures, buckets otherwise', () => {
    expect(showsExactHp({ kind: 'pc', maxHp: 12, reveals: NONE })).toBe(true);
    expect(showsExactHp({ kind: 'npc', maxHp: 7, reveals: ALL })).toBe(true);
    expect(showsExactHp({ kind: 'npc', maxHp: 7, reveals: NONE })).toBe(false);
    expect(showsExactHp({ kind: 'npc', maxHp: 7, reveals: { ...NONE, identity: true } })).toBe(false);
    // No max HP to divide by — nothing to print.
    expect(showsExactHp({ kind: 'npc', maxHp: null, reveals: ALL })).toBe(false);
  });
});
