import FeatEditor from './FeatEditor.svelte';
import { runEditorContract } from './__tests__/editor-contract';

const emptyFeat = () => ({ slug: '', name: '', visibility: 'private' as const, data: {} });
const editFeat = () => ({
  slug: 'great-weapon-master',
  name: 'Great Weapon Master',
  visibility: 'private' as const,
  data: { category: 'General' }
});

// FeatEditor names its seed prop `feat` (not `item`); the contract helper
// supports custom prop builders.
runEditorContract('FeatEditor', FeatEditor, ({ isEdit }) => ({
  feat: isEdit ? editFeat() : emptyFeat(),
  isEdit
}));

// The unique surface (modifier rows + choice toggles + ASI ability picker)
// is deep. Family contract above already locks the highest-leverage seams;
// add focused assertions here when a regression names a specific seam.
