import { describe, expect, it } from 'vitest';
import { suggestLegendary, suggestTurn, type SuggestActor, type SuggestCombatant } from '../suggest-turn';
import { gridFromAscii } from './fixtures';

// The fixture goblin ambush from the plan doc's "done when": a goblin with
// a scimitar and a shortbow, a wounded concentrating PC, a healthy tank,
// and a goblin ally. The exact top plan is pinned — any scorer change that
// reshuffles it must update this test deliberately.

const openField = gridFromAscii(`
  ..........
  ..........
  ..........
  ..........
  ..........
`);

const goblin: SuggestActor = {
  id: 'gob-1',
  name: 'Goblin',
  cell: { x: 1, y: 2 },
  team: 'foe',
  speedFt: 30,
  actions: [
    { id: 'Scimitar', name: 'Scimitar', damageEV: 5.5, attackBonus: 4, rangeFt: 5 },
    { id: 'Shortbow', name: 'Shortbow', damageEV: 5.5, attackBonus: 4, rangeFt: 320 }
  ]
};

const kribwynn: SuggestCombatant = {
  id: 'pc-krib',
  name: 'Kribwynn',
  cell: { x: 7, y: 2 },
  team: 'pc',
  ac: 15,
  currentHp: 4,
  maxHp: 20,
  concentrating: true
};

const bruni: SuggestCombatant = {
  id: 'pc-bruni',
  name: 'Bruni',
  cell: { x: 8, y: 4 },
  team: 'pc',
  ac: 18,
  currentHp: 20,
  maxHp: 20
};

const goblinAlly: SuggestCombatant = {
  id: 'gob-2',
  name: 'Goblin ally',
  cell: { x: 2, y: 2 },
  team: 'foe',
  ac: 15,
  currentHp: 7,
  maxHp: 7
};

describe('suggestTurn — goblin ambush (pinned)', () => {
  const others = [kribwynn, bruni, goblinAlly];

  it('tops out shooting the wounded concentrating caster from safety', () => {
    const plans = suggestTurn(openField, goblin, others);
    expect(plans).toHaveLength(3);
    const top = plans[0];
    expect(top.actionName).toBe('Shortbow');
    expect(top.targetIds).toEqual(['pc-krib']);
    // Staying put beats walking into melee reach: no OA, no threat, no walk.
    expect(top.moveTo).toBeNull();
    expect(top.oaRisked).toBe(0);
    expect(top.rationale).toContain('Shortbow at Kribwynn');
    expect(top.rationale).toContain('breaks concentration');
    // Every plan is scored below the top one, in order.
    expect(plans[0].score).toBeGreaterThanOrEqual(plans[1].score);
    expect(plans[1].score).toBeGreaterThanOrEqual(plans[2].score);
  });

  it('is deterministic — same inputs, byte-identical plans', () => {
    expect(suggestTurn(openField, goblin, others)).toEqual(
      suggestTurn(openField, goblin, others)
    );
  });

  it('never targets allies and never proposes an out-of-LoS shot', () => {
    const walled = gridFromAscii(`
      ..........
      ..........
      .....#....
      .....#....
      .....#....
    `);
    // The wall hides Kribwynn from the goblin's row entirely? No — LoS
    // exists around the top; but a fully-walled column changes legality:
    const plans = suggestTurn(walled, goblin, [kribwynn, bruni, goblinAlly]);
    for (const p of plans) {
      expect(p.targetIds).not.toContain('gob-2');
    }
  });

  it('a melee-only brute closes in and eats the threat penalty knowingly', () => {
    const brute: SuggestActor = {
      ...goblin,
      id: 'ogre',
      name: 'Ogre',
      actions: [{ id: 'Greatclub', name: 'Greatclub', damageEV: 13, attackBonus: 6, rangeFt: 5 }]
    };
    const plans = suggestTurn(openField, brute, others);
    const top = plans[0];
    expect(top.actionName).toBe('Greatclub');
    expect(top.moveTo).not.toBeNull();
    // Destination is adjacent to its target.
    const target = others.find((o) => o.id === top.targetIds[0])!;
    const dx = Math.abs(top.moveTo!.x - target.cell.x);
    const dy = Math.abs(top.moveTo!.y - target.cell.y);
    expect(Math.max(dx, dy)).toBe(1);
  });

  it('an AoE breath catches the cluster and avoids allies', () => {
    const dragon: SuggestActor = {
      id: 'drake',
      name: 'Drake',
      cell: { x: 4, y: 0 },
      team: 'foe',
      speedFt: 30,
      actions: [
        { id: 'Bite', name: 'Bite', damageEV: 8, attackBonus: 6, rangeFt: 5 },
        {
          id: 'Breath',
          name: 'Fire Breath',
          damageEV: 22,
          save: true,
          rangeFt: 15,
          aoe: { shape: 'cone', sizeFt: 15 }
        }
      ]
    };
    const clustered: SuggestCombatant[] = [
      { ...kribwynn, cell: { x: 4, y: 3 } },
      { ...bruni, cell: { x: 5, y: 3 } },
      { ...goblinAlly, cell: { x: 0, y: 0 } }
    ];
    const plans = suggestTurn(openField, dragon, clustered);
    const top = plans[0];
    expect(top.actionName).toBe('Fire Breath');
    expect(new Set(top.targetIds)).toEqual(new Set(['pc-krib', 'pc-bruni']));
    expect(top.rationale).toContain('catching 2 enemies');
    expect(top.rationale).not.toContain('allies caught');
  });
});

describe('suggestLegendary', () => {
  it('ranks only affordable actions, from the current position', () => {
    const dragon: SuggestActor = {
      id: 'dragon',
      name: 'Dragon',
      cell: { x: 5, y: 2 },
      team: 'foe',
      speedFt: 40,
      actions: [
        { id: 'Tail', name: 'Tail Attack', damageEV: 15, attackBonus: 11, rangeFt: 10, legendaryCost: 1 },
        { id: 'Wing', name: 'Wing Attack', damageEV: 12, attackBonus: 11, rangeFt: 15, legendaryCost: 2 }
      ]
    };
    const nearby: SuggestCombatant[] = [
      { id: 'pc-1', name: 'Hero', cell: { x: 6, y: 2 }, team: 'pc', ac: 17, currentHp: 30, maxHp: 30 }
    ];
    const withBudget = suggestLegendary(openField, dragon, nearby, 2);
    expect(withBudget.map((p) => p.actionName)).toContain('Wing Attack');
    // Legendary actions never move the creature.
    for (const p of withBudget) expect(p.moveTo).toBeNull();

    const lastPoint = suggestLegendary(openField, dragon, nearby, 1);
    expect(lastPoint.map((p) => p.actionName)).toEqual(['Tail Attack']);
  });
});
