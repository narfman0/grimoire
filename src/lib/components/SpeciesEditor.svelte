<script lang="ts">
  // Structured editor for kind='species' homebrew rows. Field structure
  // mirrors the species data shape consumed by the character derive pipeline.

  import { createEventDispatcher } from 'svelte';

  type Visibility = 'private' | 'unlisted' | 'public';
  type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  type Trait = { name: string; description: string };
  type SpeciesData = {
    description?: string;
    size?: string;
    speed?: number;
    darkvision?: number;
    abilityBonuses?: Partial<Record<AbilityKey, number>>;
    languages?: string[];
    traits?: Trait[];
    [k: string]: unknown;
  };

  export let item: {
    kind: string;
    slug: string;
    name: string;
    visibility?: Visibility;
    data: SpeciesData;
  } = { kind: 'species', slug: '', name: '', visibility: 'private', data: {} };
  /** True when editing an existing row — locks the slug and shows Delete. */
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: Visibility; data: SpeciesData };
    cancel: void;
    delete: void;
  }>();

  const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
  const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ABILITY_LABELS: Record<AbilityKey, string> = {
    str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA'
  };

  // ---- form state ----
  let name = item.name;
  let slug = item.slug;
  let visibility: Visibility = item.visibility ?? 'private';
  let description = item.data.description ?? '';
  let size = item.data.size ?? 'Medium';
  let speed = item.data.speed ?? 30;
  let darkvision = item.data.darkvision ?? 0;
  let abilityBonuses: Record<AbilityKey, number> = {
    str: item.data.abilityBonuses?.str ?? 0,
    dex: item.data.abilityBonuses?.dex ?? 0,
    con: item.data.abilityBonuses?.con ?? 0,
    int: item.data.abilityBonuses?.int ?? 0,
    wis: item.data.abilityBonuses?.wis ?? 0,
    cha: item.data.abilityBonuses?.cha ?? 0,
  };
  let languagesRaw = (item.data.languages ?? []).join(', ');
  let traits: Trait[] = (item.data.traits ?? []).map((t) => ({ ...t }));

  // ---- slug auto-generation ----
  function kebab(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
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

  // ---- assemble payload + dispatch save ----
  function onSave() {
    const bonusEntries = ABILITY_KEYS.filter((k) => abilityBonuses[k] !== 0);
    const data: SpeciesData = {
      ...(description ? { description } : {}),
      size,
      speed,
      ...(darkvision > 0 ? { darkvision } : {}),
      ...(bonusEntries.length > 0
        ? { abilityBonuses: Object.fromEntries(bonusEntries.map((k) => [k, abilityBonuses[k]])) }
        : {}),
      ...(languagesRaw.trim() ? { languages: csv(languagesRaw) } : {}),
      ...(traits.length > 0 ? { traits: traits.filter((t) => t.name.trim()) } : {}),
    };
    dispatch('save', { slug, name, visibility, data });
  }
</script>

<div class="rounded-lg border border-slate-700 bg-slate-950 p-4">
  {#if errorMessage}
    <p class="mb-3 rounded border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{errorMessage}</p>
  {/if}

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

  <!-- Physical traits -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Physical traits</legend>
    <div class="mt-2 grid gap-3 sm:grid-cols-3">
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Size</span>
        <select
          class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={size}
        >
          {#each SIZES as s}
            <option value={s}>{s}</option>
          {/each}
        </select>
      </label>
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Speed (ft)</span>
        <input
          type="number"
          min="0"
          max="300"
          step="5"
          class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={speed}
        />
      </label>
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Darkvision (ft; 0 = none)</span>
        <input
          type="number"
          min="0"
          max="300"
          step="30"
          class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={darkvision}
        />
      </label>
    </div>
  </fieldset>

  <!-- Ability score increases -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Ability score increases</legend>
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

  <!-- Languages -->
  <label class="mt-4 block text-xs">
    <span class="mb-1 block text-slate-400">Languages (comma-separated)</span>
    <input
      type="text"
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm"
      bind:value={languagesRaw}
      placeholder="e.g. Common, Elvish"
    />
  </label>

  <!-- Traits -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Racial traits</legend>
    {#if traits.length === 0}
      <p class="text-xs text-slate-500">No traits yet. Add one below.</p>
    {/if}
    <div class="divide-y divide-slate-800">
      {#each traits as trait, i (i)}
        <div class="py-3">
          <div class="flex items-start gap-2">
            <label class="block flex-1 text-xs">
              <span class="mb-1 block text-slate-400">Trait name</span>
              <input
                type="text"
                class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                bind:value={trait.name}
                maxlength="200"
              />
            </label>
            <button
              type="button"
              class="mt-5 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
              on:click={() => removeTrait(i)}
              aria-label="Remove trait"
            >×</button>
          </div>
          <label class="mt-2 block text-xs">
            <span class="mb-1 block text-slate-400">Description</span>
            <textarea
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              rows="3"
              bind:value={trait.description}
              maxlength="4000"
            />
          </label>
        </div>
      {/each}
    </div>
    <button
      type="button"
      class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
      on:click={addTrait}
    >+ Add trait</button>
  </fieldset>

  <!-- Visibility -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Visibility</legend>
    <div class="space-y-1 text-xs">
      <label class="block">
        <input type="radio" bind:group={visibility} value="private" />
        <span class="ml-1">Private</span>
        <span class="ml-1 text-slate-500">— only you see it on your characters</span>
      </label>
      <label class="block">
        <input type="radio" bind:group={visibility} value="unlisted" />
        <span class="ml-1">Unlisted</span>
        <span class="ml-1 text-slate-500">— anyone with the URL can view, hidden from the marketplace index</span>
      </label>
      <label class="block">
        <input type="radio" bind:group={visibility} value="public" />
        <span class="ml-1">Public</span>
        <span class="ml-1 text-slate-500">— surfaced in /homebrew/browse; other users can subscribe or fork</span>
      </label>
    </div>
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
