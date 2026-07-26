import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ReceivedBuffsPanel from './ReceivedBuffsPanel.svelte';

const SPELLS = [
  { slug: 'shield-of-faith', name: 'Shield of Faith', level: 1, concentration: true },
  { slug: 'longstrider', name: 'Longstrider', level: 1, concentration: false }
];

describe('ReceivedBuffsPanel', () => {
  it('renders the empty list + spell picker when no buffs are active', () => {
    const { getByRole, getByText } = render(ReceivedBuffsPanel, {
      props: { buffs: [], spellOptions: SPELLS }
    });
    expect(getByText(/Received Buffs/)).toBeTruthy();
    expect(getByRole('combobox')).toBeTruthy();
  });

  it('renders one row per buff with the spell name', () => {
    const { getByText } = render(ReceivedBuffsPanel, {
      props: {
        buffs: [
          { id: 'b1', spellSlug: 'shield-of-faith' },
          { id: 'b2', spellSlug: 'longstrider' }
        ],
        spellOptions: SPELLS
      }
    });
    expect(getByText('Shield of Faith')).toBeTruthy();
    expect(getByText('Longstrider')).toBeTruthy();
  });

  it('dispatches add when a spell is picked and the add button is clicked', async () => {
    const onAdd = vi.fn();
    const { getByRole } = render(ReceivedBuffsPanel, {
      props: { buffs: [], spellOptions: SPELLS },
      events: { add: (e) => onAdd(e.detail) }
    });

    const select = getByRole('combobox') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: 'shield-of-faith' } });
    await fireEvent.click(getByRole('button', { name: /Add buff/i }));
    expect(onAdd).toHaveBeenCalledWith({ spellSlug: 'shield-of-faith', slot: 1 });
  });

  it('dispatches remove when the Remove button is clicked', async () => {
    const onRemove = vi.fn();
    const { getByRole } = render(ReceivedBuffsPanel, {
      props: {
        buffs: [{ id: 'b1', spellSlug: 'shield-of-faith' }],
        spellOptions: SPELLS
      },
      events: { remove: (e) => onRemove(e.detail) }
    });

    await fireEvent.click(getByRole('button', { name: /Remove/ }));
    expect(onRemove).toHaveBeenCalledWith({ id: 'b1' });
  });

  it('dispatches update when the source label changes', async () => {
    const onUpdate = vi.fn();
    const { getByLabelText } = render(ReceivedBuffsPanel, {
      props: {
        buffs: [{ id: 'b1', spellSlug: 'shield-of-faith' }],
        spellOptions: SPELLS
      },
      events: { update: (e) => onUpdate(e.detail) }
    });

    const input = getByLabelText(/source/i) as HTMLInputElement;
    input.value = 'from Cleric Vortha';
    await fireEvent.change(input);
    expect(onUpdate).toHaveBeenCalledWith({
      id: 'b1',
      patch: { sourceLabel: 'from Cleric Vortha' }
    });
  });

  it('disables Add button when no spell is picked', () => {
    const { getByRole } = render(ReceivedBuffsPanel, {
      props: { buffs: [], spellOptions: SPELLS }
    });
    const btn = getByRole('button', { name: /Add buff/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('disables Add button when busy', () => {
    const { getByRole } = render(ReceivedBuffsPanel, {
      props: { buffs: [], spellOptions: SPELLS, busy: true }
    });
    const btn = getByRole('button', { name: /Add buff/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
