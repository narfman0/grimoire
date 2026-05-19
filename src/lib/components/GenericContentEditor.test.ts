import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import GenericContentEditor from './GenericContentEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({
  kind: 'misc',
  slug: '',
  name: '',
  visibility: 'private' as const,
  data: {}
});
const editItem = () => ({
  kind: 'misc',
  slug: 'thing',
  name: 'Thing',
  visibility: 'private' as const,
  data: { foo: 'bar' }
});

runEditorContract('GenericContentEditor', GenericContentEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

describe('GenericContentEditor (unique)', () => {
  // Locks the live-JSON-parse gate. A typo in the JSON textarea must
  // disable Save and surface a parse error; the regression would let the
  // user click Save with garbage and 500.
  it('disables Save when the JSON textarea has a parse error', async () => {
    const { getByRole } = render(GenericContentEditor, {
      props: { item: { ...emptyItem(), slug: 'pre', name: 'Pre' } }
    });
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: '{ "bad": ,' } });
    expect((getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  // Locks the parsed-JSON round-trip: save dispatches a real object, not
  // the string textarea content.
  it('Save dispatches parsed JSON object on data', async () => {
    const onSave = vi.fn();
    const { getByRole, component } = render(GenericContentEditor, {
      props: { item: { ...emptyItem(), slug: 'pre', name: 'Pre' } }
    });
    component.$on('save', (e) => onSave(e.detail));
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: '{"foo": 42}' } });

    await fireEvent.click(getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].data).toEqual({ foo: 42 });
  });
});
