<!--
  Roll on a random table — wild magic surge, the deck of many things, chaos
  bolt, and every other `randomTable` the engine has been carrying.

  Those tables were fully encoded across engine batch 7 and consumed by
  nothing: `Action.randomTable` had zero references outside src/lib/rules/,
  so the app knew the whole surge table and could only ever show it as prose.

  `rollTwiceChoose` (Controlled Chaos, Controlled Surge, Mystical Connection)
  rolls both and lets the player pick, rather than picking for them — the
  feature grants a choice, and resolving it silently would be the wrong rule.
-->
<script lang="ts">
  import { rollPool } from '$lib/dice';
  import type { RollResult } from '$lib/dice';
  import { recordRoll } from '$lib/client/dice-log';
  import RollResultChip from './RollResultChip.svelte';

  interface TableEntry {
    min: number;
    max: number;
    label: string;
    description?: string;
  }
  export let table: {
    die: string;
    label?: string;
    rollTwiceChoose?: boolean;
    entries: TableEntry[];
  };
  /** Name of the action/feature the table belongs to, for the roll history. */
  export let sourceLabel = 'Random table';

  let rolls: RollResult[] = [];
  let chosen: number | null = null;

  const entryFor = (n: number) => table.entries.find((e) => n >= e.min && n <= e.max) ?? null;

  function roll() {
    const count = table.rollTwiceChoose ? 2 : 1;
    const next: RollResult[] = [];
    for (let i = 0; i < count; i++) {
      const result = rollPool(table.die);
      if (result) next.push(result);
    }
    rolls = next;
    // With one roll there's nothing to choose; with two the player picks.
    chosen = next.length === 1 ? 0 : null;
    for (const r of next) recordRoll(`${sourceLabel} (${table.die})`, r);
  }

  $: result = chosen != null && rolls[chosen] ? entryFor(rolls[chosen].total) : null;
</script>

<div class="rounded border border-indigo-900/60 bg-slate-950/40 p-2 text-xs">
  <div class="mb-1 flex items-center gap-2">
    <span class="font-semibold text-indigo-200">{table.label ?? 'Random table'}</span>
    <span class="font-mono text-slate-500">{table.die}</span>
    <button
      class="ml-auto rounded border border-slate-600 px-2 py-0.5 hover:border-emerald-600 hover:text-emerald-200"
      on:click={roll}
    >
      🎲 Roll{table.rollTwiceChoose ? ' twice' : ''}
    </button>
  </div>

  {#if rolls.length > 0}
    <ul class="mb-1 space-y-0.5">
      {#each rolls as r, i}
        {@const entry = entryFor(r.total)}
        <li class="flex flex-wrap items-center gap-2">
          {#if table.rollTwiceChoose}
            <button
              class="rounded border px-1.5 py-0.5 text-[10px] {chosen === i
                ? 'border-emerald-500 bg-emerald-900/40 text-emerald-200'
                : 'border-slate-600 text-slate-400 hover:border-slate-400'}"
              on:click={() => (chosen = i)}
            >{chosen === i ? 'chosen' : 'use this'}</button>
          {/if}
          <RollResultChip result={r} compact />
          <span class="text-slate-300">{entry?.label ?? 'no matching row'}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if table.rollTwiceChoose && rolls.length > 1 && chosen == null}
    <p class="text-amber-300/80">Pick which result to use.</p>
  {/if}

  {#if result?.description}
    <p class="mt-1 border-t border-slate-800 pt-1 leading-relaxed text-slate-400">
      {result.description}
    </p>
  {/if}
</div>
