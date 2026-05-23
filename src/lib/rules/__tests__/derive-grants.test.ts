// End-to-end: a spell row with `activities[].grants.tempHp` flows
// through derive() onto Action.grants, with the formula evaluated
// against the caster's context. Combines with upcastScaling for the
// Armor of Agathys "5 temp HP, +5 per slot above 1" shape.

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

const FAKE_ARMOR_OF_AGATHYS: ContentRow = {
  kind: 'spell',
  slug: 'test-armor-of-agathys',
  version: 1,
  source: 'test',
  name: 'Test Armor of Agathys',
  data: {
    level: 1,
    school: 'abjuration',
    castingTime: 'action',
    range: { value: 0, units: 'self' },
    components: ['v', 's', 'm'],
    duration: '1 hour',
    activities: [
      {
        id: 'test-aoa-cast',
        type: 'utility',
        name: 'Cast Test Armor of Agathys',
        cost: 'action',
        grants: { tempHp: 5 },
        upcastScaling: { baseSlotLevel: 1, extraTempHpPerSlot: 5 }
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

describe('derive(): grants.tempHp flows through to Action.grants', () => {
  const lookup = lookupFor({ 'spell/test-armor-of-agathys': FAKE_ARMOR_OF_AGATHYS });

  it('plumbs Armor of Agathys grants.tempHp onto the derived Action', () => {
    const d = derive(withKnownSpell('test-armor-of-agathys'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-armor-of-agathys');
    expect(cast).toBeDefined();
    expect(cast!.grants?.tempHp).toBe(5);
  });

  it('applyUpcast at L3 grants 15 temp HP (5 base + 2 × 5)', () => {
    const d = derive(withKnownSpell('test-armor-of-agathys'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-armor-of-agathys')!;
    const upcast = applyUpcast(cast, 3);
    expect(upcast.grants?.tempHp).toBe(15);
  });

  it('evaluates formula tempHp against the caster context (Heroism shape: chaMod)', () => {
    // Synthetic Heroism — grants chaMod temp HP at the start of each turn.
    // Tortle Chronurgy fixture's CHA is 9, so chaMod = -1 → resolved
    // grants.tempHp = -1 (the engine evaluates the formula but doesn't
    // clamp; the runtime decides whether to apply). The point of this
    // test is just to lock the formula-evaluation contract.
    const heroismShape: ContentRow = {
      ...FAKE_ARMOR_OF_AGATHYS,
      slug: 'test-heroism',
      data: {
        ...(FAKE_ARMOR_OF_AGATHYS.data as Record<string, unknown>),
        activities: [
          {
            id: 'test-heroism-cast',
            type: 'utility',
            name: 'Cast Test Heroism',
            cost: 'action',
            grants: { tempHp: 'chaMod' }
          }
        ]
      }
    };
    const lookupH = lookupFor({ 'spell/test-heroism': heroismShape });
    const d = derive(withKnownSpell('test-heroism'), lookupH);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-heroism')!;
    // chronurgy fixture's chaMod = -1 (CHA 9 base, no buffs)
    expect(cast.grants?.tempHp).toBe(-1);
  });

  it('omits grants on Action when the activity has no grants block', () => {
    const noGrants: ContentRow = {
      ...FAKE_ARMOR_OF_AGATHYS,
      slug: 'test-no-grants',
      data: {
        ...(FAKE_ARMOR_OF_AGATHYS.data as Record<string, unknown>),
        activities: [
          {
            id: 'test-no-grants-cast',
            type: 'utility',
            name: 'Cast',
            cost: 'action'
          }
        ]
      }
    };
    const lookupN = lookupFor({ 'spell/test-no-grants': noGrants });
    const d = derive(withKnownSpell('test-no-grants'), lookupN);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-no-grants')!;
    expect(cast.grants).toBeUndefined();
  });
});
