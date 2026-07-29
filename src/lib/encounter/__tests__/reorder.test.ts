import { describe, it, expect } from 'vitest';
import { applyReorderPatches, reorderInitiative, type ReorderRow } from '../reorder';
import { initiativeCompare } from '$lib/realtime/participants';

type Row = ReorderRow & { dexScore: number };

const list: Row[] = [
  { id: 'a', initiative: 18, sortOrder: 0, dexScore: 10 },
  { id: 'b', initiative: 15, sortOrder: 0, dexScore: 16 },
  { id: 'c', initiative: 15, sortOrder: 0, dexScore: 8 },
  { id: 'd', initiative: 12, sortOrder: 0, dexScore: 14 }
];

/** The whole point of the patches: re-sorting the patched rows with the real
 *  comparator must reproduce the dropped order exactly. */
function orderAfterMove(rows: Row[], from: number, to: number): string[] {
  const patched = applyReorderPatches(rows, reorderInitiative(rows, from, to));
  return [...patched].sort(initiativeCompare).map((r) => r.id);
}

describe('reorderInitiative', () => {
  it('is a no-op for a drop in place or out of range', () => {
    expect(reorderInitiative(list, 1, 1)).toEqual([]);
    expect(reorderInitiative(list, -1, 2)).toEqual([]);
    expect(reorderInitiative(list, 0, 9)).toEqual([]);
  });

  it('gives the dragged row the initiative of its new upstairs neighbour', () => {
    const patches = reorderInitiative(list, 3, 1); // d up to second place
    const moved = patches.find((p) => p.id === 'd');
    expect(moved?.initiative).toBe(18); // now sits right under a (18)
    expect(moved?.sortOrder).toBe(1);
    // Nobody else's initiative moves.
    expect(patches.filter((p) => p.initiative !== undefined).map((p) => p.id)).toEqual(['d']);
  });

  it('adopts the row below when dropped at the top', () => {
    const patches = reorderInitiative(list, 3, 0);
    expect(patches.find((p) => p.id === 'd')?.initiative).toBe(18);
    expect(orderAfterMove(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('adopts the row above when dropped at the bottom', () => {
    const patches = reorderInitiative(list, 0, 3);
    expect(patches.find((p) => p.id === 'a')?.initiative).toBe(12);
    expect(orderAfterMove(list, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('reproduces the dropped order under the real comparator', () => {
    expect(orderAfterMove(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(orderAfterMove(list, 1, 3)).toEqual(['a', 'c', 'd', 'b']);
  });

  // sortOrder alone can't beat the initiative term, and dex would otherwise
  // re-sort within a tie — this is the case that fails without both writes.
  it('beats the dex tiebreak within an initiative tie', () => {
    // c (dex 8) loses to b (dex 16) by default; dragging it above b sticks.
    expect(orderAfterMove(list, 2, 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('assigns a dense sortOrder over the whole list', () => {
    const patched = applyReorderPatches(list, reorderInitiative(list, 3, 1));
    expect([...patched].sort(initiativeCompare).map((r) => r.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it('drags an unrolled row into the rolled band by giving it a real initiative', () => {
    const withUnrolled: Row[] = [
      ...list,
      { id: 'e', initiative: null, sortOrder: 0, dexScore: 10 }
    ];
    const patches = reorderInitiative(withUnrolled, 4, 1);
    expect(patches.find((p) => p.id === 'e')?.initiative).toBe(18);
    const patched = applyReorderPatches(withUnrolled, patches);
    expect([...patched].sort(initiativeCompare).map((r) => r.id)).toEqual([
      'a',
      'e',
      'b',
      'c',
      'd'
    ]);
  });

  it('drops a rolled row into the unrolled bucket when dragged below it', () => {
    const rows: Row[] = [
      { id: 'a', initiative: 18, sortOrder: 0, dexScore: 10 },
      { id: 'x', initiative: null, sortOrder: 1, dexScore: 10 },
      { id: 'y', initiative: null, sortOrder: 2, dexScore: 10 }
    ];
    const patches = reorderInitiative(rows, 0, 1); // a below x
    expect(patches.find((p) => p.id === 'a')?.initiative).toBeNull();
    const patched = applyReorderPatches(rows, patches);
    expect([...patched].sort(initiativeCompare).map((r) => r.id)).toEqual(['x', 'a', 'y']);
  });
});
