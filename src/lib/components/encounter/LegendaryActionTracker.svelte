<script lang="ts">
  // Legendary action tracker (DM only, non-PC with legendary actions — the
  // parent gates on both). Client-only per-round counter: the parent owns the
  // per-participant map and resets it when the round changes.
  import { createEventDispatcher } from 'svelte';

  export let legendaryActions: Array<{ name: string; description?: string }> = [];
  export let used = 0;
  export let max = 3;

  const dispatch = createEventDispatcher<{ toggle: void; reset: void }>();
</script>

<div class="mb-3">
  <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Legendary Actions</div>
  <div class="flex items-center gap-2 text-xs">
    <div class="flex gap-1">
      {#each Array(max) as _, i}
        <button
          class="h-5 w-5 rounded border text-center text-[11px] {i < used ? 'border-amber-500 bg-amber-900/50 text-amber-300' : 'border-slate-600 text-slate-600 hover:border-slate-400'}"
          title={i < used ? 'Mark unused' : 'Mark used'}
          on:click={() => dispatch('toggle')}
        >★</button>
      {/each}
    </div>
    <span class="text-slate-400">{used}/{max} used</span>
    {#if used > 0}
      <button class="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline" on:click={() => dispatch('reset')}>reset</button>
    {/if}
  </div>
  {#if legendaryActions.length > 0}
    <ul class="mt-1 space-y-0.5 text-[11px] text-slate-400">
      {#each legendaryActions as la}
        <li><span class="text-slate-300">{la.name}</span>{#if la.description} — {la.description.slice(0, 80)}{la.description.length > 80 ? '…' : ''}{/if}</li>
      {/each}
    </ul>
  {/if}
</div>
