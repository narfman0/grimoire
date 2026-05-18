<script lang="ts">
  // Structured editor for homebrew conditions. Field structure mirrors the
  // condition content kind: name, description, a list of mechanical effects,
  // and an optional source attribution.

  import { createEventDispatcher } from 'svelte';

  export let item: {
    slug: string;
    name: string;
    visibility?: 'private' | 'unlisted' | 'public';
    data: {
      description?: string;
      effects?: string[];
      source?: string;
    };
  } = { slug: '', name: '', visibility: 'private', data: {} };
  /** True when editing an existing row — locks the slug and shows Delete. */
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: 'private' | 'unlisted' | 'public'; data: Required<typeof item>['data'] };
    cancel: void;
    delete: void;
  }>();

  // ---- form state ----
  let name = item.name;
  let slug = item.slug;
  let visibility: 'private' | 'unlisted' | 'public' = item.visibility ?? 'private';
  let description = item.data.description ?? '';
  let effects: string[] = (item.data.effects ?? []).slice();
  let source = item.data.source ?? '';

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

  // ---- effects list helpers ----
  function addEffect() {
    effects = [...effects, ''];
  }
  function removeEffect(i: number) {
    effects = effects.filter((_, idx) => idx !== i);
  }
  function onEffectInput(i: number, e: Event) {
    const el = e.target as HTMLInputElement;
    effects = effects.map((v, idx) => (idx === i ? el.value : v));
  }

  // ---- assemble payload + dispatch save ----
  function onSave() {
    const filteredEffects = effects.map((s) => s.trim()).filter(Boolean);
    const data: Required<typeof item>['data'] = {
      ...(description ? { description } : {}),
      ...(filteredEffects.length > 0 ? { effects: filteredEffects } : {}),
      ...(source.trim() ? { source: source.trim() } : {})
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
      placeholder="Flavor text or overview of the condition…"
    />
  </label>

  <!-- Effects -->
  <fieldset class="mt-4 rounded border border-slate-800 p-3">
    <legend class="px-1 text-xs uppercase tracking-wide text-slate-400">Effects</legend>
    {#if effects.length === 0}
      <p class="text-xs text-slate-500">No effects yet. Add one below.</p>
    {/if}
    {#each effects as effect, i (i)}
      <div class="mt-2 flex items-center gap-2">
        <input
          type="text"
          class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          value={effect}
          on:input={(e) => onEffectInput(i, e)}
          placeholder="e.g. Disadvantage on attack rolls"
          maxlength="500"
        />
        <button
          type="button"
          class="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
          on:click={() => removeEffect(i)}
          aria-label="Remove effect"
        >×</button>
      </div>
    {/each}
    <button
      type="button"
      class="mt-2 rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
      on:click={addEffect}
    >+ Add effect</button>
  </fieldset>

  <label class="mt-3 block text-xs">
    <span class="mb-1 block text-slate-400">Source (optional)</span>
    <input
      type="text"
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
      bind:value={source}
      maxlength="200"
      placeholder="e.g. Player's Handbook p. 290"
    />
  </label>

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
