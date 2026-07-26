// Maps a homebrew content kind to its structured editor component. Kinds
// without a structured editor fall back to GenericContentEditor (JSON
// textarea). Used by /me/homebrew/[kind]/new and /me/homebrew/[kind]/[slug].

import type { ComponentType } from 'svelte';
import BackgroundEditor from './BackgroundEditor.svelte';
import ClassEditor from './ClassEditor.svelte';
import ConditionEditor from './ConditionEditor.svelte';
import FeatEditor from './FeatEditor.svelte';
import FeatureEditor from './FeatureEditor.svelte';
import GenericContentEditor from './GenericContentEditor.svelte';
import ItemEditor from './ItemEditor.svelte';
import MonsterEditor from './MonsterEditor.svelte';
import SpeciesEditor from './SpeciesEditor.svelte';
import SpellEditor from './SpellEditor.svelte';
import SubclassEditor from './SubclassEditor.svelte';
import SubspeciesEditor from './SubspeciesEditor.svelte';

export const EDITORS: Record<string, ComponentType> = {
  background: BackgroundEditor,
  class: ClassEditor,
  condition: ConditionEditor,
  feat: FeatEditor,
  feature: FeatureEditor,
  item: ItemEditor,
  monster: MonsterEditor,
  species: SpeciesEditor,
  spell: SpellEditor,
  subclass: SubclassEditor,
  subspecies: SubspeciesEditor
};

/** Editor component for `kind`, falling back to the JSON editor. */
export function editorFor(kind: string): ComponentType {
  return EDITORS[kind] ?? GenericContentEditor;
}
