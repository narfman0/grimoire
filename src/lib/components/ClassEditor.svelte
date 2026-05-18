<script lang="ts">
  // Structured editor for homebrew D&D 5e classes.
  // Field structure mirrors what a ClassDataSchema would expect so that a
  // save round-trips cleanly with the homebrew API.

  import { createEventDispatcher } from 'svelte';

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
    visibility?: 'private' | 'unlisted' | 'public';
    data: ClassData;
  } = { slug: '', name: '', visibility: 'private', data: {} };

  /** True when editing an existing row — locks the slug and shows Delete. */
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: 'private' | 'unlisted' | 'public'; data: ClassData };
    cancel: void;
    delete: void;
  }>();

  const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;
  const HIT_DICE = ['d6', 'd8', 'd10', 'd12'] as const;
  const ARMOR_PROFS = ['Light', 'Medium', 'Heavy', 'Shield'] as const;
  const WEAPON_PROFS = ['Simple', 'Martial'] as const;
  const CASTER_TYPES = ['full', 'half', 'third', 'pact'] as const;
  const SPELLCASTING_ABILITIES = ['None', 'INT', 'WIS', 'CHA'] as const;

  // ---- form state ----
  let name = item.name;
  let slug = item.slug;
  let visibility: 'private' | 'unlisted' | 'public' = item.visibility ?? 'private';
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

  // ---- slug auto-generation ----
  function kebab(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }
  let slugManuallyEdited = isEdit;
  function onNameInput(e: Event) {
    const el = e.target as HTMLInputElement;
    name = el.value;
    if (!slugManuallyEdited) slug = kebab(name);
  }
  function onSlugInput(e: Event) {
    const el = e.target as HTMLInputElement;
    slug = el.value;
    slugManuallyEdited = true;
  }

  // ---- proficiency checkbox helpers ----
  function toggleProf(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
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
  function onSave() {
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
    dispatch('save', { slug, name, visibility, data });
  }
</script>

<div class="rounded-lg border border-slate-700 bg-slate-950 p-4">
  {#if errorMessage}
    <p class="mb-3 rounded border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{errorMessage}</p>
  {/if}

  <!-- Basic fields -->
  <div class="grid gap-3 sm:grid-cols-2">
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Name</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        value={name}
        on:input={onNameInput}
        maxlength="200"
      />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Slug{isEdit ? ' (locked)' : ''}</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm disabled:opacity-60"
        value={slug}
        on:input={onSlugInput}
        disabled={isEdit}
        maxlength="64"
      />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Visibility</span>
      <select
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={visibility}
      >
        <option value="private">Private</option>
        <option value="unlisted">Unlisted</option>
        <option value="public">Public</option>
      </select>
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Hit Die</span>
      <select
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={hitDie}
      >
        {#each HIT_DICE as d}
          <option value={d}>{d}</option>
        {/each}
      </select>
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Primary Ability</span>
      <select
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={primaryAbility}
      >
        {#each ABILITIES as a}
          <option value={a}>{a}</option>
        {/each}
      </select>
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Source (optional)</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={source}
        maxlength="200"
        placeholder="e.g. Player's Handbook"
      />
    </label>
  </div>

  <label class="mt-3 block text-xs">
    <span class="mb-1 block text-slate-400">Description</span>
    <textarea
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
      rows="4"
      bind:value={description}
      maxlength="8000"
    />
  </label>

  <!-- Saving Throws -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Saving Throws</legend>
    <div class="mt-2 grid gap-3 sm:grid-cols-2">
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Saving Throw 1</span>
        <select
          class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={savingThrow1}
        >
          {#each ABILITIES as a}
            <option value={a}>{a}</option>
          {/each}
        </select>
      </label>
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Saving Throw 2</span>
        <select
          class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={savingThrow2}
        >
          {#each ABILITIES as a}
            <option value={a}>{a}</option>
          {/each}
        </select>
      </label>
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
        <label class="block text-xs">
          <span class="mb-1 block text-slate-400">Spellcasting Ability</span>
          <select
            class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            bind:value={spellcastingAbility}
          >
            {#each SPELLCASTING_ABILITIES as a}
              <option value={a}>{a}</option>
            {/each}
          </select>
        </label>
        {#if spellcastingAbility !== 'None'}
          <label class="block text-xs">
            <span class="mb-1 block text-slate-400">Caster Type</span>
            <select
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              bind:value={casterType}
            >
              {#each CASTER_TYPES as t}
                <option value={t}>{t}</option>
              {/each}
            </select>
          </label>
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

  <!-- Actions -->
  <div class="mt-4 flex items-center gap-2">
    <button
      type="button"
      class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
      on:click={onSave}
      disabled={busy || !name.trim() || !slug.trim()}
    >Save</button>
    <button
      type="button"
      class="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
      on:click={() => dispatch('cancel')}
      disabled={busy}
    >Cancel</button>
    {#if isEdit}
      <button
        type="button"
        class="ml-auto rounded border border-red-800 px-3 py-1 text-sm text-red-200 hover:bg-red-950"
        on:click={() => dispatch('delete')}
        disabled={busy}
      >Delete</button>
    {/if}
  </div>
</div>
