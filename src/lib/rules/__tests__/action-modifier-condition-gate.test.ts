// Action-modifier with appliesWhen.condition — the engine primitive
// behind weapon-rider buff spells (Magic Weapon, Holy Weapon, Elemental
// Weapon, Bardic Inspiration recipients, etc.). Player toggles a
// spell-effect condition slug on cast and off on duration end; the
// rider's modifiers only fire while the condition is live.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

// Synthetic Magic Weapon — gates +1 attack + +1 damage on all weapon
// attacks behind the `magic-weapon-active` condition.
const FAKE_MAGIC_WEAPON: ContentRow = {
  kind: 'spell',
  slug: 'test-magic-weapon',
  version: 1,
  source: 'test',
  name: 'Test Magic Weapon',
  data: {
    level: 2,
    school: 'transmutation',
    castingTime: 'bonus',
    range: { value: 0, units: 'self' },
    duration: '1 hour',
    concentration: true,
    activities: [
      {
        id: 'test-magic-weapon-cast',
        type: 'utility',
        name: 'Cast Test Magic Weapon',
        cost: 'bonus'
      }
    ],
    modifiers: [
      {
        kind: 'action-modifier',
        id: 'magic-weapon-attack-bonus',
        name: 'Magic Weapon (+1 attack, weapon attacks)',
        appliesWhen: { condition: 'magic-weapon-active' },
        appliesTo: {
          activityType: 'attack',
          predicates: [{ 'attack.classification': 'weapon' }]
        },
        effects: [{ target: 'attack.roll', mode: 'ADD', value: 1 }]
      },
      {
        kind: 'action-modifier',
        id: 'magic-weapon-damage-bonus',
        name: 'Magic Weapon (+1 damage, weapon attacks)',
        appliesWhen: { condition: 'magic-weapon-active' },
        appliesTo: {
          activityType: 'attack',
          predicates: [{ 'attack.classification': 'weapon' }]
        },
        effects: [{ target: 'damage.bonus', mode: 'ADD', value: 1 }]
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

function withSpellAndCondition(slug: string, conditions: string[] = []): CharacterDocument {
  return {
    ...chronurgy.CHARACTER,
    spells: {
      known: [...chronurgy.CHARACTER.spells.known, { kind: 'spell', slug, version: 1 }],
      prepared: [...chronurgy.CHARACTER.spells.prepared, slug]
    },
    conditions
  };
}

describe('action-modifier appliesWhen.condition gate — Magic Weapon shape', () => {
  it('does not apply +1 attack/damage when magic-weapon-active condition is absent', () => {
    const lookup = lookupFor({ 'spell/test-magic-weapon': FAKE_MAGIC_WEAPON });
    const d = derive(withSpellAndCondition('test-magic-weapon', []), lookup);
    // chronurgy fixture's quarterstaff attack baseline
    const staff = d.actions.find((a) => a.sourceContent.slug === 'quarterstaff');
    expect(staff).toBeDefined();
    // No magic-weapon entries in appliedModifiers
    const ids = staff!.appliedModifiers.map((m) => m.modifierId);
    expect(ids.find((id) => id.includes('magic-weapon'))).toBeUndefined();
  });

  it('applies +1 attack and +1 damage when the condition is present', () => {
    const lookup = lookupFor({ 'spell/test-magic-weapon': FAKE_MAGIC_WEAPON });
    const baseline = derive(withSpellAndCondition('test-magic-weapon', []), lookup);
    const buffed = derive(
      withSpellAndCondition('test-magic-weapon', ['magic-weapon-active']),
      lookup
    );
    const baseStaff = baseline.actions.find((a) => a.sourceContent.slug === 'quarterstaff')!;
    const buffStaff = buffed.actions.find((a) => a.sourceContent.slug === 'quarterstaff')!;
    expect(buffStaff.attackBonus).toBe(baseStaff.attackBonus! + 1);
    // damage first-roll bumped by +1 — check via tail flat-modifier delta
    const tail = (f: string) => {
      const m = f.match(/([+-]\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    };
    expect(tail(buffStaff.damageRolls![0].formula)).toBe(tail(baseStaff.damageRolls![0].formula) + 1);
  });

  it('records magic-weapon modifiers in the appliedModifiers audit trail when active', () => {
    const lookup = lookupFor({ 'spell/test-magic-weapon': FAKE_MAGIC_WEAPON });
    const d = derive(
      withSpellAndCondition('test-magic-weapon', ['magic-weapon-active']),
      lookup
    );
    const staff = d.actions.find((a) => a.sourceContent.slug === 'quarterstaff')!;
    const ids = staff.appliedModifiers.map((m) => m.modifierId);
    expect(ids).toContain('magic-weapon-attack-bonus');
    expect(ids).toContain('magic-weapon-damage-bonus');
  });

  it('only fires on weapon attacks — spell attacks are unaffected', () => {
    const lookup = lookupFor({ 'spell/test-magic-weapon': FAKE_MAGIC_WEAPON });
    const baseline = derive(withSpellAndCondition('test-magic-weapon', []), lookup);
    const buffed = derive(
      withSpellAndCondition('test-magic-weapon', ['magic-weapon-active']),
      lookup
    );
    const baseBolt = baseline.actions.find(
      (a) => a.sourceContent.slug === 'fire-bolt' && a.attackBonus != null
    );
    const buffBolt = buffed.actions.find(
      (a) => a.sourceContent.slug === 'fire-bolt' && a.attackBonus != null
    );
    // Spell attack bonus must NOT bump
    expect(buffBolt!.attackBonus).toBe(baseBolt!.attackBonus);
  });
});
