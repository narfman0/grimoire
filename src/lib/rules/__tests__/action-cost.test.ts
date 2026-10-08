import { describe, it, expect } from 'vitest';
import { costLabel, normalizeCost, slotForCost } from '../action-cost';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import type { ContentRow } from '../types';

describe('costLabel', () => {
  it('maps the four core string costs to their display labels', () => {
    expect(costLabel('action')).toBe('Action');
    expect(costLabel('bonus')).toBe('Bonus');
    expect(costLabel('reaction')).toBe('Reaction');
    expect(costLabel('free')).toBe('Free');
  });

  it('renders movement cost as "{N} ft move"', () => {
    expect(costLabel({ movement: 30 })).toBe('30 ft move');
  });

  it('renders limited-use cost as "{N}/{per}"', () => {
    expect(costLabel({ uses: 3, per: 'long-rest' })).toBe('3/long-rest');
  });

  it('falls back to String() for unknown shapes', () => {
    expect(costLabel(null)).toBe('');
    expect(costLabel(undefined)).toBe('');
    expect(costLabel(42)).toBe('42');
    expect(costLabel('something-custom')).toBe('something-custom');
  });
});

describe('slotForCost', () => {
  it('maps the three economy slots', () => {
    expect(slotForCost('action')).toBe('action');
    expect(slotForCost('bonus')).toBe('bonus');
    expect(slotForCost('reaction')).toBe('reaction');
  });

  it('returns null for free / movement / limited-use / unknown', () => {
    // Locks: 'free' must not consume a numbered slot — the action-economy
    // picker uses this to decide whether to grey out spent slots.
    expect(slotForCost('free')).toBeNull();
    expect(slotForCost({ movement: 30 })).toBeNull();
    expect(slotForCost({ uses: 1, per: 'long-rest' })).toBeNull();
    expect(slotForCost(undefined)).toBeNull();
  });
});

describe('hit-dice costs', () => {
  it('renders "N Hit Dice" (singular Die at 1)', () => {
    expect(costLabel({ hitDice: 2 })).toBe('2 Hit Dice');
    expect(costLabel({ hitDice: 1 })).toBe('1 Hit Die');
  });

  it('maps to no action-economy slot (display-only cost)', () => {
    expect(slotForCost({ hitDice: 2 })).toBe(null);
  });
});

describe('"bonus-action" cost spelling', () => {
  // Regression: 86 grimoire-packs rows (Zealous Presence among them) spell
  // the cost "bonus-action". The encounter planner keys on slotForCost, so
  // those actions silently never appeared in the bonus-action picker.
  it('normalizeCost maps bonus-action spellings to bonus', () => {
    expect(normalizeCost('bonus-action')).toBe('bonus');
    expect(normalizeCost('Bonus Action')).toBe('bonus');
    expect(normalizeCost('bonus_action')).toBe('bonus');
    expect(normalizeCost('reaction')).toBe('reaction');
    expect(normalizeCost({ movement: 5 })).toEqual({ movement: 5 });
    expect(normalizeCost(undefined)).toBeUndefined();
  });

  it('derive emits the canonical bonus cost so the planner slots it', () => {
    const feat: ContentRow = {
      kind: 'feat',
      slug: 'test-battle-cry',
      version: 1,
      name: 'Test Battle Cry',
      source: 'test',
      data: {
        activities: [{ id: 'cry', type: 'utility', name: 'Battle Cry', cost: 'bonus-action' }],
        activations: [{ id: 'cry-buff', name: 'Battle Cry Buff', condition: 'battle-cry', cost: 'bonus-action', uses: { max: 1, per: 'long-rest' } }]
      }
    };
    const base = zealot.makeLookup(loadAllPacks());
    const lookup = (ref: { kind: string; slug: string }) =>
      ref.kind === 'feat' && ref.slug === 'test-battle-cry' ? feat : base(ref);
    const d = derive(
      { ...zealot.CHARACTER, feats: [{ kind: 'feat', slug: 'test-battle-cry', version: 1 }] },
      lookup as never
    );
    const action = d.actions.find((a) => a.name === 'Battle Cry')!;
    expect(action.cost).toBe('bonus');
    expect(slotForCost(action.cost)).toBe('bonus');
    const activation = d.availableActivations.find((a) => a.id === 'cry-buff')!;
    expect(activation.cost).toBe('bonus');
  });
});
