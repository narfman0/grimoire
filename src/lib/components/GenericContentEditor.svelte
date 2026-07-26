<script lang="ts">
  // JSON-with-live-validation fallback editor for kinds that don't have a
  // structured editor yet. The textarea binds to a string; zod-shape
  // validation happens on the *server* when the user clicks Save (errors
  // surface as `errorMessage` from the caller). Lightweight, no monaco.

  import EditorShell, { type Visibility } from './EditorShell.svelte';

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

  function buildData(): Record<string, unknown> | null {
    try {
      return dataText.trim() ? (JSON.parse(dataText) as Record<string, unknown>) : {};
    } catch (e) {
      parseError = (e as Error).message;
      return null;
    }
  }
</script>

<EditorShell {item} {isEdit} {busy} {errorMessage} {buildData} saveBlocked={!!parseError} on:save on:cancel on:delete>
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
</EditorShell>
