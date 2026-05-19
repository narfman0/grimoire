import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import InventoryPicker from './InventoryPicker.svelte';

const sampleItems = [
  { slug: 'longsword', name: 'Longsword', source: 'PHB', category: 'weapon', kindHint: 'martial melee', requiresAttunement: false },
  { slug: 'plate', name: 'Plate Armor', source: 'PHB', category: 'armor', kindHint: 'heavy', requiresAttunement: false },
  { slug: 'bag-of-holding', name: 'Bag of Holding', source: 'PHB', category: 'wondrous', kindHint: 'wondrous', requiresAttunement: false },
  { slug: 'ring-of-protection', name: 'Ring of Protection', source: 'DMG', category: 'ring', kindHint: 'ring', requiresAttunement: true }
];

describe('InventoryPicker', () => {
  // Locks the search filter contract: typing in the search box narrows the
  // list. Catches a regression where the `query` binding gets disconnected
  // from `filtered`.
  it('search box filters items by name', async () => {
    const { getByPlaceholderText, getAllByRole } = render(InventoryPicker, {
      props: { items: sampleItems }
    });
    const input = getByPlaceholderText('Search items…') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'ring' } });

    const buttons = getAllByRole('button').map((b) => b.textContent ?? '');
    // Item rows include the name; ring should match, plate should not.
    const itemRows = buttons.filter((t) => t.includes('Ring of Protection'));
    expect(itemRows.length).toBe(1);
    expect(buttons.some((t) => t.includes('Plate Armor'))).toBe(false);
  });

  it('clicking an item dispatches pick with its slug', async () => {
    const onPick = vi.fn();
    const { getByText, component } = render(InventoryPicker, {
      props: { items: sampleItems }
    });
    component.$on('pick', (e) => onPick(e.detail));

    await fireEvent.click(getByText('Longsword'));
    expect(onPick).toHaveBeenCalledWith({ slug: 'longsword' });
  });

  // Locks the "Escape closes" keyboard contract — dispatches pick with an
  // empty slug so the parent treats it as a cancel.
  it('Escape dispatches an empty pick (cancel)', async () => {
    const onPick = vi.fn();
    const { getByPlaceholderText, component } = render(InventoryPicker, {
      props: { items: sampleItems }
    });
    component.$on('pick', (e) => onPick(e.detail));

    await fireEvent.keyDown(getByPlaceholderText('Search items…'), { key: 'Escape' });
    expect(onPick).toHaveBeenCalledWith({ slug: '' });
  });

  // Locks: ArrowDown advances selection, Enter picks the highlighted row.
  it('Enter on a highlighted row dispatches pick', async () => {
    const onPick = vi.fn();
    const { getByPlaceholderText, component } = render(InventoryPicker, {
      props: { items: sampleItems }
    });
    component.$on('pick', (e) => onPick(e.detail));

    const input = getByPlaceholderText('Search items…');
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ slug: 'plate' });
  });

  it('backdrop click dispatches empty pick (cancel)', async () => {
    const onPick = vi.fn();
    const { getByLabelText, component } = render(InventoryPicker, {
      props: { items: sampleItems }
    });
    component.$on('pick', (e) => onPick(e.detail));

    await fireEvent.click(getByLabelText('Close picker'));
    expect(onPick).toHaveBeenCalledWith({ slug: '' });
  });
});
