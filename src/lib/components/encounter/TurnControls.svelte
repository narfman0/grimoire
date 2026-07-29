<script lang="ts">
  // Live-combat turn bar + quick dice (DM only, live encounters — the parent
  // gates on both).
  //
  // The roller here used to be the app's only one, with its own inline
  // Math.random. It now goes through $lib/dice like every other roll, and
  // feeds the shared history so a DM's quick d20 shows up in the tray
  // alongside everything else. Free-form formulas and advantage live in the
  // tray (available to everyone); this bar stays a fast in-combat shortcut.
  import { createEventDispatcher } from 'svelte';
  import { rollD20, rollPool } from '$lib/dice';
  import type { RollResult } from '$lib/dice';
  import { recordRoll } from '$lib/client/dice-log';
  import RollResultChip from '$lib/components/dice/RollResultChip.svelte';

  export let round: number;
  export let busy = false;

  const dispatch = createEventDispatcher<{ advance: 1 | -1; end: void }>();

  const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
  let lastRoll: RollResult | null = null;
  function rollDie(sides: number) {
    // d20 goes through rollD20 so the result carries crit/fumble
    // classification and the chip can highlight a nat 20 or a nat 1.
    const result = sides === 20 ? rollD20(0) : rollPool(`1d${sides}`);
    if (!result) return;
    lastRoll = result;
    recordRoll(`d${sides}`, result);
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
    {#if lastRoll}
      <span class="ml-2"><RollResultChip result={lastRoll} compact /></span>
    {/if}
  </div>
</section>
