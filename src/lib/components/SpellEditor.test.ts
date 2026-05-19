import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SpellEditor from './SpellEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({
  kind: 'spell',
  slug: '',
  name: '',
  visibility: 'private' as const,
  data: {}
});
const editItem = () => ({
  kind: 'spell',
  slug: 'fireball',
  name: 'Fireball',
  visibility: 'private' as const,
  data: { level: 3, school: 'evocation' }
});

runEditorContract('SpellEditor', SpellEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

describe('SpellEditor (unique)', () => {
  // Locks the activities-array validation gate. Pasting non-array JSON
  // surfaces an error and disables Save — protects the rules engine from
  // a "{}" or "true" payload.
  it('disables Save when the activities textarea is not a JSON array', async () => {
    const { getByRole } = render(SpellEditor, {
      props: { item: { ...emptyItem(), slug: 'pre', name: 'Pre' } }
    });
    const textareas = document.querySelectorAll('textarea');
    // Activities textarea is the only one (description textarea may
    // exist; this still works because both are textareas — pick the one
    // containing valid JSON syntax markers, or just iterate both).
    const activitiesTa = Array.from(textareas).find((t) =>
      (t as HTMLTextAreaElement).value.startsWith('[')
    ) as HTMLTextAreaElement;
    expect(activitiesTa).toBeDefined();
    await fireEvent.input(activitiesTa, { target: { value: '{}' } });
    expect((getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
