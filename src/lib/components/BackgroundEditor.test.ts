import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BackgroundEditor from './BackgroundEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({ slug: '', name: '', visibility: 'private' as const, data: {} });
const editItem = () => ({
  slug: 'sailor',
  name: 'Sailor',
  visibility: 'private' as const,
  data: { description: 'Salty.' }
});

runEditorContract('BackgroundEditor', BackgroundEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

describe('BackgroundEditor (unique)', () => {
  // Locks the unique save-payload shape: empty arrays/strings are dropped,
  // and the languages field round-trips as a number in `bonus` mode.
  // Regression here would ship empty arrays to the server and fail Zod.
  it('save omits empty optional fields and keeps language bonus when default', async () => {
    const onSave = vi.fn();
    const { getByRole, getAllByRole } = render(BackgroundEditor, {
      props: { item: { ...emptyItem(), slug: 'pre', name: 'Pre' } },
      events: { save: (e) => onSave(e.detail) }
    });

    await fireEvent.click(getByRole('button', { name: 'Save' }));
    const payload = onSave.mock.calls[0][0];
    expect(payload.slug).toBe('pre');
    expect(payload.name).toBe('Pre');
    // languages defaults to bonus mode with langBonus=1 → numeric 1.
    expect(payload.data.languages).toBe(1);
    expect(payload.data.skillProficiencies).toBeUndefined();
    expect(payload.data.toolProficiencies).toBeUndefined();

    // Suppress unused-var lint warning for getAllByRole in the contract helper.
    expect(getAllByRole('textbox').length).toBeGreaterThan(0);
  });
});
