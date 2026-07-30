import { describe, it, expect } from 'vitest';
import { oaProvokers, planSuppressesOa, type ThreatenedBy } from '../opportunity';
import { gridFromAscii } from './fixtures';

const grid = gridFromAscii(`
  .........
  .........
  .........
`);

const goblin = (id: string, x: number, y: number, over: Partial<ThreatenedBy> = {}): ThreatenedBy => ({
  participantId: id,
  cell: { x, y },
  team: 'foe',
  ...over
});

/** A straight west→east walk along row 1. */
const walk = (fromX: number, toX: number) =>
  Array.from({ length: toX - fromX + 1 }, (_, i) => ({ x: fromX + i, y: 1 }));

describe('oaProvokers', () => {
  it('provokes when the path leaves a threatened cell', () => {
    // Goblin at (2,1); the mover starts adjacent at (1,1) and runs east.
    expect(oaProvokers(grid, walk(1, 6), 'pc', [goblin('g1', 2, 1)])).toEqual([
      { participantId: 'g1', fromCell: { x: 3, y: 1 } }
    ]);
  });

  it('does not provoke when the mover stays inside the reach', () => {
    // Circling a creature at melee range: (1,1) → (1,0), both adjacent.
    expect(
      oaProvokers(
        grid,
        [
          { x: 1, y: 1 },
          { x: 1, y: 0 }
        ],
        'pc',
        [goblin('g1', 2, 1)]
      )
    ).toEqual([]);
  });

  it('does not provoke on approach — entering reach is free', () => {
    // Running from far away up to the goblin and stopping.
    expect(oaProvokers(grid, walk(6, 3), 'pc', [goblin('g1', 2, 1)])).toEqual([]);
  });

  it('provokes once per creature even if the path re-enters their reach', () => {
    const zigzag = [
      { x: 1, y: 1 }, // in reach of (2,1)
      { x: 0, y: 1 }, // out — provokes
      { x: 1, y: 1 }, // back in
      { x: 0, y: 0 } // out again — no second attack, one reaction
    ];
    expect(oaProvokers(grid, zigzag, 'pc', [goblin('g1', 2, 1)])).toEqual([
      { participantId: 'g1', fromCell: { x: 1, y: 1 } }
    ]);
  });

  it('a corridor walk past two enemies provokes both, once each', () => {
    const provokers = oaProvokers(grid, walk(0, 8), 'pc', [
      goblin('g1', 2, 0),
      goblin('g2', 6, 2)
    ]);
    expect(provokers.map((p) => p.participantId)).toEqual(['g1', 'g2']);
  });

  it('ignores allies of the mover', () => {
    expect(
      oaProvokers(grid, walk(1, 6), 'pc', [goblin('ally', 2, 1, { team: 'pc' })])
    ).toEqual([]);
  });

  it('honors a longer reach', () => {
    // Reach 10 threatens two cells out, so leaving happens later.
    const [reachy] = oaProvokers(grid, walk(1, 8), 'pc', [
      goblin('g1', 2, 1, { reachFt: 10 })
    ]);
    expect(reachy.fromCell).toEqual({ x: 4, y: 1 });
  });

  it('honors a large creature footprint', () => {
    // A Huge creature anchored at (2,1) occupies 3×3, so its envelope
    // reaches further east than a Medium one's would.
    const [big] = oaProvokers(grid, walk(1, 8), 'pc', [
      goblin('g1', 2, 1, { sizeCells: 3 })
    ]);
    expect(big.fromCell).toEqual({ x: 5, y: 1 });
  });

  it('returns nothing for a path that never moves', () => {
    expect(oaProvokers(grid, [{ x: 1, y: 1 }], 'pc', [goblin('g1', 2, 1)])).toEqual([]);
    expect(oaProvokers(grid, [], 'pc', [goblin('g1', 2, 1)])).toEqual([]);
  });
});

describe('planSuppressesOa', () => {
  it('suppresses on Disengage in either slot, however it is spelled', () => {
    expect(planSuppressesOa({ actionLabel: 'Disengage' })).toBe(true);
    expect(planSuppressesOa({ actionId: 'action:disengage' })).toBe(true);
    expect(planSuppressesOa({ bonusActionLabel: 'Disengage (Cunning Action)' })).toBe(true);
    expect(planSuppressesOa({ bonusActionId: 'DISENGAGE' })).toBe(true);
  });

  it('does not suppress for other actions, or no plan at all', () => {
    expect(planSuppressesOa({ actionLabel: 'Dash', bonusActionLabel: 'Hide' })).toBe(false);
    expect(planSuppressesOa({})).toBe(false);
    expect(planSuppressesOa(null)).toBe(false);
    expect(planSuppressesOa(undefined)).toBe(false);
  });
});
