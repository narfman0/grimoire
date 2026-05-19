import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MonsterStatblockView from './MonsterStatblockView.svelte';
import type { MonsterDerived } from '$lib/rules/monster-derive';

// Minimal "AC only" statblock — the shape the encounter page ships to a
// player who has the `vitals` reveal flag on but `combat` off. If the view
// starts leaking actions/saves/etc from undefined fields, this test fails.
const acOnlyStatblock: MonsterDerived = {
  ac: 15,
  maxHp: null,
  speeds: {},
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  saves: {} as MonsterDerived['saves'],
  skills: {},
  senses: {},
  languages: [],
  proficiencyBonus: 2,
  traits: [],
  actions: [],
  legendaryActions: [],
  reactions: [],
  damageImmunities: [],
  damageResistances: [],
  damageVulnerabilities: [],
  conditionImmunities: []
};

const fullStatblock: MonsterDerived = {
  ...acOnlyStatblock,
  size: 'Medium',
  type: 'humanoid',
  cr: 1,
  xp: 200,
  maxHp: 22,
  hitDice: '4d8+4',
  speeds: { walk: 30 },
  actions: [
    {
      name: 'Scimitar',
      attackBonus: 4,
      reach: 5,
      damage: [{ dice: '1d6+2', type: 'slashing' }]
    }
  ],
  traits: [{ name: 'Nimble Escape', description: 'Disengage or hide as a bonus action.' }]
};

describe('MonsterStatblockView', () => {
  // Locks the contract that the view doesn't fabricate sections from
  // empty arrays. A future "fall back to placeholder" change here would
  // silently leak section headers to players in vitals-only redacted view.
  it('AC-only redacted view shows AC but no actions / traits sections', () => {
    const { queryByText } = render(MonsterStatblockView, {
      props: { statblock: acOnlyStatblock }
    });
    expect(queryByText(/AC/)).not.toBeNull();
    expect(queryByText('Actions')).toBeNull();
    expect(queryByText('Traits')).toBeNull();
    expect(queryByText('Reactions')).toBeNull();
    expect(queryByText('Legendary actions')).toBeNull();
  });

  it('full DM-shaped statblock renders actions and traits', () => {
    const { queryByText } = render(MonsterStatblockView, {
      props: { statblock: fullStatblock }
    });
    expect(queryByText('Actions')).not.toBeNull();
    expect(queryByText('Scimitar')).not.toBeNull();
    expect(queryByText('Traits')).not.toBeNull();
    expect(queryByText('Nimble Escape')).not.toBeNull();
  });

  // Locks the dense vs roomy text-size switch. Encounter rows use dense;
  // the content browse detail page uses the wider variant. Silently
  // flipping the default would shift layout everywhere.
  it('defaults to non-dense when the dense prop is omitted', () => {
    const { container } = render(MonsterStatblockView, {
      props: { statblock: acOnlyStatblock }
    });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('text-sm');
    expect(root.className).not.toContain('text-xs');
  });

  it('renders dense (text-xs) when dense=true', () => {
    const { container } = render(MonsterStatblockView, {
      props: { statblock: acOnlyStatblock, dense: true }
    });
    expect((container.firstElementChild as HTMLElement).className).toContain('text-xs');
  });
});
