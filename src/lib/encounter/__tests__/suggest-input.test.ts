import { describe, expect, it } from 'vitest';
import {
  actionAoe,
  diceEV,
  isMultiattack,
  matchAoeAction,
  multiattackStrikes,
  suggestActionsFrom,
  suggestLegendaryActionsFrom
} from '../suggest-input';
import type { MonsterAction } from '$lib/rules/monster-derive';

describe('diceEV', () => {
  it('averages dice expressions', () => {
    expect(diceEV('2d6+4')).toBe(11);
    expect(diceEV('1d8')).toBe(4.5);
    expect(diceEV('2d6 + 1d4')).toBe(9.5);
    expect(diceEV('7')).toBe(7);
    expect(diceEV('gibberish')).toBe(0);
  });
});

const scimitar: MonsterAction = {
  name: 'Scimitar',
  attackBonus: 4,
  reach: 5,
  damage: [{ dice: '1d6+2', type: 'slashing' }]
};
const shortbow: MonsterAction = {
  name: 'Shortbow',
  attackBonus: 4,
  range: '80/320 ft.',
  damage: [{ dice: '1d6+2', type: 'piercing' }]
};

describe('suggestActionsFrom', () => {
  it('digests attacks with reach and max range', () => {
    const out = suggestActionsFrom([scimitar, shortbow]);
    expect(out).toEqual([
      { id: 'Scimitar', name: 'Scimitar', damageEV: 5.5, attackBonus: 4, rangeFt: 5 },
      { id: 'Shortbow', name: 'Shortbow', damageEV: 4 + 1.5, attackBonus: 4, rangeFt: 320 }
    ]);
  });

  it('expands multiattack from referenced attacks', () => {
    const claw: MonsterAction = {
      name: 'Claw',
      attackBonus: 7,
      reach: 5,
      damage: [{ dice: '2d6+4', type: 'slashing' }]
    };
    const bite: MonsterAction = {
      name: 'Bite',
      attackBonus: 7,
      reach: 10,
      damage: [{ dice: '2d10+4', type: 'piercing' }]
    };
    const multi: MonsterAction = {
      name: 'Multiattack',
      description: 'The dragon makes two claw attacks and one bite attack.'
    };
    const out = suggestActionsFrom([multi, claw, bite]);
    const ma = out.find((a) => a.name === 'Multiattack')!;
    expect(ma.damageEV).toBe(11 * 2 + 15); // 2×claw + bite
    expect(ma.attackBonus).toBe(7);
    expect(ma.rangeFt).toBe(5); // must be in reach of every referenced attack
  });

  it('falls back to N× best attack for unreferenced multiattack', () => {
    const multi: MonsterAction = {
      name: 'Multiattack',
      description: 'The veteran makes two attacks.'
    };
    const out = suggestActionsFrom([multi, scimitar]);
    const ma = out.find((a) => a.name === 'Multiattack')!;
    expect(ma.damageEV).toBe(11);
  });

  it('detects AoE templates and marks save-based actions', () => {
    const breath: MonsterAction = {
      name: 'Fire Breath (Recharge 5–6)',
      description:
        'The dragon exhales fire in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save.',
      damage: [{ dice: '7d6', type: 'fire' }]
    };
    const out = suggestActionsFrom([breath]);
    expect(out[0]).toMatchObject({
      save: true,
      aoe: { shape: 'cone', sizeFt: 15 },
      rangeFt: 15,
      damageEV: 24.5
    });
    expect(suggestActionsFrom([breath], { excludeRecharge: true })).toEqual([]);
  });

  it('tags legendary costs', () => {
    const out = suggestLegendaryActionsFrom([
      { name: 'Tail Attack', attackBonus: 11, reach: 15, damage: [{ dice: '2d8+6', type: 'bludgeoning' }] },
      {
        name: 'Wing Attack (Costs 2 Actions)',
        cost: 2,
        damage: [{ dice: '2d6+6', type: 'bludgeoning' }]
      }
    ]);
    expect(out.map((a) => a.legendaryCost)).toEqual([1, 2]);
  });
});

