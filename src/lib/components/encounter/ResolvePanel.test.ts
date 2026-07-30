import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import ResolvePanel from './ResolvePanel.svelte';

const goblin = {
  id: 'gob-1',
  name: 'Goblin',
  kind: 'monster',
  statblockActions: [
    {
      name: 'Scimitar',
      attackBonus: 4,
      damage: [{ dice: '1d6+2', type: 'slashing' }]
    },
    { name: 'Leer', description: 'no dice here' }
  ]
};
const hero = { id: 'pc-1', name: 'Hero', kind: 'pc' };

const baseProps = {
  participants: [goblin, hero],
  actingParticipantId: 'gob-1'
};

describe('ResolvePanel roll arming', () => {
  // Regression: openResolve seeds actionLabel from the participant's PLAN,
  // with no statblock chip click — the damage 🎲 used to stay greyed out
  // and the attack 🎲 rolled a bare d20 with no bonus on that path.
  it('arms the roll buttons from a plan-seeded action label', async () => {
    render(ResolvePanel, { props: { ...baseProps, actionLabel: 'Scimitar' } });
    const damageBtn = screen.getByTitle(/Roll 1d6\+2/) as HTMLButtonElement;
    expect(damageBtn.disabled).toBe(false);
    expect(screen.getByTitle('Roll d20+4')).toBeTruthy();

    await fireEvent.click(damageBtn);
    const damageInput = screen
      .getByText('Damage')
      .parentElement!.querySelector('input') as HTMLInputElement;
    expect(Number(damageInput.value)).toBeGreaterThanOrEqual(3); // 1d6+2
    expect(Number(damageInput.value)).toBeLessThanOrEqual(8);
  });

  it('keeps the damage roll disarmed for actions without dice', () => {
    render(ResolvePanel, { props: { ...baseProps, actionLabel: 'Leer' } });
    const damageBtn = screen.getByTitle(
      'Pick a statblock action to roll its damage'
    ) as HTMLButtonElement;
    expect(damageBtn.disabled).toBe(true);
  });

  it('clicking a common action disarms the statblock rolls', async () => {
    render(ResolvePanel, { props: { ...baseProps, actionLabel: 'Scimitar' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dodge' }));
    const damageBtn = screen.getByTitle(
      'Pick a statblock action to roll its damage'
    ) as HTMLButtonElement;
    expect(damageBtn.disabled).toBe(true);
  });

  it('offers roll-all for checked multi-save targets', async () => {
    render(ResolvePanel, { props: baseProps });
    // No DC / no targets → no roll-all button.
    expect(screen.queryByRole('button', { name: /roll all/ })).toBeNull();
    const dcInput = screen.getByText('DC').parentElement!.querySelector('input')!;
    await fireEvent.input(dcInput, { target: { value: '13' } });
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: /roll all/ }));
    const saveInput = screen.getByPlaceholderText('save') as HTMLInputElement;
    expect(Number(saveInput.value)).toBeGreaterThanOrEqual(1);
    expect(Number(saveInput.value)).toBeLessThanOrEqual(20);
  });
});
