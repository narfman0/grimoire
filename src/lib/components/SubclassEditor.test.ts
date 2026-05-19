import SubclassEditor from './SubclassEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({ slug: '', name: '', visibility: 'private' as const, data: {} });
const editItem = () => ({
  slug: 'evocation',
  name: 'School of Evocation',
  visibility: 'private' as const,
  data: { parentClass: 'wizard' }
});

runEditorContract('SubclassEditor', SubclassEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

// Family contract covers save gating + slug + delete; subclass-specific
// spells/features arrays use similar passthrough patterns and don't warrant
// a separate assertion until a regression names a seam.
