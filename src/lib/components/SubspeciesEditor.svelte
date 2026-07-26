<script lang="ts">
  // Structured editor for kind='subspecies' homebrew rows. Subspecies extend a
  // parent species with additional traits, ability overrides, and proficiencies.

  import EditorShell, { type Visibility } from './EditorShell.svelte';
  import EditorField from './EditorField.svelte';

  type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  type Trait = { name: string; description: string };
  type SubspeciesData = {
    parentSpecies?: string;
    description?: string;
    abilityBonuses?: Partial<Record<AbilityKey, number>>;
    darkvision?: number;
    traits?: Trait[];
    additionalProficiencies?: string[];
    [k: string]: unknown;
  };

  export let item: {
    kind: string;
    slug: string;
    name: string;
    visibility?: Visibility;
    data: SubspeciesData;
  } = { kind: 'subspecies', slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ABILITY_LABELS: Record<AbilityKey, string> = {
    str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA'
  };

  // ---- form state ----
  let parentSpecies = item.data.parentSpecies ?? '';
  let description = item.data.description ?? '';
  let darkvision = item.data.darkvision ?? 0;
  let abilityBonuses: Record<AbilityKey, number> = {
    str: item.data.abilityBonuses?.str ?? 0,
    dex: item.data.abilityBonuses?.dex ?? 0,
    con: item.data.abilityBonuses?.con ?? 0,
    int: item.data.abilityBonuses?.int ?? 0,
    wis: item.data.abilityBonuses?.wis ?? 0,
    cha: item.data.abilityBonuses?.cha ?? 0
  };
  let traits: Trait[] = (item.data.traits ?? []).map((t) => ({ ...t }));
  let proficienciesRaw = (item.data.additionalProficiencies ?? []).join(', ');

  // ---- trait helpers ----
  function addTrait() {
    traits = [...traits, { name: '', description: '' }];
  }
  function removeTrait(i: number) {
    traits = traits.filter((_, idx) => idx !== i);
  }

  function csv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  // ---- assemble payload ----
  function buildData(): Record<string, unknown> {
    const bonusEntries = ABILITY_KEYS.filter((k) => abilityBonuses[k] !== 0);
    const data: SubspeciesData = {
      ...(parentSpecies.trim() ? { parentSpecies: parentSpecies.trim() } : {}),
      ...(description ? { description } : {}),
      ...(bonusEntries.length > 0
        ? { abilityBonuses: Object.fromEntries(bonusEntries.map((k) => [k, abilityBonuses[k]])) }
        : {}),
      ...(darkvision > 0 ? { darkvision } : {}),
      ...(traits.length > 0 ? { traits: traits.filter((t) => t.name.trim()) } : {}),
      ...(proficienciesRaw.trim() ? { additionalProficiencies: csv(proficienciesRaw) } : {})
    };
    return data;
  }
</script>

<EditorShell {item} {isEdit} {busy} {errorMessage} {buildData} on:save on:cancel on:delete>
  <div class="mt-3 grid gap-3 sm:grid-cols-2">
    <EditorField
      class="sm:col-span-2"
      label="Parent species (slug)"
      mono
      maxlength={64}
      placeholder="e.g. elf, dwarf"
      bind:value={parentSpecies}
    />
  </div>

  <EditorField class="mt-3" label="Description" type="textarea" rows={4} maxlength={8000} bind:value={description} />

  <!-- Ability score overrides -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Ability score overrides</legend>
    <p class="mt-1 text-xs text-slate-500">Overrides the parent species bonuses. Leave all at 0 to inherit parent bonuses.</p>
    <div class="mt-2 grid grid-cols-6 gap-2">
      {#each ABILITY_KEYS as key}
        <label class="block text-center text-xs">
          <span class="mb-1 block text-slate-400">{ABILITY_LABELS[key]}</span>
          <input
            type="number"
            min="0"
            max="2"
            class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-center text-sm"
            bind:value={abilityBonuses[key]}
          />
        </label>
      {/each}
    </div>
  </fieldset>

  <!-- Additional darkvision -->
  <label class="mt-4 block text-xs">
    <span class="mb-1 block text-slate-400">Additional darkvision (ft; 0 = none)</span>
    <input
      type="number"
      min="0"
      max="300"
      step="30"
      class="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
      bind:value={darkvision}
    />
  </label>

  <!-- Additional traits -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Additional traits</legend>
    {#if traits.length === 0}
      <p class="text-xs text-slate-500">No additional traits. Add one below.</p>
    {/if}
    <div class="divide-y divide-slate-800">
      {#each traits as trait, i (i)}
        <div class="py-3">
          <div class="flex items-start gap-2">
            <EditorField class="flex-1" label="Trait name" maxlength={200} bind:value={trait.name} />
            <button
              type="button"
              class="mt-5 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
              on:click={() => removeTrait(i)}
              aria-label="Remove trait"
            >×</button>
          </div>
          <EditorField class="mt-2" label="Description" type="textarea" rows={3} maxlength={4000} bind:value={trait.description} />
        </div>
      {/each}
    </div>
    <button
      type="button"
      class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
      on:click={addTrait}
    >+ Add trait</button>
  </fieldset>

  <!-- Additional proficiencies -->
  <EditorField
    class="mt-4"
    label="Additional proficiencies (comma-separated skills/tools)"
    mono
    placeholder="e.g. perception, thieves-tools"
    bind:value={proficienciesRaw}
  />
</EditorShell>
