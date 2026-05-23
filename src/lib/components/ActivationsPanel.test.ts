import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ActivationsPanel from './ActivationsPanel.svelte';
import type { AvailableActivation } from '$lib/rules';

function avail(over: Partial<AvailableActivation> = {}): AvailableActivation {
  return {
    id: 'bladesong',
    name: 'Bladesong',
    sourceContent: { kind: 'feature', slug: 'bladesong' },
    usesMax: 2,
    usesRemaining: 2,
    refreshOn: 'short-rest',
    condition: 'bladesong',
    active: false,
    ...over
  };
}

describe('ActivationsPanel', () => {
  it('renders an empty-state when no activations', () => {
    const { getByText } = render(ActivationsPanel, { props: { activations: [] } });
    expect(getByText(/no activatable abilities/i)).toBeTruthy();
  });

  it('renders a row per activation with uses badge', () => {
    const { getByText } = render(ActivationsPanel, {
      props: { activations: [avail()] }
    });
    expect(getByText('Bladesong')).toBeTruthy();
    expect(getByText('2/2')).toBeTruthy();
  });

  it('Activate button dispatches toggle with on=true', async () => {
    const onToggle = vi.fn();
    const { getByRole, component } = render(ActivationsPanel, {
      props: { activations: [avail()] }
    });
    component.$on('toggle', (e) => onToggle(e.detail));
    await fireEvent.click(getByRole('button', { name: /Activate/i }));
    expect(onToggle).toHaveBeenCalledWith({ id: 'bladesong', on: true });
  });

  it('Deactivate button dispatches toggle with on=false when active', async () => {
    const onToggle = vi.fn();
    const { getByRole, component } = render(ActivationsPanel, {
      props: { activations: [avail({ active: true })] }
    });
    component.$on('toggle', (e) => onToggle(e.detail));
    await fireEvent.click(getByRole('button', { name: /Deactivate/i }));
    expect(onToggle).toHaveBeenCalledWith({ id: 'bladesong', on: false });
  });

  it('disables the Activate button when usesRemaining is 0', () => {
    const { getByRole } = render(ActivationsPanel, {
      props: { activations: [avail({ usesRemaining: 0 })] }
    });
    const btn = getByRole('button', { name: /Activate/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('variant dropdown is rendered and dispatched on activate', async () => {
    const onToggle = vi.fn();
    const a = avail({
      id: 'wild-heart-aspect',
      name: 'Aspect of the Wilds',
      condition: 'aspect-active',
      usesMax: null,
      usesRemaining: null,
      refreshOn: null,
      variants: [
        { id: 'owl', label: 'Owl' },
        { id: 'panther', label: 'Panther' }
      ]
    });
    const { getByRole, component } = render(ActivationsPanel, { props: { activations: [a] } });
    component.$on('toggle', (e) => onToggle(e.detail));

    const select = getByRole('combobox') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'panther' } });
    await fireEvent.click(getByRole('button', { name: /Activate/i }));
    expect(onToggle).toHaveBeenCalledWith({
      id: 'wild-heart-aspect',
      on: true,
      variant: 'panther'
    });
  });

  it('warns when activating a concentration ability would interrupt prior concentration', () => {
    const a = avail({ id: 'magic-weapon', name: 'Magic Weapon', concentration: true });
    const { getByText } = render(ActivationsPanel, {
      props: { activations: [a], concentratingLabel: 'Bless' }
    });
    expect(getByText(/Activating will end concentration on/i)).toBeTruthy();
  });

  it('does not warn when the prior concentration is this same activation', () => {
    const a = avail({ id: 'magic-weapon', name: 'Magic Weapon', concentration: true });
    const { queryByText } = render(ActivationsPanel, {
      props: { activations: [a], concentratingLabel: 'Magic Weapon' }
    });
    expect(queryByText(/Activating will end concentration on/i)).toBeNull();
  });

  it('shows autoCancelOn hint when set', () => {
    const a = avail({ autoCancelOn: ['incapacitated', 'unconscious'] });
    const { getByText } = render(ActivationsPanel, { props: { activations: [a] } });
    expect(getByText(/incapacitated, unconscious/)).toBeTruthy();
  });

  it('busy disables both the variant dropdown and the activate button', () => {
    const a = avail({
      variants: [{ id: 'v1', label: 'V1' }]
    });
    const { getByRole } = render(ActivationsPanel, {
      props: { activations: [a], busy: true }
    });
    expect((getByRole('button', { name: /Activate/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  });
});
