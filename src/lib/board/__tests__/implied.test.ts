import { describe, it, expect } from 'vitest';
import { impliedSetup, stripImpliedMovement } from '../implied';
import { suggestTurn, type SuggestActor, type SuggestCombatant } from '../suggest-turn';
import { distanceFt } from '../geometry';

const side = (n: number, team: string, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, team }));

describe('impliedSetup', () => {
  it('faces the two sides 15 ft apart with the actor on its own flank', () => {
    const { grid, cells } = impliedSetup('goblin', 'foe', [
      { id: 'goblin', team: 'foe' },
      ...side(2, 'foe', 'g'),
      ...side(2, 'pc', 'pc')
    ]);
    const actor = cells.get('goblin')!;
    const firstEnemy = cells.get('pc0')!;
    expect(distanceFt(grid, actor, firstEnemy)).toBe(15);
    // Allies cluster one column over from the actor.
    expect(cells.get('g0')!.x).toBe(1);
    expect(cells.get('g1')!.x).toBe(1);
  });

  it('is deterministic regardless of input order', () => {
    const a = impliedSetup('m', 'foe', [
      { id: 'm', team: 'foe' },
      { id: 'b', team: 'pc' },
      { id: 'a', team: 'pc' }
    ]);
    const b = impliedSetup('m', 'foe', [
      { id: 'a', team: 'pc' },
      { id: 'm', team: 'foe' },
      { id: 'b', team: 'pc' }
    ]);
    expect([...a.cells.entries()]).toEqual([...b.cells.entries()]);
  });

  it('grows the grid to fit a big side and keeps everyone on it', () => {
    const { grid, cells } = impliedSetup('m', 'foe', [...side(9, 'pc', 'pc'), ...side(4, 'foe', 'g')]);
    for (const c of cells.values()) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThan(grid.w);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThan(grid.h);
    }
    // Nobody shares a cell.
    const keys = [...cells.values()].map((c) => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The whole point of the redesign: the retired 30 ft strip made melee
  // unreachable, so mapless melee monsters got no suggestions at all.
  it('lets a melee actor reach and rank enemy targets', () => {
    const { grid, cells } = impliedSetup('ogre', 'foe', [
      { id: 'ogre', team: 'foe' },
      { id: 'pc0', team: 'pc' },
      { id: 'pc1', team: 'pc' }
    ]);
    const actor: SuggestActor = {
      id: 'ogre',
      name: 'Ogre',
      cell: cells.get('ogre')!,
      team: 'foe',
      speedFt: 30,
      actions: [{ id: 'Greatclub', name: 'Greatclub', damageEV: 13, attackBonus: 6, rangeFt: 5 }]
    };
    const others: SuggestCombatant[] = ['pc0', 'pc1'].map((id) => ({
      id,
      name: id,
      cell: cells.get(id)!,
      team: 'pc',
      ac: 15,
      currentHp: 20,
      maxHp: 20
    }));
    const ranked = suggestTurn(grid, actor, others);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].actionName).toBe('Greatclub');
    expect(ranked[0].targetIds).toHaveLength(1);
  });

  it('lets an AoE catch the enemy cluster without free-hitting the allies', () => {
    const { grid, cells } = impliedSetup('mage', 'foe', [
      { id: 'mage', team: 'foe' },
      { id: 'g0', team: 'foe' },
      ...side(3, 'pc', 'pc')
    ]);
    const actor: SuggestActor = {
      id: 'mage',
      name: 'Mage',
      cell: cells.get('mage')!,
      team: 'foe',
      speedFt: 30,
      actions: [
        {
          id: 'Fireball',
          name: 'Fireball',
          damageEV: 28,
          save: true,
          rangeFt: 150,
          aoe: { shape: 'sphere', sizeFt: 10 }
        }
      ]
    };
    const others: SuggestCombatant[] = [...cells.keys()]
      .filter((id) => id !== 'mage')
      .map((id) => ({
        id,
        name: id,
        cell: cells.get(id)!,
        team: id.startsWith('pc') ? 'pc' : 'foe',
        ac: 14,
        currentHp: 15,
        maxHp: 15
      }));
    const [top] = suggestTurn(grid, actor, others);
    // The packed enemy column means the template catches more than one…
    expect(top.targetIds.length).toBeGreaterThan(1);
    // …and every one caught is an enemy.
    expect(top.targetIds.every((id) => id.startsWith('pc'))).toBe(true);
  });
});

describe('stripImpliedMovement', () => {
  it('drops the fabricated movement and its rationale prefix', () => {
    const stripped = stripImpliedMovement({
      score: 12,
      moveTo: { x: 2, y: 3 },
      path: [{ x: 0, y: 3 }, { x: 2, y: 3 }],
      oaRisked: 1,
      rationale: 'move to (2, 3); Greatclub at Vortha; 1 OA risked'
    });
    expect(stripped.moveTo).toBeNull();
    expect(stripped.path).toBeNull();
    expect(stripped.oaRisked).toBe(0);
    expect(stripped.rationale).toBe('Greatclub at Vortha');
  });

  it('handles the stay-put and no-OA shapes too', () => {
    expect(
      stripImpliedMovement({
        score: 1,
        moveTo: null,
        path: null,
        oaRisked: 0,
        rationale: 'stay at (0, 3); Fireball catching 3 enemies'
      }).rationale
    ).toBe('Fireball catching 3 enemies');
  });
});
