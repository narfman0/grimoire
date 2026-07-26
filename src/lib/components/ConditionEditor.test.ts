import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ConditionEditor from './ConditionEditor.svelte';

function emptyItem() {
  return { slug: '', name: '', visibility: 'private' as const, data: {} };
}

describe('ConditionEditor', () => {
  // Locks the "save gated by required fields" contract — a regression here
  // would let the parent POST a row with an empty name/slug and 500.
  it('save button is disabled when name is empty', () => {
    const { getByRole } = render(ConditionEditor, { props: { item: emptyItem() } });
    expect((getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // Slug auto-generation from name when creating. Stops once the user
  // manually edits the slug — that branch is easy to drop in a refactor.
  it('auto-fills slug from name in create mode until slug is manually edited', async () => {
    const { getByRole, getAllByRole } = render(ConditionEditor, {
      props: { item: emptyItem() }
    });
    const [nameInput, slugInput] = getAllByRole('textbox') as HTMLInputElement[];

    await fireEvent.input(nameInput, { target: { value: 'On Fire!' } });
    expect(slugInput.value).toBe('on-fire');
    // Save now enabled
    expect((getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);

    // User overrides the slug; further name edits don't clobber it.
    await fireEvent.input(slugInput, { target: { value: 'burning' } });
    await fireEvent.input(nameInput, { target: { value: 'Drenched' } });
    expect(slugInput.value).toBe('burning');
  });

  // Locks: slug is read-only in edit mode (can't rename the row's slug).
  it('locks slug input in edit mode and shows the Delete button', () => {
    const { getByRole, getAllByRole } = render(ConditionEditor, {
      props: {
        item: { ...emptyItem(), slug: 'frightened', name: 'Frightened' },
        isEdit: true
      }
    });
    const [, slugInput] = getAllByRole('textbox') as HTMLInputElement[];
    expect(slugInput.disabled).toBe(true);
    expect(getByRole('button', { name: 'Delete' })).not.toBeNull();
  });

  it('does not render Delete in create mode', () => {
    const { queryByRole } = render(ConditionEditor, { props: { item: emptyItem() } });
    expect(queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  // Save payload contract: empty effects are filtered out; source is trimmed;
  // optional keys are omitted when blank. Catches the easy regression of
  // shipping ['', '', 'Disadvantage'] to the server.
  it('save event omits empty effects and blank optional fields', async () => {
    const onSave = vi.fn();
    const { getByRole, getAllByRole } = render(ConditionEditor, {
      props: { item: { slug: 'pre', name: 'Pre', visibility: 'private', data: {} } },
      events: { save: (e) => onSave(e.detail) }
    });

    // Click "+ Add effect" twice; fill only the second.
    const addBtn = getByRole('button', { name: '+ Add effect' });
    await fireEvent.click(addBtn);
    await fireEvent.click(addBtn);
    const effectInputs = getAllByRole('textbox').filter(
      (el) => (el as HTMLInputElement).placeholder === 'e.g. Disadvantage on attack rolls'
    ) as HTMLInputElement[];
    expect(effectInputs.length).toBe(2);
    await fireEvent.input(effectInputs[1], {
      target: { value: 'Disadvantage on attack rolls' }
    });

    await fireEvent.click(getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledOnce();
    const payload = onSave.mock.calls[0][0];
    expect(payload.data.effects).toEqual(['Disadvantage on attack rolls']);
    expect(payload.data.source).toBeUndefined();
    expect(payload.data.description).toBeUndefined();
  });

  it('dispatches cancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    const { getByRole } = render(ConditionEditor, {
      props: { item: emptyItem() },
      events: { cancel: onCancel }
    });

    await fireEvent.click(getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
