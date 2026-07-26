import { describe, it, expect } from 'vitest';
import {
  buildLiveParticipantList,
  initiativeCompare,
  makePlaceholderNamer,
  type LiteParticipantRow
} from '../participants';
import { NPC_DEFAULT_REVEALS, PC_DEFAULT_REVEALS, type ParticipantReveals } from '../reveals';

function row(over: Partial<LiteParticipantRow> & { id: string }): LiteParticipantRow {
  return {
    kind: 'npc',
    characterId: null,
    name: over.id,
    initiative: null,
    dexScore: 10,
    sortOrder: 0,
    reveals: over.kind === 'pc' ? PC_DEFAULT_REVEALS : NPC_DEFAULT_REVEALS,
    ...over
  };
}

describe('initiativeCompare', () => {
  it('orders by initiative desc, dex desc, sortOrder asc; null initiative last', () => {
    const rows = [
      row({ id: 'late', initiative: null, sortOrder: 0 }),
      row({ id: 'low-dex-tie', initiative: 15, dexScore: 8, sortOrder: 1 }),
      row({ id: 'high', initiative: 20 }),
      row({ id: 'first-inserted-tie', initiative: 15, dexScore: 14, sortOrder: 0 }),
      row({ id: 'same-dex-tie', initiative: 15, dexScore: 14, sortOrder: 2 })
    ];
    const ordered = [...rows].sort(initiativeCompare).map((r) => r.id);
    expect(ordered).toEqual(['high', 'first-inserted-tie', 'same-dex-tie', 'low-dex-tie', 'late']);
  });
});

describe('makePlaceholderNamer', () => {
  it('numbers only unrevealed non-PCs, in call order', () => {
    const name = makePlaceholderNamer();
    const identity: ParticipantReveals = { ...NPC_DEFAULT_REVEALS, identity: true };
    expect(name({ kind: 'npc', name: 'Goblin', reveals: NPC_DEFAULT_REVEALS })).toBe('Enemy 1');
    expect(name({ kind: 'pc', name: 'Kribwynn', reveals: PC_DEFAULT_REVEALS })).toBe('Kribwynn');
    expect(name({ kind: 'npc', name: 'Bugbear', reveals: identity })).toBe('Bugbear');
    expect(name({ kind: 'npc', name: 'Wolf', reveals: NPC_DEFAULT_REVEALS })).toBe('Enemy 2');
  });
});

describe('buildLiveParticipantList', () => {
  const hidden: ParticipantReveals = { ...NPC_DEFAULT_REVEALS, hidden: true };
  const identity: ParticipantReveals = { ...NPC_DEFAULT_REVEALS, identity: true };
  const rows: LiteParticipantRow[] = [
    row({ id: 'g1', name: 'Goblin 1', initiative: 18 }),
    row({ id: 'pc1', name: 'Kribwynn', kind: 'pc', characterId: 'char-1', initiative: 15 }),
    row({ id: 'lurker', name: 'Shadow Lurker', initiative: 12, reveals: hidden }),
    row({ id: 'g2', name: 'Goblin 2', initiative: 9 }),
    row({ id: 'boss', name: 'Bugbear Chief', initiative: 5, reveals: identity })
  ];

  it('DM sees every row, real names, initiative order', () => {
    const list = buildLiveParticipantList(rows, true);
    expect(list.map((r) => r.id)).toEqual(['g1', 'pc1', 'lurker', 'g2', 'boss']);
    expect(list.map((r) => r.name)).toEqual([
      'Goblin 1',
      'Kribwynn',
      'Shadow Lurker',
      'Goblin 2',
      'Bugbear Chief'
    ]);
    for (const r of list) expect(r.placeholderName).toBe(r.name);
  });

  it('players lose hidden rows and unrevealed names become Enemy N by visible position', () => {
    const list = buildLiveParticipantList(rows, false);
    expect(list.map((r) => r.id)).toEqual(['g1', 'pc1', 'g2', 'boss']);
    expect(list.map((r) => r.name)).toEqual(['Enemy 1', 'Kribwynn', 'Enemy 2', 'Bugbear Chief']);
  });

  it('Enemy numbering stays stable when an earlier row gains identity', () => {
    const revealed = rows.map((r) => (r.id === 'g1' ? { ...r, reveals: identity } : r));
    const list = buildLiveParticipantList(revealed, false);
    // g1 shows its real name; g2 keeps *a* number — by visible position it
    // becomes Enemy 1 (the numbering is positional among still-unrevealed
    // rows, matching the SSR loader's contract).
    expect(list.map((r) => r.name)).toEqual(['Goblin 1', 'Kribwynn', 'Enemy 1', 'Bugbear Chief']);
  });

  it('does not mutate the input row order', () => {
    const before = rows.map((r) => r.id);
    buildLiveParticipantList(rows, false);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});
