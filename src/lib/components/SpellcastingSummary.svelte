<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { AbilityKey } from '$lib/rules/types';

  export let ability: AbilityKey;
  export let attackBonus: number | null = null;
  export let saveDC: number | null = null;
  export let prepared: number = 0;
  export let known: number = 0;

  const dispatch = createEventDispatcher<{ manage: void }>();
</script>

<div class="mb-3 flex flex-wrap items-center gap-4 text-sm">
  <span class="text-slate-400">
    Ability: <span class="font-mono text-slate-200 uppercase">{ability}</span>
  </span>
  {#if attackBonus !== null}
    <span class="text-slate-400">
      Attack: <span class="font-mono text-slate-200">{attackBonus >= 0 ? '+' : ''}{attackBonus}</span>
    </span>
  {/if}
  {#if saveDC !== null}
    <span class="text-slate-400">
      Save DC: <span class="font-mono text-slate-200">{saveDC}</span>
    </span>
  {/if}
  <span class="text-slate-400">
    Prepared: <span class="font-mono text-slate-200">{prepared}</span>
    · Known: <span class="font-mono text-slate-200">{known}</span>
  </span>
  <button
    class="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
    on:click={() => dispatch('manage')}
  >
    Manage spells
  </button>
</div>
