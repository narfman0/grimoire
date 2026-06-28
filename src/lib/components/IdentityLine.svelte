<script context="module" lang="ts">
  export interface IdentityEntry {
    text: string;
    sep: string;
    name: string;
    kindLabel: string;
    description?: string;
  }
</script>

<script lang="ts">
  import HoverPopup from './HoverPopup.svelte';

  export let entries: IdentityEntry[] = [];
</script>

<p class="text-sm text-slate-400">
  {#each entries as entry}
    <span class="text-slate-500">{entry.sep}</span>
    <HoverPopup>
      <span class="cursor-help">{entry.text}</span>
      <svelte:fragment slot="popup">
        <div class="mb-1 font-semibold text-slate-200">{entry.name}</div>
        <div class="text-xs text-slate-500">{entry.kindLabel}</div>
        {#if entry.description}
          <p class="mt-1 whitespace-pre-wrap text-slate-300">{entry.description}</p>
        {/if}
      </svelte:fragment>
    </HoverPopup>
  {/each}
</p>
