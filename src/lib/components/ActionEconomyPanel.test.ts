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
    const { container } = render(ActionEconomyPanel, {
      props: { ...baseProps, readonly: false },
      events: { actionPick: (e) => onPick(e.detail) }
    });

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

  // WS2 phase 4: the planner greys out picks the participant can't take
  // and says why, instead of silently offering them.
  it('disables an unavailable choice and shows the reason in its label', () => {
    const { container } = render(ActionEconomyPanel, {
      props: {
        ...baseProps,
        actionChoices: [
          { id: 'bite', name: 'Bite' },
          {
            id: 'breath',
            name: 'Fire Breath',
            unavailable: true,
            unavailableReason: 'out of uses',
            resourceNote: ' — 0/1 Recharge left'
          }
        ]
      }
    });
    const options = Array.from(actionSelect(container).options);
    const bite = options.find((o) => o.value === 'bite')!;
    const breath = options.find((o) => o.value === 'breath')!;
    expect(bite.disabled).toBe(false);
    expect(breath.disabled).toBe(true);
    expect(breath.textContent).toContain('out of uses');
    expect(breath.textContent).toContain('0/1 Recharge left');
  });

  it('leaves a choice enabled when it carries a resource note but no blocker', () => {
    const { container } = render(ActionEconomyPanel, {
      props: {
        ...baseProps,
        actionChoices: [
          { id: 'ki-strike', name: 'Flurry', resourceNote: ' — 2/5 Ki left' }
        ]
      }
    });
    const option = Array.from(actionSelect(container).options).find(
      (o) => o.value === 'ki-strike'
    )!;
    expect(option.disabled).toBe(false);
    expect(option.textContent).toContain('2/5 Ki left');
  });

  it('disables an unavailable bonus-action choice too', () => {
    const { container } = render(ActionEconomyPanel, {
      props: {
        ...baseProps,
        bonusChoices: [
          { id: 'dash', name: 'Dash', unavailable: true, unavailableReason: 'no bonus action left' }
        ]
      }
    });
    const selects = container.querySelectorAll('select');
    const bonus = selects[1] as HTMLSelectElement;
    const option = Array.from(bonus.options).find((o) => o.value === 'dash')!;
    expect(option.disabled).toBe(true);
    expect(option.textContent).toContain('no bonus action left');
  });
});
