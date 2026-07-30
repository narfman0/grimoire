<script lang="ts">
  // Opportunity-attack prompt: a creature just walked out of this one's
  // melee reach. DM-only — the parent gates on role, owns the queue (one
  // entry per attacker per movement), renders its head here, and shifts it
  // on either answer.
  //
  // Two ways to say yes: "Resolve" burns the reaction and opens the resolve
  // panel pre-aimed at the mover, "Just the reaction" only marks it spent
  // (for a DM who rolls it at the table and logs nothing).
  import { createEventDispatcher } from 'svelte';

  export let attackerName: string;
  export let moverName: string;
  /** Cell the mover left from — where the swing happens. */
  export let fromCell: { x: number; y: number } | null = null;
  /** How many further prompts are queued behind this one. */
  export let queuedBehind = 0;

  const dispatch = createEventDispatcher<{ resolve: void; markUsed: void; skip: void }>();
</script>

<div
  class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-orange-700 bg-orange-950/40 px-4 py-3 text-sm"
  data-testid="opportunity-prompt"
>
  <span class="text-orange-200">
    ⚔ <strong>{attackerName}</strong> can take an opportunity attack —
    <strong>{moverName}</strong> left its reach{fromCell
      ? ` at (${fromCell.x}, ${fromCell.y})`
      : ''}. Use its reaction?
  </span>
  <button
    class="rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900/70"
    on:click={() => dispatch('resolve')}
  >
    Resolve the attack
  </button>
  <button
    class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
    title="Mark the reaction spent without opening the resolve panel"
    on:click={() => dispatch('markUsed')}
  >
    Just the reaction
  </button>
  <button
    class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
    on:click={() => dispatch('skip')}
  >
    Skip
  </button>
  {#if queuedBehind > 0}
    <span class="text-xs text-orange-200/70">+{queuedBehind} more</span>
  {/if}
</div>
