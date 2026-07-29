<script lang="ts">
  // Post-resolve callout: the target of a damaging action is concentrating,
  // so the DM needs a CON save. DM-only — the parent gates on role. Stateless;
  // the parent owns the queue, renders its head here, and shifts it on
  // either choice.
  import { createEventDispatcher } from 'svelte';
  import { rollD20 } from '$lib/dice';
  import type { RollResult } from '$lib/dice';
  import { recordRoll } from '$lib/client/dice-log';
  import RollResultChip from '$lib/components/dice/RollResultChip.svelte';

  export let participantName: string;
  export let dc: number;
  /** How many further checks the same resolution queued behind this one. */
  export let remaining = 0;
  /** CON save modifier when the parent knows it (PC targets). Monsters and
   *  unknown targets roll bare and the DM adds their own number. */
  export let conSaveBonus: number | null = null;

  const dispatch = createEventDispatcher<{ drop: void; dismiss: void }>();

  let roll: RollResult | null = null;

  /** Roll the save and report the outcome. The DM still chooses what happens
   *  — the buttons stay live either way — but the common case becomes one
   *  click instead of "roll, compare, decide". */
  function rollSave() {
    const result = rollD20(conSaveBonus ?? 0);
    roll = result;
    recordRoll(`${participantName} — CON save`, result);
  }

  $: outcome = roll ? (roll.total >= dc ? 'pass' : 'fail') : null;
</script>

<div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-600 bg-amber-950/40 px-4 py-3 text-sm">
  <span class="text-amber-200">
    ⚠ <strong>{participantName}</strong> is concentrating — CON save DC {dc}
  </span>
  <button
    class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800"
    title={conSaveBonus != null
      ? `Roll d20${conSaveBonus >= 0 ? '+' : ''}${conSaveBonus} vs DC ${dc}`
      : `Roll a bare d20 vs DC ${dc} — add the target's CON modifier`}
    on:click={rollSave}
  >
    🎲 Roll save
  </button>
  {#if roll}
    <span class="flex items-center gap-2">
      <RollResultChip result={roll} compact />
      <span
        class="rounded px-1 text-[10px] uppercase {outcome === 'pass'
          ? 'bg-emerald-900/50 text-emerald-300'
          : 'bg-red-900/50 text-red-300'}"
      >{outcome === 'pass' ? `≥ ${dc} pass` : `< ${dc} fail`}</span>
    </span>
  {/if}
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
