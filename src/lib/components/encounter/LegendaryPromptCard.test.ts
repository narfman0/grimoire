import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import LegendaryPromptCard from './LegendaryPromptCard.svelte';

const baseProps = {
  participantName: 'Adult Red Dragon',
  budget: 3,
  remaining: 2,
  queuedBehind: 1,
  actions: [
    { name: 'Tail Attack', cost: 1, affordable: true },
    { name: 'Wing Attack', cost: 2, affordable: true },
    { name: 'Fiery Rampage', cost: 3, affordable: false }
  ]
};

describe('LegendaryPromptCard', () => {
  it('shows the budget line and one button per action, cost-labeled', () => {
    render(LegendaryPromptCard, { props: baseProps });
    const text = screen.getByTestId('legendary-prompt').textContent?.replace(/\s+/g, ' ');
    expect(text).toContain('2/3 legendary actions left');
    const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
    expect(button('Tail Attack').disabled).toBe(false);
    expect(button('Wing Attack (2)').disabled).toBe(false);
    expect(button('Fiery Rampage (3)').disabled).toBe(true);
    expect(screen.getByText('+1 more')).toBeTruthy();
  });

  it('dispatches use with the chosen action and skip on skip', async () => {
    const onUse = vi.fn();
    const onSkip = vi.fn();
    render(LegendaryPromptCard, {
      props: baseProps,
      events: {
        use: (e: CustomEvent) => onUse(e.detail),
        skip: onSkip
      }
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Wing Attack (2)' }));
    expect(onUse).toHaveBeenCalledWith({ name: 'Wing Attack', cost: 2, affordable: true });

    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalled();
  });

  it('never dispatches use for an unaffordable action', async () => {
    const onUse = vi.fn();
    render(LegendaryPromptCard, { props: baseProps, events: { use: onUse } });
    // userEvent (unlike fireEvent) respects the disabled attribute.
    await userEvent.click(screen.getByRole('button', { name: 'Fiery Rampage (3)' }));
    expect(onUse).not.toHaveBeenCalled();
  });
});
