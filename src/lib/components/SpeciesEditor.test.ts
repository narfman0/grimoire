import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SpeciesEditor from './SpeciesEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({
  kind: 'species',
  slug: '',
  name: '',
  visibility: 'private' as const,
  data: {}
});
const editItem = () => ({
  kind: 'species',
  slug: 'dwarf',
  name: 'Dwarf',
  visibility: 'private' as const,
  data: { size: 'Medium', speed: 25 }
});

runEditorContract('SpeciesEditor', SpeciesEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

describe('SpeciesEditor (unique)', () => {
  // Locks: zero ability bonuses are dropped from the payload (a +0
  // abilityBonuses map breaks derive() which expects only non-zero keys).
  it('save omits abilityBonuses when every score is 0', async () => {
    const onSave = vi.fn();
    const { getByRole } = render(SpeciesEditor, {
      props: { item: { ...emptyItem(), slug: 'pre', name: 'Pre' } },
      events: { save: (e) => onSave(e.detail) }
    });

    await fireEvent.click(getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
    const payload = onSave.mock.calls[0][0];
    expect(payload.data.abilityBonuses).toBeUndefined();
    // size + speed always shipped (defaults Medium / 30).
    expect(payload.data.size).toBe('Medium');
    expect(payload.data.speed).toBe(30);
  });
});
