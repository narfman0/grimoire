import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SubspeciesEditor from './SubspeciesEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({
  kind: 'subspecies',
  slug: '',
  name: '',
  visibility: 'private' as const,
  data: {}
});
const editItem = () => ({
  kind: 'subspecies',
  slug: 'hill-dwarf',
  name: 'Hill Dwarf',
  visibility: 'private' as const,
  data: { parentSpecies: 'dwarf' }
});

runEditorContract('SubspeciesEditor', SubspeciesEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

describe('SubspeciesEditor (unique)', () => {
  // Locks: parentSpecies is trimmed before save; whitespace-only input is
  // dropped from the payload.
  it('save trims parentSpecies and omits it when blank', async () => {
    const onSave = vi.fn();
    const { getByRole } = render(SubspeciesEditor, {
      props: { item: { ...emptyItem(), slug: 'pre', name: 'Pre' } },
      events: { save: (e) => onSave(e.detail) }
    });

    await fireEvent.click(getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0].data.parentSpecies).toBeUndefined();
  });
});
