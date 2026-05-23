// Pin the SRD pack-author shape (`damage.scalesWithSlotLevel` /
// activity-level `scalesWithSlotLevel`) → Action.upcastScaling
// translation in derive(). Locks the bridge between the convention
// the SRD already uses and the runtime upcast helper.

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

// Mirror of content-packs/srd-5.2/spells/3rd-level.json::fireball.
// scalesWithSlotLevel lives on the damage block.
const SRD_FIREBALL_SHAPE: ContentRow = {
  kind: 'spell',
  slug: 'test-srd-fireball',
  version: 1,
  source: 'test',
  name: 'SRD-shape Fireball',
  data: {
    level: 3,
    school: 'evocation',
    castingTime: 'action',
    activities: [
      {
        id: 'test-srd-fireball-cast',
        type: 'save',
        name: 'Cast',
        cost: 'action',
        save: { ability: 'dex', dc: { calc: 'spell' } },
        damage: {
          parts: [{ dice: '8d6', type: 'fire', halfOnSave: true }],
          scalesWithSlotLevel: { perSlotAbove: 3, addDice: '1d6' }
        },
        target: { affects: 'area', shape: 'sphere', radius: 20 }
      }
    ]
  }
};

// Mirror of content-packs/srd-5.2/spells/1st-level.json::magic-missile.
// scalesWithSlotLevel lives at the activity scope, uses addDarts.
const SRD_MAGIC_MISSILE_SHAPE: ContentRow = {
  kind: 'spell',
  slug: 'test-srd-magic-missile',
  version: 1,
  source: 'test',
  name: 'SRD-shape Magic Missile',
  data: {
    level: 1,
    school: 'evocation',
    castingTime: 'action',
    activities: [
      {
        id: 'test-srd-mm-cast',
        type: 'utility',
        name: 'Cast',
        cost: 'action',
        damage: { parts: [{ dice: '1d4+1', type: 'force', perDart: 3 }] },
        scalesWithSlotLevel: { perSlotAbove: 1, addDarts: 1 },
        target: { affects: 'creature', count: 3, perDart: true }
      }
    ]
  }
};

// Mirror of content-packs/srd-5.2/spells/1st-level.json::cure-wounds.
// scalesWithSlotLevel at activity scope with addDice + activity has heal.
const SRD_CURE_WOUNDS_SHAPE: ContentRow = {
  kind: 'spell',
  slug: 'test-srd-cure-wounds',
  version: 1,
  source: 'test',
  name: 'SRD-shape Cure Wounds',
  data: {
    level: 1,
    school: 'abjuration',
    castingTime: 'action',
    activities: [
      {
        id: 'test-srd-cw-cast',
        type: 'heal',
        name: 'Cast',
        cost: 'action',
        heal: { amount: '2d8 + spellMod' },
        damage: { parts: [{ dice: '2d8', type: 'healing' }] },
        scalesWithSlotLevel: { perSlotAbove: 1, addDice: '2d8' },
        target: { affects: 'creature', count: 1 }
      }
    ]
  }
};

describe('SRD pack shape: damage.scalesWithSlotLevel → upcastScaling', () => {
  it('Fireball: perSlotAbove 3, addDice 1d6 → baseSlotLevel 3, extraDamagePerSlot 1d6', () => {
    const lookup = lookupFor({ 'spell/test-srd-fireball': SRD_FIREBALL_SHAPE });
    const d = derive(withKnownSpell('test-srd-fireball'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-srd-fireball')!;
    expect(cast.upcastScaling).toEqual({
      baseSlotLevel: 3,
      extraDamagePerSlot: '1d6'
    });
    const l5 = applyUpcast(cast, 5);
    expect(l5.damageRolls?.[0].formula).toBe('10d6');
  });
});

describe('SRD pack shape: activity-level scalesWithSlotLevel addDarts', () => {
  it('Magic Missile: perSlotAbove 1, addDarts 1 → extraTargetsPerSlot 1', () => {
    const lookup = lookupFor({ 'spell/test-srd-magic-missile': SRD_MAGIC_MISSILE_SHAPE });
    const d = derive(withKnownSpell('test-srd-magic-missile'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-srd-magic-missile')!;
    expect(cast.upcastScaling).toEqual({
      baseSlotLevel: 1,
      extraTargetsPerSlot: 1
    });
  });
});

describe('SRD pack shape: activity-level scalesWithSlotLevel addDice + heal', () => {
  it('Cure Wounds: perSlotAbove 1, addDice 2d8 with heal field → extraHealPerSlot 2d8', () => {
    const lookup = lookupFor({ 'spell/test-srd-cure-wounds': SRD_CURE_WOUNDS_SHAPE });
    const d = derive(withKnownSpell('test-srd-cure-wounds'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-srd-cure-wounds')!;
    expect(cast.upcastScaling).toEqual({
      baseSlotLevel: 1,
      extraHealPerSlot: '2d8'
    });
  });
});
