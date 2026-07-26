<script lang="ts">
  // Structured editor for homebrew D&D 5e classes.
  // Field structure mirrors what a ClassDataSchema would expect so that a
  // save round-trips cleanly with the homebrew API.

  import EditorShell, { type Visibility } from './EditorShell.svelte';
  import EditorField from './EditorField.svelte';

  type ClassFeature = { name: string; level: number; slug?: string };

  type ClassData = {
    description?: string;
    hitDie?: string;
    primaryAbility?: string;
    source?: string;
    savingThrows?: string[];
    armorProficiencies?: string[];
    weaponProficiencies?: string[];
    skillChoices?: number;
    spellcastingAbility?: string;
    casterType?: string;
    classFeatures?: ClassFeature[];
  };

  export let item: {
    slug: string;
    name: string;
    visibility?: Visibility;
    data: ClassData;
  } = { slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const HIT_DICE = ['d6', 'd8', 'd10', 'd12'];
  const ARMOR_PROFS = ['Light', 'Medium', 'Heavy', 'Shield'] as const;
  const WEAPON_PROFS = ['Simple', 'Martial'] as const;
  const CASTER_TYPES = ['full', 'half', 'third', 'pact'];
  const SPELLCASTING_ABILITIES = ['None', 'INT', 'WIS', 'CHA'];

  // ---- form state ----
  let description = item.data.description ?? '';
  let hitDie = item.data.hitDie ?? 'd8';
  let primaryAbility = item.data.primaryAbility ?? 'STR';
  let source = item.data.source ?? '';

  // Saving throws — stored as two separate selects, serialized as string[]
  const st = item.data.savingThrows ?? ['STR', 'CON'];
  let savingThrow1 = st[0] ?? 'STR';
  let savingThrow2 = st[1] ?? 'CON';

  // Proficiencies
  let armorProficiencies: string[] = (item.data.armorProficiencies ?? []).slice();
  let weaponProficiencies: string[] = (item.data.weaponProficiencies ?? []).slice();
  let skillChoices: number = item.data.skillChoices ?? 2;

  // Spellcasting (collapsible)
  let spellcastingOpen = !!(item.data.spellcastingAbility || item.data.casterType);
  let spellcastingAbility: string = item.data.spellcastingAbility ?? 'None';
  let casterType: string = item.data.casterType ?? 'full';

  // Class features (collapsible)
  let featuresOpen = (item.data.classFeatures ?? []).length > 0;
  let classFeatures: ClassFeature[] = (item.data.classFeatures ?? []).map((f) => ({ ...f }));

  // ---- proficiency checkbox helpers ----
  function toggleProf(list: string[], entry: string): string[] {
    return list.includes(entry) ? list.filter((x) => x !== entry) : [...list, entry];
  }

  // ---- class feature helpers ----
  function addFeature() {
    classFeatures = [...classFeatures, { name: '', level: 1 }];
    featuresOpen = true;
  }
  function removeFeature(i: number) {
    classFeatures = classFeatures.filter((_, idx) => idx !== i);
  }

  // ---- save ----
  function buildData(): Record<string, unknown> {
    const data: ClassData = {
      ...(description ? { description } : {}),
      hitDie,
      primaryAbility,
      ...(source ? { source } : {}),
      savingThrows: [savingThrow1, savingThrow2],
      ...(armorProficiencies.length > 0 ? { armorProficiencies } : {}),
      ...(weaponProficiencies.length > 0 ? { weaponProficiencies } : {}),
      skillChoices,
      ...(spellcastingAbility !== 'None' ? { spellcastingAbility, casterType } : {}),
      ...(classFeatures.length > 0
        ? {
            classFeatures: classFeatures
              .filter((f) => f.name.trim())
              .map((f) => ({
                name: f.name.trim(),
                level: f.level,
                ...(f.slug?.trim() ? { slug: f.slug.trim() } : {})
              }))
          }
        : {})
    };
    return data;
  }
</script>

<EditorShell {item} {isEdit} {busy} {errorMessage} {buildData} on:save on:cancel on:delete>
  <!-- Basic fields -->
  <div class="mt-3 grid gap-3 sm:grid-cols-2">
    <EditorField label="Hit Die" type="select" options={HIT_DICE} bind:value={hitDie} />
    <EditorField label="Primary Ability" type="select" options={ABILITIES} bind:value={primaryAbility} />
    <EditorField
      class="sm:col-span-2"
      label="Source (optional)"
      maxlength={200}
      placeholder="e.g. Player's Handbook"
      bind:value={source}
    />
  </div>

  <EditorField class="mt-3" label="Description" type="textarea" rows={4} maxlength={8000} bind:value={description} />

  <!-- Saving Throws -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Saving Throws</legend>
    <div class="mt-2 grid gap-3 sm:grid-cols-2">
      <EditorField label="Saving Throw 1" type="select" options={ABILITIES} bind:value={savingThrow1} />
      <EditorField label="Saving Throw 2" type="select" options={ABILITIES} bind:value={savingThrow2} />
    </div>
  </fieldset>

  <!-- Proficiencies -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Proficiencies</legend>

    <div class="mt-2">
      <p class="mb-1 text-xs text-slate-400">Armor</p>
      <div class="flex flex-wrap gap-2">
        {#each ARMOR_PROFS as prof}
          <label
            class="cursor-pointer rounded border border-slate-700 px-2 py-0.5 text-xs {armorProficiencies.includes(prof)
              ? 'bg-emerald-900/40 text-emerald-200'
              : 'text-slate-400'}"
          >
            <input
              type="checkbox"
              class="hidden"
              checked={armorProficiencies.includes(prof)}
              on:change={() => (armorProficiencies = toggleProf(armorProficiencies, prof))}
            />
            {prof}
          </label>
        {/each}
      </div>
    </div>

    <div class="mt-3">
      <p class="mb-1 text-xs text-slate-400">Weapons</p>
      <div class="flex flex-wrap gap-2">
        {#each WEAPON_PROFS as prof}
          <label
            class="cursor-pointer rounded border border-slate-700 px-2 py-0.5 text-xs {weaponProficiencies.includes(prof)
              ? 'bg-emerald-900/40 text-emerald-200'
              : 'text-slate-400'}"
          >
            <input
              type="checkbox"
              class="hidden"
              checked={weaponProficiencies.includes(prof)}
              on:change={() => (weaponProficiencies = toggleProf(weaponProficiencies, prof))}
            />
            {prof}
          </label>
        {/each}
      </div>
    </div>

    <div class="mt-3">
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Skill choices (choose N from all skills)</span>
        <input
          type="number"
          min="0"
          max="10"
          class="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={skillChoices}
        />
      </label>
    </div>
  </fieldset>

  <!-- Spellcasting (collapsible) -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">
      <button
        type="button"
        class="flex items-center gap-1 hover:text-slate-200"
        on:click={() => (spellcastingOpen = !spellcastingOpen)}
      >
        <span>{spellcastingOpen ? '▾' : '▸'}</span>
        Spellcasting
        {#if spellcastingAbility !== 'None'}
          <span class="ml-1 rounded bg-slate-700 px-1 py-0.5 text-[10px] text-slate-300">
            {spellcastingAbility} · {casterType}
          </span>
        {/if}
      </button>
    </legend>

    {#if spellcastingOpen}
      <div class="mt-2 grid gap-3 sm:grid-cols-2">
        <EditorField label="Spellcasting Ability" type="select" options={SPELLCASTING_ABILITIES} bind:value={spellcastingAbility} />
        {#if spellcastingAbility !== 'None'}
          <EditorField label="Caster Type" type="select" options={CASTER_TYPES} bind:value={casterType} />
        {/if}
      </div>
    {/if}
  </fieldset>

  <!-- Class Features (collapsible) -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">
      <button
        type="button"
        class="flex items-center gap-1 hover:text-slate-200"
        on:click={() => (featuresOpen = !featuresOpen)}
      >
        <span>{featuresOpen ? '▾' : '▸'}</span>
        Class Features
        {#if classFeatures.length > 0}
          <span class="ml-1 rounded bg-slate-700 px-1 py-0.5 text-[10px] text-slate-300">
            {classFeatures.length}
          </span>
        {/if}
      </button>
    </legend>

    {#if featuresOpen}
      {#if classFeatures.length === 0}
        <p class="mt-2 text-xs text-slate-500">No features yet. Add one below.</p>
      {/if}
      {#each classFeatures as feature, i (i)}
        <div class="mt-3 grid grid-cols-12 gap-2">
          <div class="col-span-5 text-xs">
            <span class="mb-1 block text-slate-400">Feature Name</span>
            <input
              type="text"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              placeholder="e.g. Action Surge"
              bind:value={feature.name}
              maxlength="200"
            />
          </div>
          <div class="col-span-2 text-xs">
            <span class="mb-1 block text-slate-400">Level</span>
            <input
              type="number"
              min="1"
              max="20"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              bind:value={feature.level}
            />
          </div>
          <div class="col-span-4 text-xs">
            <span class="mb-1 block text-slate-400">Feature Slug (optional)</span>
            <input
              type="text"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
              placeholder="e.g. action-surge"
              bind:value={feature.slug}
              maxlength="64"
            />
          </div>
          <div class="col-span-1 flex items-end pb-1">
            <button
              type="button"
              class="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
              on:click={() => removeFeature(i)}
              aria-label="Remove feature"
            >×</button>
          </div>
        </div>
      {/each}
      <button
        type="button"
        class="mt-3 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
        on:click={addFeature}
      >+ Add feature</button>
    {/if}
  </fieldset>
</EditorShell>
