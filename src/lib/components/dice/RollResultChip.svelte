<!--
  One roll, rendered. Presentational — takes a RollResult and shows the total
  plus the breakdown that produced it.

  Showing the breakdown is the point. A total on its own is unarguable in the
  wrong way: when Great Weapon Fighting floors a 1 to a 3, or Reliable Talent
  turns a 4 into a 10, or advantage drops a die, the player should be able to
  see that happen rather than trust that the app applied a feature correctly.
  `RollResult.detail` renders that as `[1→3, 6] + 3 = 12`.
-->
<script lang="ts">
  import type { RollResult } from '$lib/dice';

  export let result: RollResult;
  /** What was rolled — a skill name, an action, or the formula. */
  export let label: string | null = null;
  /** Smaller inline presentation for dense surfaces like the resolve panel. */
  export let compact = false;

  $: d20 = result.d20;
  $: mode = d20?.mode ?? 'normal';
</script>

<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 {compact ? 'text-xs' : 'text-sm'}">
  {#if label}
    <span class="text-slate-400">{label}</span>
  {/if}

  <span
    class="font-mono font-bold {compact ? 'text-base' : 'text-lg'} {d20?.isCrit
      ? 'text-emerald-300'
      : d20?.isFumble
        ? 'text-red-400'
        : 'text-white'}"
    data-testid="roll-total"
  >
    {result.total}
  </span>

  {#if d20?.isCrit}
    <span class="rounded bg-emerald-900/50 px-1 text-[10px] uppercase text-emerald-300">crit</span>
  {:else if d20?.isFumble}
    <span class="rounded bg-red-900/50 px-1 text-[10px] uppercase text-red-300">nat 1</span>
  {/if}

  {#if mode !== 'normal'}
    <span
      class="rounded px-1 text-[10px] uppercase {mode === 'advantage'
        ? 'bg-emerald-900/50 text-emerald-300'
        : 'bg-amber-900/50 text-amber-300'}"
    >
      {mode === 'advantage' ? 'adv' : 'dis'}
    </span>
  {/if}

  <span class="font-mono text-xs text-slate-500">{result.detail}</span>
</div>
