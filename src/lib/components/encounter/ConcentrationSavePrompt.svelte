<script lang="ts">
  // Post-resolve callout: the target of a damaging action is concentrating,
  // so the DM needs a CON save. DM-only — the parent gates on role. Stateless;
  // the parent owns the queue, renders its head here, and shifts it on
  // either choice.
  import { createEventDispatcher } from 'svelte';

  export let participantName: string;
  export let dc: number;
  /** How many further checks the same resolution queued behind this one. */
  export let remaining = 0;

  const dispatch = createEventDispatcher<{ drop: void; dismiss: void }>();
</script>

<div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-600 bg-amber-950/40 px-4 py-3 text-sm">
  <span class="text-amber-200">
    ⚠ <strong>{participantName}</strong> is concentrating — CON save DC {dc}
  </span>
  <button
    class="rounded border border-red-700 bg-red-900/40 px-2 py-0.5 text-xs text-red-200 hover:bg-red-900/70"
    on:click={() => dispatch('drop')}
  >
    Fail save (drop)
  </button>
  <button
    class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
    on:click={() => dispatch('dismiss')}
  >
    Pass / dismiss
  </button>
  {#if remaining > 0}
    <span class="text-xs text-amber-200/70">+{remaining} more</span>
  {/if}
</div>
