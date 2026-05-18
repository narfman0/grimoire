<script lang="ts">
  // JSON-with-live-validation fallback editor for kinds that don't have a
  // structured editor yet (everything except feat at the moment). The
  // textarea binds to a string; on every change we try to parse + validate
  // against the kind-specific zod registry on the *server* by leaving the
  // validation to the API (errors surface as `errorMessage` from the
  // caller). Lightweight, no monaco dependency.

  import { createEventDispatcher } from 'svelte';

  type Visibility = 'private' | 'unlisted' | 'public';

  export let item: {
    kind: string;
    slug: string;
    name: string;
    visibility?: Visibility;
    data: Record<string, unknown>;
  } = { kind: '', slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  const dispatch = createEventDispatcher<{
    save: { slug: string; name: string; visibility: Visibility; data: Record<string, unknown> };
    cancel: void;
    delete: void;
  }>();

  let name = item.name;
  let slug = item.slug;
  let visibility: Visibility = item.visibility ?? 'private';
  let dataText = JSON.stringify(item.data, null, 2);
  let parseError = '';

  // Live JSON parse feedback. Doesn't catch zod-shape errors — those come
  // from the server when the user clicks Save (and surface via errorMessage).
  $: {
    if (!dataText.trim()) {
      parseError = '';
    } else {
      try {
        JSON.parse(dataText);
        parseError = '';
      } catch (e) {
        parseError = (e as Error).message;
      }
    }
  }

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

  function onSave() {
    let parsed: Record<string, unknown>;
    try {
      parsed = dataText.trim() ? (JSON.parse(dataText) as Record<string, unknown>) : {};
    } catch (e) {
      parseError = (e as Error).message;
      return;
    }
    dispatch('save', { slug, name, visibility, data: parsed });
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
    <span class="mb-1 flex items-center justify-between text-slate-400">
      <span>Data (JSON)</span>
      {#if parseError}
        <span class="text-red-300">{parseError}</span>
      {/if}
    </span>
    <textarea
      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
      rows="16"
      bind:value={dataText}
      spellcheck="false"
    ></textarea>
    <span class="mt-1 block text-[11px] text-slate-500">
      Shape is enforced server-side by the kind's zod schema. The editor accepts any valid JSON; the API will reject anything the rules engine can't consume.
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
      disabled={busy || !name.trim() || !slug.trim() || !!parseError}
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
