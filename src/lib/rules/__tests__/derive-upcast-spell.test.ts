// End-to-end: a spell row with `activities[].upcastScaling` flows
// through derive() onto Action.upcastScaling, and applyUpcast against
// the derived action produces the right scaled damage.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { applyUpcast } from '../upcast';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

// Synthetic Fireball — pinned at L3, scales +1d6/slot.
const FAKE_FIREBALL: ContentRow = {
  kind: 'spell',
  slug: 'test-fireball',
  version: 1,
  source: 'test',
  name: 'Test Fireball',
  data: {
    level: 3,
    school: 'evocation',
    castingTime: 'action',
    range: { value: 150, units: 'ft' },
    components: ['v', 's', 'm'],
    duration: 'instantaneous',
    activities: [
      {
        id: 'test-fireball-cast',
        type: 'save',
        name: 'Cast Test Fireball',
        cost: 'action',
        save: { ability: 'dex', dc: { calc: 'spell' } },
        damage: { parts: [{ dice: '8d6', type: 'fire' }] },
        upcastScaling: {
          baseSlotLevel: 3,
          extraDamagePerSlot: '1d6'
        }
      }
    ]
  }
};

function lookupFor(extras: Record<string, ContentRow>) {
  return (ref: { kind: string; slug: string; version?: number }) => {
    const extra = extras[`${ref.kind}/${ref.slug}`];
    if (extra) return extra;
    return chronurgy.makeLookup(PACKS)(ref);
  };
}

function withKnownSpell(slug: string): CharacterDocument {
  return {
    ...chronurgy.CHARACTER,
    spells: {
      known: [...chronurgy.CHARACTER.spells.known, { kind: 'spell', slug, version: 1 }],
      prepared: [...chronurgy.CHARACTER.spells.prepared, slug]
    }
  };
}

describe('derive(): upcastScaling flows through from spell row to Action', () => {
  it("plumbs Fireball's upcastScaling onto the derived Action", () => {
    const lookup = lookupFor({ 'spell/test-fireball': FAKE_FIREBALL });
    const d = derive(withKnownSpell('test-fireball'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-fireball');
    expect(cast).toBeDefined();
    expect(cast!.upcastScaling).toEqual({
      baseSlotLevel: 3,
      extraDamagePerSlot: '1d6'
    });
  });

  it("base damage is unchanged (8d6) at slot L3", () => {
    const lookup = lookupFor({ 'spell/test-fireball': FAKE_FIREBALL });
    const d = derive(withKnownSpell('test-fireball'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-fireball')!;
    const upcast = applyUpcast(cast, 3);
    expect(upcast.damageRolls?.[0].formula).toBe('8d6');
  });

  it("applyUpcast at L5 scales damage to 10d6", () => {
    const lookup = lookupFor({ 'spell/test-fireball': FAKE_FIREBALL });
    const d = derive(withKnownSpell('test-fireball'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-fireball')!;
    const upcast = applyUpcast(cast, 5);
    expect(upcast.damageRolls?.[0].formula).toBe('10d6');
  });

  it("defaults baseSlotLevel to the spell row's `level` when the upcastScaling spec omits it", () => {
    const noExplicitBase: ContentRow = {
      ...FAKE_FIREBALL,
      slug: 'test-fireball-implicit',
      data: {
        ...(FAKE_FIREBALL.data as Record<string, unknown>),
        activities: [
          {
            ...((FAKE_FIREBALL.data as { activities: Array<Record<string, unknown>> }).activities[0]),
            upcastScaling: {
              // baseSlotLevel omitted — should default to spell.level (3)
              extraDamagePerSlot: '1d6'
            }
          }
        ]
      }
    };
    const lookup = lookupFor({ 'spell/test-fireball-implicit': noExplicitBase });
    const d = derive(withKnownSpell('test-fireball-implicit'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-fireball-implicit')!;
    expect(cast.upcastScaling).toEqual({
      baseSlotLevel: 3,
      extraDamagePerSlot: '1d6'
    });
  });

  it("omits upcastScaling on Action when the spell row doesn't declare it (cantrips / fixed-effect spells)", () => {
    const noScaling: ContentRow = {
      ...FAKE_FIREBALL,
      slug: 'test-fixed-spell',
      data: {
        ...(FAKE_FIREBALL.data as Record<string, unknown>),
        activities: [
          {
            ...((FAKE_FIREBALL.data as { activities: Array<Record<string, unknown>> }).activities[0])
            // upcastScaling stripped
          }
        ]
      }
    };
    delete ((noScaling.data as { activities: Array<Record<string, unknown>> }).activities[0] as Record<string, unknown>).upcastScaling;
    const lookup = lookupFor({ 'spell/test-fixed-spell': noScaling });
    const d = derive(withKnownSpell('test-fixed-spell'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-fixed-spell')!;
    expect(cast.upcastScaling).toBeUndefined();
  });
});
