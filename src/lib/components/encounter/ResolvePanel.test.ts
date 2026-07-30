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

  it('seeds the damage type from the action and stops following once changed', async () => {
    const { rerender } = render(ResolvePanel, {
      props: { ...baseProps, actionLabel: 'Scimitar' }
    });
    const select = screen.getByLabelText('Damage type') as HTMLSelectElement;
    expect(select.value).toBe('slashing');

    // A hand-picked type sticks even when the label moves on — the DM's
    // override wins until they pick a fresh action from the chips.
    await fireEvent.change(select, { target: { value: 'fire' } });
    await rerender({ actionLabel: 'Leer' });
    expect(select.value).toBe('fire');
  });

  it('re-arms the damage type when a statblock chip is clicked', async () => {
    render(ResolvePanel, { props: { ...baseProps, actionLabel: 'Leer' } });
    const select = screen.getByLabelText('Damage type') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'fire' } });
    await fireEvent.click(screen.getByRole('button', { name: /Scimitar/ }));
    expect(select.value).toBe('slashing');
  });

  it('renders the board cover readout beside the target select', () => {
    render(ResolvePanel, { props: { ...baseProps, coverNote: 'half cover — +2 AC' } });
    expect(screen.getByTestId('cover-note').textContent).toContain('half cover — +2 AC');
  });

  it('shows no cover chip when the parent reports none', () => {
    render(ResolvePanel, { props: baseProps });
    expect(screen.queryByTestId('cover-note')).toBeNull();
  });

  it('renders the parent-computed narrowing preview', () => {
    render(ResolvePanel, {
      props: { ...baseProps, damagePreview: 'fire resisted (12 → 6)' }
    });
    expect(screen.getByTestId('damage-preview').textContent).toContain('fire resisted (12 → 6)');
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
