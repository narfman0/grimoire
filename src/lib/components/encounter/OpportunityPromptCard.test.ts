import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import OpportunityPromptCard from './OpportunityPromptCard.svelte';

const props = {
  attackerName: 'Goblin',
  moverName: 'Kribwynn',
  fromCell: { x: 4, y: 2 }
};

describe('OpportunityPromptCard', () => {
  it('names both creatures and the square the swing happens from', () => {
    render(OpportunityPromptCard, { props });
    const text = screen.getByTestId('opportunity-prompt').textContent!;
    expect(text).toContain('Goblin');
    expect(text).toContain('Kribwynn');
    expect(text).toContain('(4, 2)');
  });

  it('drops the cell mention when the parent has no position for it', () => {
    render(OpportunityPromptCard, { props: { ...props, fromCell: null } });
    expect(screen.getByTestId('opportunity-prompt').textContent).not.toContain('(');
  });

  it('offers resolve, reaction-only and skip as distinct answers', async () => {
    const resolve = vi.fn();
    const markUsed = vi.fn();
    const skip = vi.fn();
    render(OpportunityPromptCard, { props, events: { resolve, markUsed, skip } });

    await fireEvent.click(screen.getByRole('button', { name: /Resolve the attack/ }));
    expect(resolve).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: /Just the reaction/ }));
    expect(markUsed).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(skip).toHaveBeenCalledOnce();
  });

  it('reports how many prompts are queued behind it', () => {
    render(OpportunityPromptCard, { props: { ...props, queuedBehind: 2 } });
    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('says nothing about a queue when it is the only prompt', () => {
    render(OpportunityPromptCard, { props });
    expect(screen.queryByText(/more$/)).toBeNull();
  });
});
