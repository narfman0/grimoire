<script lang="ts">
  // Live-combat turn bar + dice roller (DM only, live encounters — the
  // parent gates on both). The dice roller is client-only with no
  // persistence, so its result lives here.
  import { createEventDispatcher } from 'svelte';

  export let round: number;
  export let busy = false;

  const dispatch = createEventDispatcher<{ advance: 1 | -1; end: void }>();

  const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
  let diceResult: { die: number; roll: number } | null = null;
  function rollDie(sides: number) {
    diceResult = { die: sides, roll: Math.floor(Math.random() * sides) + 1 };
  }
</script>

<section class="mb-4 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
  <div class="flex items-center gap-2">
    <span class="text-emerald-200">Turn controls:</span>
    <button class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={() => dispatch('advance', -1)} disabled={busy} title="Previous turn">
      ←
    </button>
    <span class="min-w-[5rem] text-center font-mono text-slate-300">Round {round}</span>
    <button class="rounded border border-emerald-700 px-2 py-0.5 hover:bg-emerald-900/40" on:click={() => dispatch('advance', 1)} disabled={busy}>
      Next turn →
    </button>
    <button
      class="ml-auto rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800 disabled:opacity-40"
      disabled={busy}
      on:click={() => dispatch('end')}
    >
      End
    </button>
  </div>
</section>
<!-- Dice roller -->
<section class="mb-4 rounded-lg border border-slate-700 bg-slate-900/30 p-3 text-sm">
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-slate-400">Dice:</span>
    {#each DICE as sides}
      <button
        class="rounded border border-slate-600 px-2 py-0.5 font-mono text-xs hover:border-slate-400 hover:bg-slate-800"
        on:click={() => rollDie(sides)}
      >d{sides}</button>
    {/each}
    {#if diceResult}
      <span class="ml-2 font-mono text-slate-200">
        d{diceResult.die} → <span class="text-lg font-bold {diceResult.roll === diceResult.die ? 'text-emerald-300' : diceResult.roll === 1 ? 'text-red-400' : 'text-white'}">{diceResult.roll}</span>
      </span>
    {/if}
  </div>
</section>
