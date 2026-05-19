import FeatureEditor from './FeatureEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyItem = () => ({ slug: '', name: '', visibility: 'private' as const, data: {} });
const editItem = () => ({
  slug: 'rage',
  name: 'Rage',
  visibility: 'private' as const,
  data: { ownerKind: 'class', ownerSlug: 'barbarian', minLevel: 1 }
});

runEditorContract('FeatureEditor', FeatureEditor, ({ isEdit }) => ({
  item: isEdit ? editItem() : emptyItem(),
  isEdit
}));

// FeatureEditor's unique surface (modifiers/triggers expansion) is deep;
// the contract tests already lock save gating + slug + delete. Add focused
// expansion tests here when a regression demands them.
