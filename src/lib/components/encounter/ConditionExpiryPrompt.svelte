<script lang="ts">
  // Turn-start callout: a condition's round timer has lapsed for the
  // participant whose turn just came up. DM-only — the parent gates on role,
  // owns the queue, renders its head here, and shifts it on any choice.
  //
  // Expiry is confirmed, never automatic: nothing changes until the DM picks
  // one of these buttons. See $lib/encounter/condition-timers for why.
  import { createEventDispatcher } from 'svelte';

  export let participantName: string;
  export let condition: string;
  /** Rounds the condition has been overdue (0 = lapsing right now). */
  export let overdueBy = 0;
  /** How many further expiries are queued behind this one. */
  export let remaining = 0;

  const dispatch = createEventDispatcher<{ remove: void; extend: number; keep: void }>();
</script>

<div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-600 bg-amber-950/40 px-4 py-3 text-sm">
  <span class="text-amber-200">
    ⏳ <strong>{condition}</strong> ends for <strong>{participantName}</strong>?
    {#if overdueBy > 0}
      <span class="ml-1 text-xs text-amber-200/70">({overdueBy} round{overdueBy === 1 ? '' : 's'} overdue)</span>
    {/if}
  </span>
  <button
    class="rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900/70"
    on:click={() => dispatch('remove')}
  >
    Remove {condition}
  </button>
  <button
    class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
    title="Push the timer out by one more round"
    on:click={() => dispatch('extend', 1)}
  >
    +1 round
  </button>
  <button
    class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
    title="Keep the condition with no timer — it stops prompting"
    on:click={() => dispatch('keep')}
  >
    Keep (no timer)
  </button>
  {#if remaining > 0}
    <span class="text-xs text-amber-200/70">+{remaining} more</span>
  {/if}
</div>
