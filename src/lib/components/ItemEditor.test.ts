import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ItemEditor from './ItemEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({
  kind: 'item',
  slug: '',
  name: '',
  visibility: 'private' as const,
  data: {}
});
const editItem = () => ({
  kind: 'item',
  slug: 'longsword',
  name: 'Longsword',
  visibility: 'private' as const,
  data: { category: 'weapon' }
});

runEditorContract('ItemEditor', ItemEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

describe('ItemEditor (unique)', () => {
  // Locks: requiresAttunement is dropped from the payload when false, but
  // shipped as true when checked. A regression would store {requiresAttunement: false}
  // on every item — noise in the DB and confusing to consumers.
  it('save omits requiresAttunement when false', async () => {
    const onSave = vi.fn();
    const { getByRole, component } = render(ItemEditor, {
      props: { item: { ...emptyItem(), slug: 'pre', name: 'Pre' } }
    });
    component.$on('save', (e) => onSave(e.detail));

    await fireEvent.click(getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0].data.requiresAttunement).toBeUndefined();
  });

  // Locks: modifier rows with empty target are filtered out before save.
  it('save filters out modifier rows with blank target', async () => {
    const onSave = vi.fn();
    const { getByRole, component } = render(ItemEditor, {
      props: { item: { ...emptyItem(), slug: 'pre', name: 'Pre' } }
    });
    component.$on('save', (e) => onSave(e.detail));

    await fireEvent.click(getByRole('button', { name: '+ Add modifier' }));
    // Modifier added with empty target → should be filtered.

    await fireEvent.click(getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0].data.modifiers).toBeUndefined();
  });
});
