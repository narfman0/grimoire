<script lang="ts">
  // Structured editor for kind='spell' homebrew rows. Field structure
  // mirrors src/lib/server/content/schemas.ts:SpellDataSchema (passthrough,
  // so unknown extras round-trip) and the SRD spell shape — see
  // ~/workspace/dnd-5e-srd cantrips.json for canonical examples.
  //
  // Nested `activities` are edited via a JSON textarea — they're free-form
  // (attack/utility metadata) and the engine validates rows individually.

  import { createEventDispatcher } from 'svelte';

  type Visibility = 'private' | 'unlisted' | 'public';
  type SpellData = {
    level?: number;
    school?: string;
    castingTime?: string;
    range?: { value?: number; units?: string };
    components?: {
      verbal?: boolean;
      somatic?: boolean;
      material?: boolean;
      materialDescription?: string;
    };
    duration?: string;
    description?: string;
    activities?: unknown[];
    [k: string]: unknown;
  };

  export let item: {
    kind: string;
    slug: string;
    name: string;
    visibility?: Visibility;
    data: SpellData;
  } = { kind: 'spell', slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: Visibility; data: SpellData };
    cancel: void;
    delete: void;
  }>();

  const SCHOOLS = [
    'abjuration',
    'conjuration',
    'divination',
    'enchantment',
    'evocation',
    'illusion',
    'necromancy',
    'transmutation'
  ];
  const RANGE_UNITS = ['feet', 'miles', 'self', 'touch', 'sight', 'unlimited'];

  let name = item.name;
  let slug = item.slug;
  let visibility: Visibility = item.visibility ?? 'private';
  let level = item.data.level ?? 0;
  let school = item.data.school ?? '';
  let castingTime = item.data.castingTime ?? '';
  let rangeValue = item.data.range?.value ?? 0;
  let rangeUnits = item.data.range?.units ?? 'feet';
  let verbal = item.data.components?.verbal ?? false;
  let somatic = item.data.components?.somatic ?? false;
  let material = item.data.components?.material ?? false;
  let materialDescription = item.data.components?.materialDescription ?? '';
  let duration = item.data.duration ?? '';
  let description = item.data.description ?? '';
  // Activities go through a JSON sub-editor.
  let activitiesText = JSON.stringify(item.data.activities ?? [], null, 2);
  let activitiesError = '';

  $: {
    if (!activitiesText.trim()) {
      activitiesError = '';
    } else {
      try {
        const parsed = JSON.parse(activitiesText);
        activitiesError = Array.isArray(parsed) ? '' : 'must be a JSON array';
      } catch (e) {
        activitiesError = (e as Error).message;
      }
    }
  }

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

  function onSave() {
    let activities: unknown[] = [];
    if (activitiesText.trim()) {
      try {
        const parsed = JSON.parse(activitiesText);
        if (!Array.isArray(parsed)) {
          activitiesError = 'must be a JSON array';
          return;
        }
        activities = parsed;
      } catch (e) {
        activitiesError = (e as Error).message;
        return;
      }
    }

    const data: SpellData = {
      // Spread first so existing passthrough keys survive a save.
      ...item.data,
      level,
      ...(school ? { school } : {}),
      ...(castingTime ? { castingTime } : {}),
      ...(rangeUnits || rangeValue
        ? { range: { ...(rangeValue ? { value: rangeValue } : {}), ...(rangeUnits ? { units: rangeUnits } : {}) } }
        : {}),
      components: {
        ...(verbal ? { verbal: true } : {}),
        ...(somatic ? { somatic: true } : {}),
        ...(material ? { material: true } : {}),
        ...(materialDescription ? { materialDescription } : {})
      },
      ...(duration ? { duration } : {}),
      ...(description ? { description } : {}),
      ...(activities.length > 0 ? { activities } : {})
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

    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Level</span>
      <input
        type="number"
        min="0"
        max="9"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={level}
      />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">School</span>
      <select class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={school}>
        <option value="">(none)</option>
        {#each SCHOOLS as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </label>

    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Casting time</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={castingTime}
        maxlength="64"
        placeholder="e.g. 1 action"
      />
    </label>
    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Duration</span>
      <input
        type="text"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={duration}
        maxlength="64"
        placeholder="e.g. Instantaneous, 1 minute"
      />
    </label>

    <label class="block text-xs">
      <span class="mb-1 block text-slate-400">Range</span>
      <div class="flex gap-2">
        <input
          type="number"
          min="0"
          class="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={rangeValue}
        />
        <select class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={rangeUnits}>
          {#each RANGE_UNITS as u}
            <option value={u}>{u}</option>
          {/each}
        </select>
      </div>
    </label>
    <fieldset class="block text-xs">
      <span class="mb-1 block text-slate-400">Components</span>
      <div class="flex flex-wrap items-center gap-2">
        <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] uppercase tracking-wide {verbal ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
          <input type="checkbox" class="hidden" bind:checked={verbal} /> V
        </label>
        <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] uppercase tracking-wide {somatic ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
          <input type="checkbox" class="hidden" bind:checked={somatic} /> S
        </label>
        <label class="cursor-pointer rounded border border-slate-700 px-1.5 py-0.5 text-[11px] uppercase tracking-wide {material ? 'bg-emerald-900/40 text-emerald-200' : 'text-slate-400'}">
          <input type="checkbox" class="hidden" bind:checked={material} /> M
        </label>
        <input
          type="text"
          class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
          placeholder="material description (optional)"
          bind:value={materialDescription}
          maxlength="500"
          disabled={!material}
        />
      </div>
    </fieldset>
  </div>

  <label class="mt-3 block text-xs">
    <span class="mb-1 block text-slate-400">Description</span>
    <textarea
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
      rows="6"
      bind:value={description}
      maxlength="16000"
    />
  </label>

  <label class="mt-3 block text-xs">
    <span class="mb-1 flex items-center justify-between text-slate-400">
      <span>Activities (JSON array)</span>
      {#if activitiesError}<span class="text-red-300">{activitiesError}</span>{/if}
    </span>
    <textarea
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
      rows="8"
      bind:value={activitiesText}
      spellcheck="false"
    />
    <span class="mt-1 block text-[11px] text-slate-500">
      Attack rolls, saves, and damage live here. Leave empty if the spell has no mechanical rolls; the rules engine validates per-activity shape on save.
    </span>
  </label>

  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Visibility</legend>
    <div class="space-y-1 text-xs">
      <label class="block">
        <input type="radio" bind:group={visibility} value="private" />
        <span class="ml-1">Private</span>
        <span class="ml-1 text-slate-500">— only you</span>
      </label>
      <label class="block">
        <input type="radio" bind:group={visibility} value="unlisted" />
        <span class="ml-1">Unlisted</span>
        <span class="ml-1 text-slate-500">— URL-only, hidden from marketplace</span>
      </label>
      <label class="block">
        <input type="radio" bind:group={visibility} value="public" />
        <span class="ml-1">Public</span>
        <span class="ml-1 text-slate-500">— browseable in /homebrew/browse</span>
      </label>
    </div>
  </fieldset>

  <div class="mt-4 flex items-center gap-2">
    <button
      type="button"
      class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
      on:click={onSave}
      disabled={busy || !name.trim() || !slug.trim() || !!activitiesError}
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
