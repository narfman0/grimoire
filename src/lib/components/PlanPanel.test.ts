import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import PlanPanel, { type EconomyState } from './PlanPanel.svelte';

const baseEconomy: EconomyState = {
  movement: 0,
  freeActions: '',
  slotLevel: 1,
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false
};

const baseProps = {
  participant: { id: 'self', name: 'Wizard', kind: 'pc' },
  plan: null,
  role: 'dm' as const,
  participants: [
    { id: 'self', name: 'Wizard' },
    { id: 'foe', name: 'Goblin' }
  ],
  actionChoices: [{ id: 'firebolt', name: 'Firebolt (action)' }],
  bonusChoices: [{ id: 'misty-step', name: 'Misty Step' }],
  walkSpeed: 30,
  busy: false,
  economy: baseEconomy,
  showSlotLevel: false
};

describe('PlanPanel', () => {
  // Locks the self-filter regression that hit this session: the target
  // picker used to drop self from `pickableTargets`. The fix was to include
  // self with a "(self)" suffix so self-buffs / AoE-self-included work.
  it('target picker includes self with (self) suffix when an action is picked', () => {
    const { getAllByRole } = render(PlanPanel, {
      props: {
        ...baseProps,
        plan: {
          actionId: 'firebolt',
          actionLabel: 'Firebolt (action)',
          targetParticipantIds: [],
          notes: '',
          updatedAt: 0
        }
      }
    });

    const buttons = getAllByRole('button').map((b) => b.textContent?.trim() ?? '');
    expect(buttons).toContain('Wizard (self)');
    expect(buttons).toContain('Goblin');
  });

  // Locks: any participant can be a target (multi-select), self included.
  // If a future refactor reintroduces a `targetMode==='single'` path or
  // re-filters self, this fails.
  it('clicking a target chip dispatches targetPick with the toggled list', async () => {
    const onTargetPick = vi.fn();
    const { getByRole } = render(PlanPanel, {
      props: {
        ...baseProps,
        plan: {
          actionId: 'firebolt',
          actionLabel: 'Firebolt (action)',
          targetParticipantIds: [],
          notes: '',
          updatedAt: 0
        }
      },
      events: { targetPick: (e) => onTargetPick(e.detail) }
    });

    await fireEvent.click(getByRole('button', { name: 'Goblin' }));
    expect(onTargetPick).toHaveBeenCalledWith(['foe']);
  });

  // Locks the role-gated resolve/clear placement. These buttons moved
  // around twice this session — once into and once out of the panel. The
  // contract: DM with a non-empty plan sees both; player or empty plan
  // sees neither.
  it('resolve + clear buttons render only for DM with a non-empty plan', () => {
    const planWithAction = {
      actionId: 'firebolt',
      actionLabel: 'Firebolt (action)',
      targetParticipantIds: [],
      notes: '',
      updatedAt: 0
    };

    const dmView = render(PlanPanel, {
      props: { ...baseProps, role: 'dm', plan: planWithAction }
    });
    expect(dmView.queryByRole('button', { name: 'resolve' })).not.toBeNull();
    expect(dmView.queryByRole('button', { name: 'clear' })).not.toBeNull();
    dmView.unmount();

    const playerView = render(PlanPanel, {
      props: { ...baseProps, role: 'player', plan: planWithAction }
    });
    expect(playerView.queryByRole('button', { name: 'resolve' })).toBeNull();
    expect(playerView.queryByRole('button', { name: 'clear' })).toBeNull();
    playerView.unmount();

    const emptyPlanView = render(PlanPanel, {
      props: { ...baseProps, role: 'dm', plan: null }
    });
    expect(emptyPlanView.queryByRole('button', { name: 'resolve' })).toBeNull();
    expect(emptyPlanView.queryByRole('button', { name: 'clear' })).toBeNull();
  });

  // Locks: resolve click bubbles up. If the wiring inside PlanPanel breaks
  // (event name typo, dispatch dropped), this fails before the user does.
  it('clicking resolve dispatches the resolve event', async () => {
    const onResolve = vi.fn();
    const { getByRole } = render(PlanPanel, {
      props: {
        ...baseProps,
        plan: {
          actionId: 'firebolt',
          actionLabel: 'Firebolt (action)',
          targetParticipantIds: [],
          notes: '',
          updatedAt: 0
        }
      },
      events: { resolve: onResolve }
    });

    await fireEvent.click(getByRole('button', { name: 'resolve' }));
    expect(onResolve).toHaveBeenCalledOnce();
  });
});
