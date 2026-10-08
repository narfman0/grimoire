// A `damage.bonus` effect that carries `damageType` belongs to the damage
// row of that type, not the weapon's primary row. Divine Fury is the
// motivating case: 1d6 + half barbarian level, all radiant (or necrotic).
// Before this, the flat half was folded into the weapon's slashing/piercing
// row, so resistance to the weapon's type wrongly ate it.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import type { ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;
beforeAll(() => {
  PACKS = loadAllPacks();
});

function divineFury(effects: Array<Record<string, unknown>>): ContentRow {
  return {
    kind: 'feature',
    slug: 'divine-fury',
    version: 1,
    name: 'Divine Fury',
    source: 'test',
    data: {
      ownerKind: 'subclass',
      ownerSlug: 'path-of-the-zealot',
      minLevel: 3,
      modifiers: [
        {
          kind: 'action-modifier',
          id: 'divine-fury-bonus',
          name: 'Divine Fury',
          appliesWhen: { condition: 'rage' },
          appliesTo: { activityType: 'attack', predicates: [{ 'attack.range': 'melee' }] },
          effects
        }
      ]
    }
  };
}

function greatswordWith(row: ContentRow, withoutRow = false) {
  const base = zealot.makeLookup(PACKS);
  const lookup = (ref: { kind: string; slug: string }) =>
    ref.kind === 'feature' && ref.slug === 'divine-fury' ? (withoutRow ? undefined : row) : base(ref);
  const d = derive(zealot.CHARACTER, lookup as never);
  return d.actions.find((a) => a.sourceContent.slug === 'greatsword')!;
}

describe('damage.bonus with damageType', () => {
  it('lands on the matching typed row, leaving the weapon row untouched', () => {
    const row = divineFury([
      { target: 'damage.dice', value: '1d6', damageType: 'radiant' },
      { target: 'damage.bonus', mode: 'ADD', value: 'floor(barbarianLevel/2)', damageType: 'radiant' }
    ]);
    const without = greatswordWith(row, true);
    const sword = greatswordWith(row);
    const slashing = sword.damageRolls!.filter((r) => r.type === 'slashing');
    expect(slashing).toEqual(without.damageRolls!.filter((r) => r.type === 'slashing'));
    // Vorm is barbarian 3 → floor(3/2) = 1.
    expect(sword.damageRolls!.find((r) => r.type === 'radiant')).toEqual({ formula: '1d6+1', type: 'radiant' });
  });

  it('appends a flat row when no row of that type exists yet', () => {
    const row = divineFury([{ target: 'damage.bonus', mode: 'ADD', value: 2, damageType: 'necrotic' }]);
    const sword = greatswordWith(row);
    expect(sword.damageRolls!.find((r) => r.type === 'necrotic')).toEqual({ formula: '2', type: 'necrotic' });
  });

  it('untyped damage.bonus still bumps the primary row', () => {
    const row = divineFury([{ target: 'damage.bonus', mode: 'ADD', value: 1 }]);
    const without = greatswordWith(row, true);
    const sword = greatswordWith(row);
    expect(sword.damageRolls![0].formula).not.toBe(without.damageRolls![0].formula);
    expect(sword.damageRolls!.length).toBe(without.damageRolls!.length);
  });
});
