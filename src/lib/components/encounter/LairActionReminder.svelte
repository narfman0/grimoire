<script lang="ts">
  // Initiative-count-20 callout. Shown on the turn the lair slot immediately
  // precedes (initiative 20, losing ties — see $lib/encounter/lair). DM-only;
  // the parent gates on role and decides whether it fires.
  //
  // Advisory, not a prompt queue: nothing is pending, so it has a plain
  // dismiss rather than the confirm/skip buttons the reaction and condition
  // queues use.
  import { createEventDispatcher } from 'svelte';

  export let sourceNames: string[] = [];
  export let hasLair = false;

  const dispatch = createEventDispatcher<{ dismiss: void }>();
</script>

<div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-violet-700 bg-violet-950/40 px-4 py-3 text-sm">
  <span class="text-violet-200">
    🏰 <strong>Initiative 20</strong> —
    {#if hasLair}
      lair actions for <strong>{sourceNames.join(', ')}</strong>.
    {:else}
      <strong>{sourceNames.join(', ')}</strong> {sourceNames.length === 1 ? 'has' : 'have'} legendary actions available.
    {/if}
    <span class="ml-1 text-xs text-violet-200/70">(the lair acts here, losing ties)</span>
  </span>
  <button
    class="ml-auto rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
    on:click={() => dispatch('dismiss')}
  >
    Dismiss
  </button>
</div>
