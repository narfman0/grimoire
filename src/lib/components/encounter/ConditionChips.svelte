<script lang="ts">
  // Condition chips for the participant detail panel. Fixed
  // COMMON_CONDITIONS order regardless of active state. DMs see every
  // condition (active/implied/inactive). Players only see active + implied —
  // clutter-reducing, no toggle. Hover/focus on any chip surfaces the SRD
  // description. Stateless: the parent resolves the active list (from the PC
  // document or the poll snapshot) and owns the toggle.
  //
  // Durations: the DM picks a round count in the header select, and the next
  // condition they switch ON carries it. Active chips show their remaining
  // rounds; the ⏱ button re-opens the picker for an already-applied
  // condition. The flat active list stays the source of truth — a timer is
  // only an overlay ($lib/encounter/condition-timers).
  import { createEventDispatcher } from 'svelte';
  import { COMMON_CONDITIONS, CONDITION_DESCRIPTIONS } from '$lib/rules/conditions';
  import { roundsRemaining, timerFor, type ConditionTimer } from '$lib/encounter/condition-timers';

  export let activeConds: string[] = [];
  /** condition → the active condition that implies it (from `impliedBy`). */
  export let implied: Map<string, string>;
  export let role: 'dm' | 'player';
  export let busy = false;
  /** Duration overlay for this participant. */
  export let timers: ConditionTimer[] = [];
  /** Live round — turns `untilRound` into a "rounds left" readout. */
  export let round = 0;
  /** Rounds applied to the next condition switched on. 0 = no timer. */
  export let pendingDuration = 0;

  const dispatch = createEventDispatcher<{
    toggle: string;
    setDuration: { condition: string; rounds: number };
  }>();

  const DURATION_CHOICES = [0, 1, 2, 3, 5, 10] as const;

  /** Which active chip has its duration picker open. */
  let durationEditFor: string | null = null;
</script>

<div class="mb-3">
  <div class="mb-1 flex items-center gap-2">
    <span class="text-[10px] uppercase tracking-wide text-slate-500">Conditions</span>
    {#if role === 'dm'}
      <label class="flex items-center gap-1 text-[10px] text-slate-500">
        for
        <select
          class="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-300"
          bind:value={pendingDuration}
          disabled={busy}
          title="Rounds the next condition you apply should last"
        >
          {#each DURATION_CHOICES as d}
            <option value={d}>{d === 0 ? 'no timer' : `${d} rd`}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>
  <div class="flex flex-wrap gap-1 text-[11px]">
    {#each COMMON_CONDITIONS as c}
      {@const isActive = activeConds.includes(c)}
      {@const isImplied = implied.has(c)}
      {@const impSrc = implied.get(c)}
      {@const timer = timerFor(timers, c)}
      {#if isActive || isImplied || role === 'dm'}
        <span class="group relative inline-flex">
          {#if isImplied && !isActive}
            <span class="cursor-help rounded border border-slate-700 bg-slate-800/40 px-1.5 py-0.5 text-slate-500 italic">{c}</span>
          {:else if isActive}
            <button
              class="cursor-help rounded border border-amber-700 bg-amber-950/30 px-1.5 py-0.5 text-amber-200 hover:bg-amber-900/40 disabled:opacity-40 disabled:cursor-help"
              disabled={busy || role !== 'dm'}
              on:click={() => dispatch('toggle', c)}
            >{c}{#if timer}<span class="ml-0.5 font-mono text-[10px] text-amber-300/80">{Math.max(0, roundsRemaining(timer, round))}r</span>{/if}{#if role === 'dm'} ×{/if}</button>
          {:else}
            <button
              class="cursor-help rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:bg-slate-800 disabled:opacity-40"
              disabled={busy}
              on:click={() => dispatch('toggle', c)}
            >{c}</button>
          {/if}
          {#if isActive && role === 'dm'}
            <button
              class="ml-0.5 rounded border border-slate-700 px-1 text-[10px] text-slate-500 hover:border-amber-700 hover:text-amber-300"
              title="Set how many rounds {c} lasts"
              disabled={busy}
              on:click={() => (durationEditFor = durationEditFor === c ? null : c)}
            >⏱</button>
          {/if}
          {#if durationEditFor === c}
            <span class="absolute z-50 top-full left-0 mt-1 flex gap-0.5 rounded border border-slate-700 bg-slate-950 p-1 shadow-lg">
              {#each DURATION_CHOICES as d}
                <button
                  class="rounded border border-slate-700 px-1 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                  on:click={() => {
                    dispatch('setDuration', { condition: c, rounds: d });
                    durationEditFor = null;
                  }}
                >{d === 0 ? 'none' : d}</button>
              {/each}
            </span>
          {:else}
            <span class="invisible absolute z-50 top-full left-0 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-950/95 p-2 text-xs text-slate-300 shadow-lg shadow-slate-900/80 opacity-0 transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 pointer-events-none">
              <div class="font-semibold uppercase tracking-wide text-slate-200">{c}</div>
              {#if isImplied}<div class="mb-1 text-[10px] text-slate-500">implied by {impSrc}</div>{/if}
              {#if timer}<div class="mb-1 text-[10px] text-amber-300/80">ends round {timer.untilRound}</div>{/if}
              <div class="mt-1 whitespace-pre-line">{CONDITION_DESCRIPTIONS[c] ?? '(no description)'}</div>
            </span>
          {/if}
        </span>
      {/if}
    {/each}
    {#if role !== 'dm' && activeConds.length === 0 && implied.size === 0}
      <span class="text-slate-600">none</span>
    {/if}
  </div>
</div>
