import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ActionEconomyPanel from './ActionEconomyPanel.svelte';

const baseProps = {
  mode: 'observer' as const,
  actionChoices: [
    { id: 'bite', name: 'Bite' },
    { id: 'claw', name: 'Claw' }
  ],
  bonusChoices: [{ id: 'dash', name: 'Dash' }],
  plannedActionId: '',
  plannedBonusActionId: '',
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  walkSpeed: 30,
  movementUsed: 0,
  showConcentration: false,
  participants: [
    { id: 'self', name: 'Goblin' },
    { id: 'foe', name: 'Wizard' }
  ],
  selfId: 'self',
  plannedTargetIds: [],
  plannedBonusTargetIds: []
};

function actionSelect(container: HTMLElement): HTMLSelectElement {
  // First <select> in the panel is the Action dropdown.
  const sel = container.querySelector('select');
  if (!sel) throw new Error('action <select> not found');
  return sel as HTMLSelectElement;
}

describe('ActionEconomyPanel', () => {
  // Locks the regression class that hit twice this session: a `readonly`
  // or `disabled` gate short-circuiting writes the DM expects to make. If
  // someone adds back `readonly={isPc}` or similar, this fails.
  it('action dropdown is enabled when readonly is false and dispatches actionPick', async () => {
    const onPick = vi.fn();
    const { container, component } = render(ActionEconomyPanel, {
      props: { ...baseProps, readonly: false }
    });
    component.$on('actionPick', (e) => onPick(e.detail));

    const select = actionSelect(container);
    expect(select.disabled).toBe(false);

    await fireEvent.change(select, { target: { value: 'bite' } });
    expect(onPick).toHaveBeenCalledWith('bite');
  });

  it('action dropdown is disabled when readonly is true', () => {
    const { container } = render(ActionEconomyPanel, {
      props: { ...baseProps, readonly: true }
    });
    expect(actionSelect(container).disabled).toBe(true);
  });

  it('action dropdown is disabled when no actionChoices are available', () => {
    const { container } = render(ActionEconomyPanel, {
      props: { ...baseProps, readonly: false, actionChoices: [] }
    });
    expect(actionSelect(container).disabled).toBe(true);
  });
});
