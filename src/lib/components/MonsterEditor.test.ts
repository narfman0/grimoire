import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MonsterEditor from './MonsterEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({
  kind: 'monster',
  slug: '',
  name: '',
  visibility: 'private' as const,
  data: {}
});
const editItem = () => ({
  kind: 'monster',
  slug: 'orc',
  name: 'Orc',
  visibility: 'private' as const,
  data: { size: 'medium', type: 'humanoid' }
});

runEditorContract('MonsterEditor', MonsterEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

describe('MonsterEditor (unique)', () => {
  // Locks the actions/traits JSON validation gate. A non-array in either
  // textarea must disable Save — protects monsterDerive() from being asked
  // to iterate a non-array.
  it('disables Save when actions textarea is not a JSON array', async () => {
    const { getByRole } = render(MonsterEditor, {
      props: { item: { ...emptyItem(), slug: 'pre', name: 'Pre' } }
    });
    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    // The two JSON textareas are the only ones whose default value starts
    // with '['. Pick either and stuff a non-array value in.
    const jsonTa = textareas.find((t) => t.value.startsWith('['));
    expect(jsonTa).toBeDefined();
    await fireEvent.input(jsonTa!, { target: { value: '"not an array"' } });

    expect((getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
