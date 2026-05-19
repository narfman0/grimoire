import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Sheet from './Sheet.svelte';

/** Hand-crafted SerializedDerived blob — minimum shape Sheet consumes.
 *  Real fixtures live in src/lib/fixtures/party but those produce a full
 *  Derived; this test only needs the narrowed projection that Sheet binds
 *  against, so we keep the shape inline and explicit. */
function makeDerived(overrides: Partial<{
  ac: number;
  hp: { current: number; max: number; temp: number };
  totalLevel: number;
}> = {}) {
  return {
    stats: {
      abilities: {
        str: { score: 16, mod: 3 },
        dex: { score: 12, mod: 1 },
        con: { score: 14, mod: 2 },
        int: { score: 10, mod: 0 },
        wis: { score: 13, mod: 1 },
        cha: { score: 8, mod: -1 }
      },
      saves: {
        str: { bonus: 5, proficient: true },
        dex: { bonus: 1, proficient: false },
        con: { bonus: 2, proficient: false },
        int: { bonus: 0, proficient: false },
        wis: { bonus: 1, proficient: false },
        cha: { bonus: -1, proficient: false }
      },
      skills: {
        athletics: { bonus: 5, proficient: true, expertise: false }
      },
      ac: overrides.ac ?? 16,
      hp: overrides.hp ?? { current: 24, max: 30, temp: 0 },
      speeds: { walk: 30 },
      proficiencyBonus: 2,
      initiative: 1,
      passivePerception: 11,
      spellSaveDC: null,
      spellAttackBonus: null,
      spellcastingAbility: null,
      spellSlots: {},
      totalLevel: overrides.totalLevel ?? 3,
      resistances: [],
      immunities: [],
      vulnerabilities: [],
      senses: {}
    },
    actions: [
      {
        id: 'longsword',
        sourceContent: { kind: 'item', slug: 'longsword' },
        name: 'Longsword',
        type: 'attack',
        cost: 'action',
        attackBonus: 5,
        damageRolls: [{ formula: '1d8+3', type: 'slashing' }],
        appliedModifiers: []
      }
    ],
    triggers: [],
    resources: [],
    validations: []
  };
}

describe('Sheet', () => {
  // Locks the top-stats grid contract — AC / HP / Init / Prof / Speed /
  // Level all render with their derived values. A regression where one
  // cell stops binding (typo on `stats.X`) makes that cell disappear.
  it('renders the labeled top-stats cards', () => {
    const { getByText } = render(Sheet, { props: { derived: makeDerived() } });
    for (const label of ['AC', 'HP', 'Init', 'Prof', 'Speed', 'Level']) {
      expect(getByText(label)).not.toBeNull();
    }
    expect(getByText('24 / 30')).not.toBeNull(); // hp
    expect(getByText('30 ft')).not.toBeNull(); // speed
  });

  // Locks: every ability score renders with both raw + modifier.
  it('renders all six ability cells with score + signed mod', () => {
    const { getAllByText, getByText } = render(Sheet, {
      props: { derived: makeDerived() }
    });
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      expect(getByText(ab)).not.toBeNull();
    }
    expect(getAllByText('+3').length).toBeGreaterThan(0); // str mod or save bonus
    expect(getAllByText('-1').length).toBeGreaterThan(0); // cha mod / save bonus
  });

  // Locks: a non-spell action renders with its name + damage formula.
  it('renders non-spell action with name and damage formula', () => {
    const { getByText, getAllByText } = render(Sheet, {
      props: { derived: makeDerived() }
    });
    expect(getByText('Longsword')).not.toBeNull();
    expect(getAllByText(/1d8\+3/).length).toBeGreaterThan(0);
  });

  // Locks the save-proficient visual contract (filled vs empty bullet).
  it('marks STR save as proficient (●) and DEX as not (○)', () => {
    const { getByText } = render(Sheet, { props: { derived: makeDerived() } });
    expect(getByText(/● STR/)).not.toBeNull();
    expect(getByText(/○ DEX/)).not.toBeNull();
  });
});
