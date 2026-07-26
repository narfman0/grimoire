<script lang="ts" context="module">
  /** Visibility of a homebrew content row. Shared by the whole editor family. */
  export type Visibility = 'private' | 'unlisted' | 'public';

  /** Kebab-cases a display name into a slug (lowercase, max 64 chars). */
  export function kebab(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }
</script>

<script lang="ts">
  // Chrome shared by every homebrew editor: name + slug inputs (slug
  // auto-fills from the name until manually edited, and locks in edit mode),
  // the three-way visibility fieldset, the error banner, and the
  // Save / Cancel / Delete footer. Kind-specific fields render through the
  // default slot; the host editor assembles its `data` payload in
  // `buildData` and the shell dispatches the full save envelope.

  import { createEventDispatcher } from 'svelte';

  export let item: { slug: string; name: string; visibility?: Visibility };
  /** True when editing an existing row — locks the slug and shows Delete. */
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';
  /** Extra kind-specific condition that blocks Save (e.g. a JSON parse error). */
  export let saveBlocked = false;
  /** Assembles the kind-specific `data` payload. Return null to abort the save. */
  export let buildData: () => Record<string, unknown> | null = () => ({});

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: Visibility; data: Record<string, unknown> };
    cancel: void;
    delete: void;
  }>();

  let name = item.name;
  let slug = item.slug;
  let visibility: Visibility = item.visibility ?? 'private';

  let slugManuallyEdited = isEdit; // editing existing: never auto-rewrite
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
    const data = buildData();
    if (data === null) return;
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

  <slot />

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
      disabled={busy || !name.trim() || !slug.trim() || saveBlocked}
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
