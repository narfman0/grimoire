<script lang="ts">
  // "Suggest turn" — DM-only card on a non-PC's detail panel. The parent
  // computes suggestions (pure $lib/board/suggest-turn over the live board)
  // and applies the chosen draft as an ordinary TurnPlan; this component
  // renders and dispatches. The optimizer proposes, the DM disposes.
  import { createEventDispatcher } from 'svelte';
  import type { RankedPlan } from '$lib/board/suggest-turn';

  export let suggestions: RankedPlan[] | null = null;
  export let busy = false;
  /** Why suggestions can't be computed (no board, token unplaced). */
  export let unavailableReason: string | null = null;

  const dispatch = createEventDispatcher<{ compute: void; apply: RankedPlan }>();
</script>

<div class="mb-3" data-testid="suggest-turn">
  <div class="mb-1 flex items-center gap-2">
    <span class="text-[10px] uppercase tracking-wide text-slate-500">Suggest turn</span>
    <button
      class="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:text-slate-100 disabled:opacity-40"
      disabled={busy || unavailableReason !== null}
      title={unavailableReason ?? 'Rank this creature’s best turns on the board'}
      on:click={() => dispatch('compute')}
    >
      💡 {suggestions ? 'Recompute' : 'Suggest'}
    </button>
    {#if unavailableReason}
      <span class="text-[10px] text-slate-600">{unavailableReason}</span>
    {/if}
  </div>
  {#if suggestions}
    {#if suggestions.length === 0}
      <p class="text-[11px] text-slate-500">No legal action found from here.</p>
    {:else}
      <ul class="space-y-1">
        {#each suggestions as s, i}
          <li
            class="flex items-center gap-2 rounded border border-slate-800 bg-slate-950/40 px-2 py-1 text-[11px]"
          >
            <span class="font-mono text-slate-600">#{i + 1}</span>
            <span class="flex-1 text-slate-300">{s.rationale}</span>
            <span class="font-mono text-[10px] text-slate-600" title="score">{s.score}</span>
            <button
              class="rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-emerald-200 hover:bg-emerald-900/70 disabled:opacity-40"
              disabled={busy}
              on:click={() => dispatch('apply', s)}
            >
              Draft
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
