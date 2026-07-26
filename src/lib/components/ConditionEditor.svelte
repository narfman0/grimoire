<script lang="ts">
  // Structured editor for homebrew conditions. Field structure mirrors the
  // condition content kind: name, description, a list of mechanical effects,
  // and an optional source attribution.

  import EditorShell, { type Visibility } from './EditorShell.svelte';
  import EditorField from './EditorField.svelte';

  export let item: {
    slug: string;
    name: string;
    visibility?: Visibility;
    data: {
      description?: string;
      effects?: string[];
      source?: string;
    };
  } = { slug: '', name: '', visibility: 'private', data: {} };
  export let isEdit = false;
  export let busy = false;
  export let errorMessage = '';

  // ---- form state ----
  let description = item.data.description ?? '';
  let effects: string[] = (item.data.effects ?? []).slice();
  let source = item.data.source ?? '';

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

  function buildData(): Record<string, unknown> {
    const filteredEffects = effects.map((s) => s.trim()).filter(Boolean);
    return {
      ...(description ? { description } : {}),
      ...(filteredEffects.length > 0 ? { effects: filteredEffects } : {}),
      ...(source.trim() ? { source: source.trim() } : {})
    };
  }
</script>

<EditorShell {item} {isEdit} {busy} {errorMessage} {buildData} on:save on:cancel on:delete>
  <EditorField
    class="mt-3"
    label="Description"
    type="textarea"
    rows={4}
    maxlength={8000}
    placeholder="Flavor text or overview of the condition…"
    bind:value={description}
  />

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

  <EditorField
    class="mt-3"
    label="Source (optional)"
    maxlength={200}
    placeholder="e.g. Player's Handbook p. 290"
    bind:value={source}
  />
</EditorShell>
