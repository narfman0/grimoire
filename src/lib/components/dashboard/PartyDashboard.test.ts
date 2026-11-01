import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import PartyDashboard from './PartyDashboard.svelte';
import type { PartyDashboard as Dashboard } from '$lib/dashboard/types';

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function sample(): Dashboard {
  return {
    campaign: { name: 'Night Market' },
    party: [
      {
        id: ID(1),
        name: 'Aria',
        portrait: null,
        classLine: 'Wizard 5',
        level: 5,
        hasSheet: true,
        currentHp: 12,
        maxHp: 27,
        tempHp: 4,
        ac: 13,
        conditions: ['prone'],
        concentrating: 'Haste',
        deathSaves: null,
        spellSlots: [
          { level: 1, max: 4, used: 1 },
          { level: 3, max: 2, used: 2 }
        ],
        resources: [{ id: 'arcane-recovery', name: 'Arcane Recovery', current: 1, max: 1 }],
        inventory: [{ name: 'Quarterstaff', equipped: true, attuned: false, charges: null }]
      },
      {
        id: ID(2),
        name: 'Stub',
        portrait: null,
        classLine: '',
        level: 0,
        hasSheet: false,
        currentHp: null,
        maxHp: null,
        tempHp: 0,
        ac: null,
        conditions: [],
        concentrating: null,
        deathSaves: null,
        spellSlots: [],
        resources: [],
        inventory: []
      }
    ],
    encounter: {
      id: ID(3),
      name: 'Ambush',
      status: 'live',
      round: 3,
      activeParticipantId: ID(5),
      combatants: [
        {
          id: ID(4),
          name: 'Aria',
          kind: 'pc',
          characterId: ID(1),
          initiative: 18,
          currentHp: 12,
          maxHp: 27,
          tempHp: 4,
          hpBucket: 'bloodied',
          conditions: ['prone'],
          concentrating: 'Haste'
        },
        {
          id: ID(5),
          name: 'Enemy 1',
          kind: 'monster',
          characterId: null,
          initiative: 12,
          currentHp: null,
          maxHp: null,
          tempHp: 0,
          hpBucket: 'critical',
          conditions: [],
          concentrating: null
        }
      ]
    },
    log: [
      {
        id: 'l1',
        at: Date.UTC(2026, 10, 1, 20, 15),
        source: 'combat',
        characterIds: [ID(1)],
        summary: 'Aria: Fire Bolt → Enemy 1 (hit, 9 dmg)',
        encounterName: 'Ambush',
        round: 2,
        hpBefore: null,
        hpAfter: null,
        redacted: true
      }
    ]
  };
}

describe('PartyDashboard', () => {
  it('renders party vitals, slots, encounter order and the log', () => {
    const { getAllByTestId, getByText, container } = render(PartyDashboard, {
      props: { data: sample(), status: 'open' }
    });
    expect(getByText('Night Market')).toBeTruthy();
    const members = getAllByTestId('party-member');
    expect(members).toHaveLength(2);
    expect(members[0].textContent).toContain('Wizard 5');
    expect(members[0].textContent).toContain('+4 temp');
    expect(members[0].textContent).toContain('◎ Haste');
    expect(members[0].textContent).toContain('Arcane Recovery');
    expect(members[0].textContent).toContain('Quarterstaff');
    expect(members[1].textContent).toContain('No sheet yet');

    const combatants = getAllByTestId('combatant');
    expect(combatants.map((c) => c.getAttribute('aria-current'))).toEqual([null, 'step']);
    // The unrevealed enemy shows its bucket, never numbers.
    expect(combatants[1].textContent).toContain('Critical');
    expect(combatants[1].querySelector('[role="meter"]')).toBeNull();

    expect(getAllByTestId('log-entry')[0].textContent).toContain('Fire Bolt');
    // Read-only: no inputs or buttons anywhere.
    expect(container.querySelectorAll('input, button')).toHaveLength(0);
  });

  it('editable mode dispatches relative adjustments for party and combatants', async () => {
    const events: unknown[] = [];
    const { getAllByTestId } = render(PartyDashboard, {
      props: { data: sample(), status: 'open', editable: true },
      events: { adjust: (e) => events.push(e.detail) }
    });

    // One control per party member with a sheet + one per combatant.
    const controls = getAllByTestId('quick-hp');
    expect(controls).toHaveLength(3);

    const [aria, , enemy] = controls;
    const fire = async (el: HTMLElement, value: string, button: number) => {
      const input = el.querySelector('input')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      el.querySelectorAll('button')[button].click();
      await Promise.resolve();
    };
    await fire(aria, '6', 0);
    await fire(enemy, '4', 1);
    await fire(enemy, '0', 0); // ignored: not a positive amount
    expect(events).toEqual([
      { target: { kind: 'character', id: ID(1) }, mode: 'damage', amount: 6 },
      { target: { kind: 'participant', id: ID(5), encounterId: ID(3) }, mode: 'heal', amount: 4 }
    ]);
  });

  it('tells a spectator when their link stopped working', () => {
    const { getByTestId } = render(PartyDashboard, { props: { data: sample(), status: 'gone' } });
    expect(getByTestId('dashboard-status').textContent).toContain('no longer valid');
  });
});
