<script lang="ts">
  // DM HP adjust row in the participant detail panel (DM only, target has a
  // maxHp — the parent gates on both). The amount is a two-way bound prop so
  // the parent keeps its per-participant hpInputs map and can zero it after
  // applying. Both buttons dispatch; the parent routes PC vs non-PC.
  import { createEventDispatcher } from 'svelte';

  export let currentHp: number | null;
  export let maxHp: number;
  export let tempHp = 0;
  export let amount: number | undefined = undefined;
  export let busy = false;

  const dispatch = createEventDispatcher<{ damage: void; heal: void }>();
</script>

<div class="mb-3 flex flex-wrap items-center gap-2">
  <div class="text-[10px] uppercase tracking-wide text-slate-500">HP</div>
  <span class="font-mono text-sm text-slate-200">
    {currentHp ?? '—'} / {maxHp}{#if tempHp > 0}<span class="text-emerald-300"> +{tempHp}</span>{/if}
  </span>
  <input
    type="number"
    min="0"
    class="ml-2 w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-xs"
    placeholder="±hp"
    bind:value={amount}
  />
  <button
    class="rounded bg-red-700/60 px-2 py-0.5 text-xs hover:bg-red-700 disabled:opacity-40"
    title="Apply damage"
    disabled={busy}
    on:click={() => dispatch('damage')}
  >− dmg</button>
  <button
    class="rounded bg-emerald-700/60 px-2 py-0.5 text-xs hover:bg-emerald-700 disabled:opacity-40"
    title="Apply heal"
    disabled={busy}
    on:click={() => dispatch('heal')}
  >+ heal</button>
</div>
