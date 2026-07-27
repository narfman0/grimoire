// grantSummary — one-line renderings of the canonical structured
// trigger-grant shapes, shared by the sheet trigger list and the
// encounter reaction prompts.

import { describe, it, expect } from 'vitest';
import { grantSummary } from '../grant-summary';

describe('grantSummary', () => {
  it('renders the on-hit rider shapes', () => {
    expect(
      grantSummary({
        type: 'damage.rider',
        amount: '2d6',
        damageType: 'fire',
        save: { ability: 'dex', dc: 15, half: true }
      })
    ).toBe('+2d6 fire on hit (DEX DC 15 half)');
    expect(
      grantSummary({
        type: 'condition.rider',
        condition: 'poisoned',
        save: { ability: 'con', dc: 15 },
        duration: { value: 1, units: 'minute' }
      })
    ).toBe('target poisoned on hit (CON DC 15 negates), 1 minute');
    expect(grantSummary({ type: 'hp.max-reduce', amount: '3d6' })).toBe(
      "target's HP maximum reduced by 3d6"
    );
  });

  it('renders the d20 / save / reroll / contingency / absorb contracts', () => {
    expect(grantSummary({ type: 'd20.replace', value: 10 })).toBe(
      'use 10 in place of the d20 roll'
    );
    expect(grantSummary({ type: 'save.convert-fail-to-success' })).toBe(
      'the failed save becomes a success'
    );
    expect(grantSummary({ type: 'reroll.grant', die: 'd20' })).toBe(
      'reroll: roll an extra d20 and choose which to use'
    );
    expect(grantSummary({ type: 'reroll.grant' })).toBe('reroll the triggering d20');
    expect(grantSummary({ type: 'contingency.revive', hp: 1 })).toBe(
      'instead of dying, return with 1 HP'
    );
    expect(grantSummary({ type: 'spell.absorb', maxLevels: 50 })).toBe(
      'absorb the triggering spell (up to 50 total levels)'
    );
  });

  it('returns null for runtime-contract grant types and absent grants', () => {
    expect(grantSummary(undefined)).toBeNull();
    expect(grantSummary({ type: 'force-reroll' })).toBeNull();
    expect(grantSummary({ type: 'bonus-action-weapon-attack' })).toBeNull();
  });
});
