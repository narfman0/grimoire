<script lang="ts">
  // Structured editor for homebrew subclass entries.
  // data.spells mirrors the pack loader format: Array<{ level: number; spells: string[] }>
  // data.subclassFeatures: Array<{ name: string; level: number; slug?: string }>

  import { createEventDispatcher } from 'svelte';

  type SpellEntry = { level: number; spells: string[] };
  type FeatureRef = { name: string; level: number; slug?: string };

  export let item: {
    slug: string;
    name: string;
    visibility?: 'private' | 'unlisted' | 'public';
    data: {
      parentClass?: string;
      source?: string;
      description?: string;
      spells?: SpellEntry[];
      subclassFeatures?: FeatureRef[];
    };
  } = { slug: '', name: '', visibility: 'private', data: {} };

  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: {
      slug: string;
      name: string;
      visibility: 'private' | 'unlisted' | 'public';
      data: {
        parentClass?: string;
        source?: string;
        description?: string;
        spells?: SpellEntry[];
        subclassFeatures?: FeatureRef[];
      };
    };
    cancel: void;
    delete: void;
  }>();

  // ---- form state ----
  let name = item.name;
  let slug = item.slug;
  let visibility: 'private' | 'unlisted' | 'public' = item.visibility ?? 'private';
  let parentClass = item.data.parentClass ?? '';
  let source = item.data.source ?? '';
  let description = item.data.description ?? '';

  // Spell list section
  let spells: Array<{ level: number; spellsRaw: string }> = (item.data.spells ?? []).map((e) => ({
    level: e.level,
    spellsRaw: (e.spells ?? []).join(', ')
  }));
  let spellsOpen = spells.length > 0;

  // Subclass features section
  let features: FeatureRef[] = (item.data.subclassFeatures ?? []).map((f) => ({ ...f }));
  let featuresOpen = features.length > 0;

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

  // ---- spell list helpers ----
  function addSpellLevel() {
    spells = [...spells, { level: 1, spellsRaw: '' }];
  }
  function removeSpellEntry(i: number) {
    spells = spells.filter((_, idx) => idx !== i);
  }
  function csv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  // ---- feature helpers ----
  function addFeature() {
    features = [...features, { name: '', level: 1, slug: '' }];
  }
  function removeFeature(i: number) {
    features = features.filter((_, idx) => idx !== i);
  }

  // ---- save ----
  function onSave() {
    const spellData: SpellEntry[] = spells
      .map((e) => ({ level: e.level, spells: csv(e.spellsRaw) }))
      .filter((e) => e.spells.length > 0);

    const featureData: FeatureRef[] = features
      .filter((f) => f.name.trim())
      .map((f) => ({
        name: f.name,
        level: f.level,
        ...(f.slug?.trim() ? { slug: f.slug.trim() } : {})
      }));

    const data: typeof item.data = {
      ...(parentClass.trim() ? { parentClass: parentClass.trim() } : {}),
      ...(source.trim() ? { source: source.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(spellData.length > 0 ? { spells: spellData } : {}),
      ...(featureData.length > 0 ? { subclassFeatures: featureData } : {})
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
      <span class="mb-1 block text-slate-400">Parent Class (slug)</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm"
        bind:value={parentClass}
        maxlength="64"
        placeholder="e.g. paladin, wizard"
      />
    </label>
    <label class="block text-xs sm:col-span-2">
      <span class="mb-1 block text-slate-400">Source (optional)</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={source}
        maxlength="200"
        placeholder="e.g. Player's Handbook, homebrew"
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

  <!-- Expanded Spell List (collapsible) -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">
      <button
        type="button"
        class="flex items-center gap-1 hover:text-slate-200"
        on:click={() => (spellsOpen = !spellsOpen)}
      >
        <span>{spellsOpen ? '▾' : '▸'}</span>
        Expanded Spell List
        {#if !spellsOpen && spells.length > 0}
          <span class="ml-1 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-normal">{spells.length}</span>
        {/if}
      </button>
    </legend>
    {#if spellsOpen}
      {#if spells.length === 0}
        <p class="text-xs text-slate-500">No expanded spells. Add a spell level below.</p>
      {/if}
      {#each spells as entry, i (i)}
        <div class="mt-2 grid grid-cols-12 gap-2 items-end">
          <label class="col-span-2 block text-xs">
            <span class="mb-1 block text-slate-400">Level</span>
            <select
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              bind:value={entry.level}
            >
              {#each [1,2,3,4,5,6,7,8,9] as lvl}
                <option value={lvl}>{lvl}</option>
              {/each}
            </select>
          </label>
          <label class="col-span-9 block text-xs">
            <span class="mb-1 block text-slate-400">Spells (comma-separated slugs)</span>
            <input
              type="text"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
              bind:value={entry.spellsRaw}
              placeholder="e.g. cure-wounds, bless"
            />
          </label>
          <button
            type="button"
            class="col-span-1 mb-0.5 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
            on:click={() => removeSpellEntry(i)}
            aria-label="Remove spell level"
          >×</button>
        </div>
      {/each}
      <button
        type="button"
        class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
        on:click={addSpellLevel}
      >+ Add spell level</button>
    {/if}
  </fieldset>

  <!-- Subclass Features (collapsible) -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">
      <button
        type="button"
        class="flex items-center gap-1 hover:text-slate-200"
        on:click={() => (featuresOpen = !featuresOpen)}
      >
        <span>{featuresOpen ? '▾' : '▸'}</span>
        Subclass Features
        {#if !featuresOpen && features.length > 0}
          <span class="ml-1 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-normal">{features.length}</span>
        {/if}
      </button>
    </legend>
    {#if featuresOpen}
      {#if features.length === 0}
        <p class="text-xs text-slate-500">No features. Add one below.</p>
      {/if}
      {#each features as feat, i (i)}
        <div class="mt-2 grid grid-cols-12 gap-2 items-end">
          <label class="col-span-5 block text-xs">
            <span class="mb-1 block text-slate-400">Feature Name</span>
            <input
              type="text"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              bind:value={feat.name}
              maxlength="200"
              placeholder="e.g. Sacred Oath"
            />
          </label>
          <label class="col-span-2 block text-xs">
            <span class="mb-1 block text-slate-400">Level</span>
            <input
              type="number"
              min="1"
              max="20"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              bind:value={feat.level}
            />
          </label>
          <label class="col-span-4 block text-xs">
            <span class="mb-1 block text-slate-400">Feature Slug (optional)</span>
            <input
              type="text"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
              bind:value={feat.slug}
              maxlength="64"
              placeholder="e.g. sacred-oath"
            />
          </label>
          <button
            type="button"
            class="col-span-1 mb-0.5 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
            on:click={() => removeFeature(i)}
            aria-label="Remove feature"
          >×</button>
        </div>
      {/each}
      <button
        type="button"
        class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
        on:click={addFeature}
      >+ Add feature</button>
    {/if}
  </fieldset>

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