describe('multiattackStrikes', () => {
  const claw: MonsterAction = {
    name: 'Claw',
    attackBonus: 7,
    reach: 5,
    damage: [{ dice: '2d6+4', type: 'slashing' }]
  };
  const bite: MonsterAction = {
    name: 'Bite',
    attackBonus: 7,
    reach: 10,
    damage: [{ dice: '2d10+4', type: 'piercing' }]
  };

  it('decomposes named references into counted strikes', () => {
    const multi: MonsterAction = {
      name: 'Multiattack',
      description: 'The dragon makes two claw attacks and one bite attack.'
    };
    expect(multiattackStrikes(multi, [multi, claw, bite])).toEqual([
      { action: claw, count: 2 },
      { action: bite, count: 1 }
    ]);
  });

  it('falls back to N× the best attack when nothing is referenced', () => {
    const multi: MonsterAction = {
      name: 'Multiattack',
      description: 'The veteran makes two attacks.'
    };
    // Bite has the higher EV, so it is the one repeated.
    expect(multiattackStrikes(multi, [multi, claw, bite])).toEqual([{ action: bite, count: 2 }]);
  });

  it('matches a reference against a suffixed action name', () => {
    const gore: MonsterAction = {
      name: 'Gore (Recharge 5–6)',
      attackBonus: 6,
      damage: [{ dice: '2d8', type: 'piercing' }]
    };
    const multi: MonsterAction = {
      name: 'Multiattack',
      description: 'It makes one gore attack and one claw attack.'
    };
    expect(multiattackStrikes(multi, [multi, gore, claw])).toEqual([
      { action: gore, count: 1 },
      { action: claw, count: 1 }
    ]);
  });

  it('returns nothing when the prose is unparseable or there is nothing to strike with', () => {
    const vague: MonsterAction = { name: 'Multiattack', description: 'It attacks a lot.' };
    expect(multiattackStrikes(vague, [vague, claw])).toEqual([]);
    const noDesc: MonsterAction = { name: 'Multiattack' };
    expect(multiattackStrikes(noDesc, [noDesc, claw])).toEqual([]);
    const multi: MonsterAction = { name: 'Multiattack', description: 'makes two attacks' };
    expect(multiattackStrikes(multi, [multi])).toEqual([]);
  });

  it('agrees with the optimizer EV built on top of it', () => {
    const multi: MonsterAction = {
      name: 'Multiattack',
      description: 'The dragon makes two claw attacks and one bite attack.'
    };
    const strikes = multiattackStrikes(multi, [multi, claw, bite]);
    const evFromStrikes = strikes.reduce(
      (sum, s) => sum + s.count * (s.action.damage ?? []).reduce((n, d) => n + diceEV(d.dice), 0),
      0
    );
    const ma = suggestActionsFrom([multi, claw, bite]).find((a) => a.name === 'Multiattack')!;
    expect(ma.damageEV).toBe(evFromStrikes);
  });
});

describe('isMultiattack', () => {
  it('matches the name however it is cased or suffixed', () => {
    expect(isMultiattack({ name: 'Multiattack' })).toBe(true);
    expect(isMultiattack({ name: 'multiattack (special)' })).toBe(true);
    expect(isMultiattack({ name: 'Claw' })).toBe(false);
  });
});

describe('actionAoe / matchAoeAction', () => {
  const breath = {
    name: 'Fire Breath',
    description:
      'The dragon exhales fire in a 15-foot cone. Each creature must make a DC 13 Dexterity saving throw.'
  };
  const burst = { name: 'Shatter', description: 'A 10-foot-radius sphere of thunder.' };
  const bite = { name: 'Bite', description: 'Melee Weapon Attack: +6 to hit.' };

  it('parses cone / radius-as-sphere shapes out of the prose', () => {
    expect(actionAoe(breath)).toEqual({ shape: 'cone', sizeFt: 15 });
    expect(actionAoe(burst)).toEqual({ shape: 'sphere', sizeFt: 10 });
    expect(actionAoe(bite)).toBeNull();
    expect(actionAoe({})).toBeNull();
  });

  it('matches a locked template back to the action that describes it', () => {
    const actions = [bite, breath, burst];
    expect(matchAoeAction(actions, 'cone', 15)).toBe(breath);
    expect(matchAoeAction(actions, 'sphere', 10)).toBe(burst);
    // Same shape, wrong size — or a shape nobody has — matches nothing, so
    // the handoff falls back to the bare geometry label.
    expect(matchAoeAction(actions, 'cone', 30)).toBeUndefined();
    expect(matchAoeAction(actions, 'line', 30)).toBeUndefined();
  });
});
