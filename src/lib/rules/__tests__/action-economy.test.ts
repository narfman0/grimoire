// Size, melee reach, and the action-economy declaration channels —
// action-cost.<slug>, action-economy.extra-reaction /.extra-turn, and an
// activity's replacesAttacks.

import { describe, expect, it } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentRow } from '../types';

const HUMAN: ContentRow = {
  kind: 'species',
  slug: 'test-human',
  version: 1,
  name: 'Human',
  source: 'test',
  data: { size: 'medium', speed: { walk: 30 } }
};

const HALFLING: ContentRow = {
  kind: 'species',
  slug: 'test-halfling',
  version: 1,
  name: 'Halfling',
  source: 'test',
  data: { size: 'small', speed: { walk: 25 } }
};

function char(featSlugs: string[], species = HUMAN.slug): CharacterDocument {
  return {
    id: 'action-economy-test',
    name: 'Economist',
    classes: [{ slug: 'fighter', level: 11, hpRolledPerLevel: Array(11).fill(6) }],
    species: { kind: 'species', slug: species },
    feats: featSlugs.map((slug) => ({ kind: 'feat', slug })),
    abilityScores: { str: 18, dex: 12, con: 16, int: 10, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 90,
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

describe('creature size', () => {
  it('comes from the species row and defaults to medium', () => {
    expect(derive(char([]), lookupFor([HUMAN])).stats.size).toBe('medium');
    expect(derive(char([], HALFLING.slug), lookupFor([HALFLING])).stats.size).toBe('small');
    // Unknown species → medium fallback, no throw.
    expect(derive(char([], 'missing'), lookupFor([])).stats.size).toBe('medium');
  });

  it('UPGRADE takes the larger, never shrinks (Runic Juggernaut → Huge)', () => {
    const juggernaut = featRow('test-runic-juggernaut', {
      modifiers: [{ kind: 'stat-modifier', target: 'size', mode: 'UPGRADE', value: 'huge' }]
    });
    const shrink = featRow('test-shrink-attempt', {
      modifiers: [{ kind: 'stat-modifier', target: 'size', mode: 'UPGRADE', value: 'small' }]
    });
    const d = derive(char([juggernaut.slug, shrink.slug]), lookupFor([HUMAN, juggernaut, shrink]));
    expect(d.stats.size).toBe('huge');
  });

  it('OVERRIDE writes and an unknown size string is ignored', () => {
    const over = featRow('test-size-override', {
      modifiers: [
        { kind: 'stat-modifier', target: 'size', mode: 'OVERRIDE', value: 'tiny' },
        { kind: 'stat-modifier', target: 'size', mode: 'OVERRIDE', value: 'colossal' }
      ]
    });
    expect(derive(char([over.slug]), lookupFor([HUMAN, over])).stats.size).toBe('tiny');
  });
});

describe('melee reach', () => {
  it('defaults to 5 ft and adds via reach.melee', () => {
    expect(derive(char([]), lookupFor([HUMAN])).stats.meleeReachFt).toBe(5);
    const battering = featRow('test-battering-roots', {
      modifiers: [{ kind: 'stat-modifier', target: 'reach.melee', mode: 'ADD', value: 10 }]
    });
    expect(
      derive(char([battering.slug]), lookupFor([HUMAN, battering])).stats.meleeReachFt
    ).toBe(15);
  });

  it('stacks two sources', () => {
    const a = featRow('test-reach-a', {
      modifiers: [{ kind: 'stat-modifier', target: 'reach.melee', mode: 'ADD', value: 10 }]
    });
    const b = featRow('test-reach-b', {
      modifiers: [{ kind: 'stat-modifier', target: 'reach.melee', mode: 'ADD', value: 5 }]
    });
    expect(derive(char([a.slug, b.slug]), lookupFor([HUMAN, a, b])).stats.meleeReachFt).toBe(20);
  });
});

describe('action-cost overrides', () => {
  it('records the generic action slug and its new cost', () => {
    const feat = featRow('test-natures-mantle', {
      modifiers: [
        { kind: 'stat-modifier', target: 'action-cost.hide', value: 'bonus' },
        { kind: 'stat-modifier', target: 'action-cost.study', value: 'bonus' },
        { kind: 'stat-modifier', target: 'action-cost.nonsense', value: 'turn' }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([HUMAN, feat]));
    expect(d.stats.actionCostOverrides).toEqual({ hide: 'bonus', study: 'bonus' });
  });

  it('is empty by default and honors appliesWhen (Eagle: Dash as a BA while raging)', () => {
    expect(derive(char([]), lookupFor([HUMAN])).stats.actionCostOverrides).toEqual({});
    const eagle = featRow('test-eagle', {
      modifiers: [
        {
          kind: 'stat-modifier',
          target: 'action-cost.dash',
          value: 'bonus',
          appliesWhen: { condition: 'raging' }
        }
      ]
    });
    const lookup = lookupFor([HUMAN, eagle]);
    expect(derive(char([eagle.slug]), lookup).stats.actionCostOverrides).toEqual({});
    const raging = char([eagle.slug]);
    raging.conditions = ['raging'];
    expect(derive(raging, lookup).stats.actionCostOverrides).toEqual({ dash: 'bonus' });
  });
});

describe('extra reactions and extra turns', () => {
  it('sums extra reactions (Vigilant Defender)', () => {
    expect(derive(char([]), lookupFor([HUMAN])).stats.extraReactionsPerRound).toBe(0);
    const feat = featRow('test-vigilant-defender', {
      modifiers: [
        { kind: 'stat-modifier', target: 'action-economy.extra-reaction', value: true },
        { kind: 'stat-modifier', target: 'action-economy.extra-reaction', value: 2 }
      ]
    });
    expect(
      derive(char([feat.slug]), lookupFor([HUMAN, feat])).stats.extraReactionsPerRound
    ).toBe(3);
  });

  it("declares an extra turn with its round and initiative offset (Thief's Reflexes)", () => {
    const feat = featRow('test-thiefs-reflexes', {
      modifiers: [
        {
          kind: 'stat-modifier',
          name: "Thief's Reflexes",
          target: 'action-economy.extra-turn',
          value: { round: 1, initiativeOffset: -10 }
        }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([HUMAN, feat]));
    expect(d.stats.extraTurns).toEqual([
      {
        sourceContent: { kind: 'feat', slug: 'test-thiefs-reflexes' },
        name: "Thief's Reflexes",
        round: 1,
        initiativeOffset: -10
      }
    ]);
  });

  it('accepts an extra turn with no round / offset (Strength Before Death)', () => {
    const feat = featRow('test-strength-before-death', {
      modifiers: [
        { kind: 'stat-modifier', target: 'action-economy.extra-turn', value: true }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([HUMAN, feat]));
    expect(d.stats.extraTurns).toHaveLength(1);
    expect(d.stats.extraTurns[0].round).toBeUndefined();
    expect(d.stats.extraTurns[0].name).toBe('test-strength-before-death');
  });
});

describe('attack substitution', () => {
  it('surfaces replacesAttacks on the Action (War Magic)', () => {
    const feat = featRow('test-war-magic', {
      activities: [
        {
          id: 'war-magic',
          name: 'War Magic',
          type: 'utility',
          cost: 'free',
          replacesAttacks: 1
        },
        { id: 'plain', name: 'Plain', type: 'utility', cost: 'action' }
      ]
    });
    const d = derive(char([feat.slug]), lookupFor([HUMAN, feat]));
    expect(d.actions.find((a) => a.name === 'War Magic')!.replacesAttacks).toBe(1);
    expect(d.actions.find((a) => a.name === 'Plain')!.replacesAttacks).toBeUndefined();
    expect(d.validations.filter((v) => v.code.startsWith('unknown-'))).toEqual([]);
  });
});
