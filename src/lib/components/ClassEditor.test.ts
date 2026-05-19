import ClassEditor from './ClassEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({ slug: '', name: '', visibility: 'private' as const, data: {} });
const editItem = () => ({
  slug: 'barbarian',
  name: 'Barbarian',
  visibility: 'private' as const,
  data: { hitDie: 'd12', primaryAbility: 'STR' }
});

runEditorContract('ClassEditor', ClassEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

// Class-specific saving-throws / proficiencies / spell progression are
// covered structurally by the editor-contract tests above. Add focused
// assertions here when a regression names a specific seam.
