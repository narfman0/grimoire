// Dice maximization / doubling — the family beside damageDieMin,
// damageRerollAndKeepHigher and critExtraDie. Overchannel / Supreme
// Healing / sword of sharpness / Death Strike / periapt of wound closure.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentRow } from '../types';

function char(featSlugs: string[]): CharacterDocument {
  return {
    id: 'dice-max-test',
    name: 'Maximizer',
    classes: [{ slug: 'wizard', level: 5, hpRolledPerLevel: [6, 4, 4, 4, 4] }],
    species: { kind: 'species', slug: 'gnome' },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 10, dex: 12, con: 12, int: 18, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 22,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

function featRow(slug: string, data: Record<string, unknown>): ContentRow {
  return { kind: 'feat', slug, version: 1, name: slug, source: 'test', data };
}

function lookupFor(rows: ContentRow[]) {
  const map = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) => map.get(`${ref.kind}/${ref.slug}`);
}

/** A feat carrying one damage activity plus one action-modifier that
 *  targets it. */
function featWithActionModifier(
  slug: string,
  target: string,
  appliesTo?: Record<string, unknown>
): ContentRow {
  return featRow(slug, {
    activities: [
      {
        id: 'zap',
        name: 'Zap',
        type: 'damage',
        cost: 'action',
        damage: { parts: [{ dice: '4d6', type: 'fire' }] }
      }
    ],
    modifiers: [
      {
        kind: 'action-modifier',
        id: `${slug}-mod`,
        name: slug,
        ...(appliesTo ? { appliesTo } : {}),
        effects: [{ target, value: true }]
      }
    ]
  });
}

describe('damage / heal maximization action-modifier targets', () => {
  it('defaults every flag off', () => {
    const feat = featWithActionModifier('test-noop', 'damage.bonus');
    const action = derive(char([feat.slug]), lookupFor([feat])).actions.find((a) => a.name === 'Zap')!;
    expect(action.damageMaximized).toBeUndefined();
    expect(action.damageMaximizedVsObjects).toBeUndefined();
    expect(action.damageDiceDoubled).toBeUndefined();
    expect(action.damageDiceDoubledVsObjects).toBeUndefined();
    expect(action.healMaximized).toBeUndefined();
  });

  it.each([
    ['damage.maximize', 'damageMaximized'],
    ['damage.maximize.vs-objects', 'damageMaximizedVsObjects'],
    ['damage.double-dice', 'damageDiceDoubled'],
    ['damage.double-dice.vs-objects', 'damageDiceDoubledVsObjects'],
    ['heal.maximize', 'healMaximized']
  ] as const)('%s sets Action.%s', (target, field) => {
    const feat = featWithActionModifier(`test-${target.replace(/\./g, '-')}`, target);
    const d = derive(char([feat.slug]), lookupFor([feat]));
    const action = d.actions.find((a) => a.name === 'Zap')!;
    expect(action[field]).toBe(true);
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
  });

  it('honors damage-type predicates so a type-scoped maximizer stays scoped', () => {
    // Consuming Fervor: maximize a fire OR thunder damage roll.
    const scoped = featWithActionModifier('test-consuming-fervor', 'damage.maximize', {
      predicates: [{ 'damage.type': ['fire', 'thunder'] }]
    });
    const missed = featWithActionModifier('test-cold-only', 'damage.maximize', {
      predicates: [{ 'damage.type': 'cold' }]
    });
    const hit = derive(char([scoped.slug]), lookupFor([scoped])).actions.find(
      (a) => a.name === 'Zap'
    )!;
    const miss = derive(char([missed.slug]), lookupFor([missed])).actions.find(
      (a) => a.name === 'Zap'
    )!;
    expect(hit.damageMaximized).toBe(true);
    expect(miss.damageMaximized).toBeUndefined();
  });
});

describe('hit-die maximization', () => {
  it('defaults false; hitDice.maximize sets stats.hitDiceMaximized', () => {
    expect(derive(char([]), lookupFor([])).stats.hitDiceMaximized).toBe(false);
    const feat = featRow('test-periapt', {
      modifiers: [{ kind: 'stat-modifier', target: 'hitDice.maximize', value: true }]
    });
    expect(derive(char([feat.slug]), lookupFor([feat])).stats.hitDiceMaximized).toBe(true);
  });
});

describe('trigger grants', () => {
  it('passes damage.maximize / damage.double through onto the declaration', () => {
    const feat = featRow('test-death-strike', {
      triggers: [
        {
          kind: 'trigger',
          id: 'death-strike',
          name: 'Death Strike',
          on: ['attack.hit'],
          grants: { type: 'damage.double', save: { ability: 'con', dc: 17 } }
        },
        {
          kind: 'trigger',
          id: 'consuming-fervor',
          name: 'Consuming Fervor',
          on: ['attack.hit'],
          grants: { type: 'damage.maximize' }
        }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([feat]));
    expect(d.triggers.find((t) => t.name === 'Death Strike')?.grants).toEqual({
      type: 'damage.double',
      save: { ability: 'con', dc: 17 }
    });
    expect(d.triggers.find((t) => t.name === 'Consuming Fervor')?.grants).toEqual({
      type: 'damage.maximize'
    });
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
  });
});
