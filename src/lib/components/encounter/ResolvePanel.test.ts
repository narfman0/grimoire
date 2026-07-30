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

const dragon = {
  id: 'drg-1',
  name: 'Wyrmling',
  kind: 'monster',
  statblockActions: [
    {
      name: 'Fire Breath',
      description:
        'Each creature in a 15-foot cone must make a DC 13 Dexterity saving throw, taking 16 fire damage on a failed save, or half as much on a successful one.',
      damage: [{ dice: '4d6', type: 'fire' }]
    },
    { name: 'Bite', attackBonus: 4, damage: [{ dice: '1d10+3', type: 'piercing' }] }
  ]
};

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

  // The DM used to retype the DC every round and add each target's modifier
  // to a bare d20 by hand; both numbers were already on the page.
  it('pre-fills the save DC and ability from the action prose', async () => {
    render(ResolvePanel, {
      props: {
        participants: [dragon, hero],
        actingParticipantId: 'drg-1',
        actionLabel: 'Fire Breath'
      }
    });
    const dcInput = screen.getByText('DC').parentElement!.querySelector('input') as HTMLInputElement;
    expect(dcInput.value).toBe('13');
    expect(screen.getByTestId('parsed-save').textContent).toContain('DEX save');
  });

  it("keeps the DM's typed DC, and re-arms it on a fresh action pick", async () => {
    const { rerender } = render(ResolvePanel, {
      props: { participants: [dragon, hero], actingParticipantId: 'drg-1' }
    });
    const dcInput = screen.getByText('DC').parentElement!.querySelector('input') as HTMLInputElement;
    await fireEvent.input(dcInput, { target: { value: '19' } });
    // The label moving on its own (plan seed, hand-typing) leaves it alone…
    await rerender({ actionLabel: 'Fire Breath' });
    expect(dcInput.value).toBe('19');
    // …but clicking the chip is an explicit "resolve this action" and re-arms.
    await fireEvent.click(screen.getByRole('button', { name: /Fire Breath/ }));
    expect(dcInput.value).toBe('13');
  });

  it("rolls a target's save with their own bonus for the named ability", async () => {
    render(ResolvePanel, {
      props: {
        participants: [dragon, hero],
        actingParticipantId: 'drg-1',
        actionLabel: 'Fire Breath',
        // A +9 DEX save can't roll below 10, so the bonus is unmistakable.
        saveBonuses: { 'pc-1': { dex: 9, con: 1 } }
      }
    });
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(screen.getByTitle(/Roll d20 DEX \+9/));
    const saveInput = screen.getByPlaceholderText('save') as HTMLInputElement;
    expect(Number(saveInput.value)).toBeGreaterThanOrEqual(10);
    expect(Number(saveInput.value)).toBeLessThanOrEqual(29);
  });

  it('rolls a bare d20 when the action names no save ability', async () => {
    render(ResolvePanel, {
      props: {
        participants: [dragon, hero],
        actingParticipantId: 'drg-1',
        actionLabel: 'Bite',
        saveDC: 12,
        saveBonuses: { 'pc-1': { dex: 9 } }
      }
    });
    await fireEvent.click(screen.getByRole('checkbox'));
    await fireEvent.click(
      screen.getByTitle("Roll a bare d20 for this target's save — add their modifier")
    );
    const saveInput = screen.getByPlaceholderText('save') as HTMLInputElement;
    expect(Number(saveInput.value)).toBeLessThanOrEqual(20);
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
