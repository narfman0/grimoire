<script lang="ts">
  // Structured form for authoring / editing a homebrew background. Field
  // structure mirrors the D&D 5e background schema: skill proficiencies,
  // tool proficiencies, languages, starting equipment, and a background
  // feature (special trait granted to all characters with this background).

  import { createEventDispatcher } from 'svelte';
  import { SKILLS } from '$lib/rules/skills';

  type BackgroundData = {
    description?: string;
    skillProficiencies?: string[];
    toolProficiencies?: string[];
    languages?: number | string[];
    equipment?: string;
    featureName?: string;
    featureDescription?: string;
  };

  export let item: {
    slug: string;
    name: string;
    visibility?: 'private' | 'unlisted' | 'public';
    data: BackgroundData;
  } = { slug: '', name: '', visibility: 'private', data: {} };
  /** True when editing an existing row — locks the slug and shows Delete. */
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: 'private' | 'unlisted' | 'public'; data: BackgroundData };
    cancel: void;
    delete: void;
  }>();

  // Display labels matching the prompt (title-cased) for the 18 skills.
  // The SKILLS array uses kebab-case slugs; we derive labels from them.
  function skillLabel(slug: string): string {
    return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ---- form state (local copies; flushed back into a clean payload on save) ----
  let name = item.name;
  let slug = item.slug;
  let visibility: 'private' | 'unlisted' | 'public' = item.visibility ?? 'private';
  let description = item.data.description ?? '';
  let skillProficiencies: string[] = (item.data.skillProficiencies ?? []).slice();
  let toolProficienciesRaw = Array.isArray(item.data.toolProficiencies)
    ? item.data.toolProficiencies.join(', ')
    : '';
  let equipment = item.data.equipment ?? '';
  let featureName = item.data.featureName ?? '';
  let featureDescription = item.data.featureDescription ?? '';

  // Languages: if it's a number we show the bonus-language count; if it's a
  // string array we show the comma-separated specific languages. The toggle
  // lets the author switch modes.
  const existingLangs = item.data.languages;
  let langMode: 'bonus' | 'specific' = Array.isArray(existingLangs) ? 'specific' : 'bonus';
  let langBonus: number = typeof existingLangs === 'number' ? existingLangs : 1;
  let langSpecificRaw: string = Array.isArray(existingLangs) ? existingLangs.join(', ') : '';

  // ---- slug auto-generation from name (only when creating) ----
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

  function toggleSkill(skill: string) {
    skillProficiencies = skillProficiencies.includes(skill)
      ? skillProficiencies.filter((s) => s !== skill)
      : [...skillProficiencies, skill];
  }

  function csv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  // ---- assemble payload + dispatch save ----
  function onSave() {
    const toolProficiencies = csv(toolProficienciesRaw);
    const languages: number | string[] =
      langMode === 'bonus' ? langBonus : csv(langSpecificRaw);

    const data: BackgroundData = {
      ...(description ? { description } : {}),
      ...(skillProficiencies.length > 0 ? { skillProficiencies } : {}),
      ...(toolProficiencies.length > 0 ? { toolProficiencies } : {}),
      ...(langMode === 'bonus'
        ? langBonus > 0 ? { languages: langBonus } : {}
        : csv(langSpecificRaw).length > 0 ? { languages: csv(langSpecificRaw) } : {}),
      ...(equipment ? { equipment } : {}),
      ...(featureName ? { featureName } : {}),
      ...(featureDescription ? { featureDescription } : {})
    };
    dispatch('save', { slug, name, visibility, data });
  }
</script>

<div class="rounded-lg border border-slate-700 bg-slate-950 p-4">
  {#if errorMessage}
    <p class="mb-3 rounded border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{errorMessage}</p>
  {/if}

  <!-- Name / Slug / Visibility -->
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
    <label class="block text-xs sm:col-span-2">
      <span class="mb-1 block text-slate-400">Visibility</span>
      <select
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={visibility}
      >
        <option value="private">Private — only you see it on your characters</option>
        <option value="unlisted">Unlisted — anyone with the URL can view</option>
        <option value="public">Public — surfaced in /homebrew/browse</option>
      </select>
    </label>
  </div>

  <!-- Description -->
  <label class="mt-3 block text-xs">
    <span class="mb-1 block text-slate-400">Description</span>
    <textarea
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
      rows="4"
      bind:value={description}
      maxlength="8000"
    />
  </label>

  <!-- Skill Proficiencies -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Skill Proficiencies</legend>
    <p class="mb-2 text-xs text-slate-500">Select up to 2 skills granted by this background.</p>
    <div class="flex flex-wrap gap-1">
      {#each SKILLS as skill}
        <label
          class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] {skillProficiencies.includes(skill) ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}"
        >
          <input
            type="checkbox"
            class="hidden"
            checked={skillProficiencies.includes(skill)}
            on:change={() => toggleSkill(skill)}
          />
          {skillLabel(skill)}
        </label>
      {/each}
    </div>
  </fieldset>

  <!-- Tool Proficiencies -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Tool Proficiencies</legend>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Tools granted (comma-separated; freeform)</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm"
        bind:value={toolProficienciesRaw}
        placeholder="e.g. thieves-tools, herbalism-kit"
      />
    </label>
  </fieldset>

  <!-- Languages -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Languages</legend>
    <div class="mb-2 flex gap-4 text-xs">
      <label class="flex items-center gap-1.5">
        <input type="radio" bind:group={langMode} value="bonus" />
        <span>Bonus language count</span>
      </label>
      <label class="flex items-center gap-1.5">
        <input type="radio" bind:group={langMode} value="specific" />
        <span>Specific languages</span>
      </label>
    </div>
    {#if langMode === 'bonus'}
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Number of bonus languages the character may learn</span>
        <input
          type="number"
          min="0"
          max="10"
          class="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={langBonus}
        />
      </label>
    {:else}
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Specific languages granted (comma-separated)</span>
        <input
          type="text"
          class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm"
          bind:value={langSpecificRaw}
          placeholder="e.g. elvish, draconic"
        />
      </label>
    {/if}
  </fieldset>

  <!-- Equipment -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Starting Equipment</legend>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Equipment description (freeform)</span>
      <textarea
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        rows="3"
        bind:value={equipment}
        maxlength="4000"
        placeholder="e.g. A set of fine clothes, a signet ring, and a purse containing 25 gp"
      />
    </label>
  </fieldset>

  <!-- Background Feature -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Background Feature</legend>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Feature name</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={featureName}
        maxlength="200"
        placeholder="e.g. By Popular Demand"
      />
    </label>
    <label class="mt-2 block text-xs">
      <span class="mb-1 block text-slate-400">Feature description</span>
      <textarea
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        rows="4"
        bind:value={featureDescription}
        maxlength="8000"
        placeholder="Describe the special trait this background grants…"
      />
    </label>
  </fieldset>

  <!-- Action buttons -->
  <div class="mt-4 flex items-center gap-2">
    <button
      type="button"
      class="rounded bg-amber-600 px-3 py-1 text-sm font-medium hover:bg-amber-500 disabled:opacity-40"
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
