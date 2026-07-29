import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
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
      } as Record<
        string,
        {
          bonus: number;
          ability?: string;
          proficient: boolean;
          expertise: boolean;
          advantage?: boolean;
          disadvantage?: boolean;
          bonusDice?: string[];
          d20Floor?: number;
          autoFail?: boolean;
        }
      >,
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

// ---- dice-roller phase 3 ----
//
// The four SkillCell flags rendered as chips long before anything could roll
// them. These assert the chips are now buttons that actually apply the flag.

describe('rolling', () => {
  it('rolls a skill check with advantage from the cell', async () => {
    const derived = makeDerived();
    derived.stats.skills.stealth = {
      bonus: 7,
      ability: 'dex',
      proficient: true,
      expertise: false,
      advantage: true,
      disadvantage: false
    };
    const { getByTitle, container } = render(Sheet, { derived });

    await fireEvent.click(getByTitle('Roll Stealth'));

    const total = Number(container.querySelector('[data-testid="roll-total"]')!.textContent);
    // Advantage keeps the better of two d20s, +7.
    expect(total).toBeGreaterThanOrEqual(8);
    expect(total).toBeLessThanOrEqual(27);
    expect(container.textContent).toContain('adv');
  });

  it("applies a skill's d20 floor so a low die can't drop the total", async () => {
    const derived = makeDerived();
    derived.stats.skills.arcana = {
      bonus: 0,
      ability: 'int',
      proficient: true,
      expertise: false,
      advantage: false,
      disadvantage: false,
      d20Floor: 10
    };
    const { getByTitle, container } = render(Sheet, { derived });

    // Reliable Talent: nothing below 10 can ever come out of this row.
    for (let i = 0; i < 40; i++) {
      await fireEvent.click(getByTitle('Roll Arcana'));
      const total = Number(container.querySelector('[data-testid="roll-total"]')!.textContent);
      expect(total).toBeGreaterThanOrEqual(10);
    }
  });

  it('rolls a saving throw', async () => {
    const { getByTitle, container } = render(Sheet, { derived: makeDerived() });
    await fireEvent.click(getByTitle('Roll a STR saving throw'));
    const total = Number(container.querySelector('[data-testid="roll-total"]')!.textContent);
    expect(total).toBeGreaterThanOrEqual(6); // +5 save
    expect(total).toBeLessThanOrEqual(25);
  });

  it('rolls a raw ability check', async () => {
    const { getByTitle, container } = render(Sheet, { derived: makeDerived() });
    await fireEvent.click(getByTitle('Roll a raw DEX check'));
    const total = Number(container.querySelector('[data-testid="roll-total"]')!.textContent);
    expect(total).toBeGreaterThanOrEqual(2); // +1 mod
    expect(total).toBeLessThanOrEqual(21);
  });

  it('marks an auto-fail skill rather than rolling it at disadvantage', () => {
    const derived = makeDerived();
    derived.stats.skills.investigation = {
      bonus: 3,
      ability: 'int',
      proficient: false,
      expertise: false,
      advantage: false,
      disadvantage: false,
      autoFail: true
    };
    const { container } = render(Sheet, { derived });
    expect(container.textContent).toContain('auto-fail');
    expect(container.textContent).not.toContain('dis');
  });
});
