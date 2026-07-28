<script lang="ts">
  // Condition chips for the participant detail panel. Fixed
  // COMMON_CONDITIONS order regardless of active state. DMs see every
  // condition (active/implied/inactive). Players only see active + implied —
  // clutter-reducing, no toggle. Hover/focus on any chip surfaces the SRD
  // description. Stateless: the parent resolves the active list (from the PC
  // document or the poll snapshot) and owns the toggle.
  import { createEventDispatcher } from 'svelte';
  import { COMMON_CONDITIONS, CONDITION_DESCRIPTIONS } from '$lib/rules/conditions';

  export let activeConds: string[] = [];
  /** condition → the active condition that implies it (from `impliedBy`). */
  export let implied: Map<string, string>;
  export let role: 'dm' | 'player';
  export let busy = false;

  const dispatch = createEventDispatcher<{ toggle: string }>();
</script>

<div class="mb-3">
  <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Conditions</div>
  <div class="flex flex-wrap gap-1 text-[11px]">
    {#each COMMON_CONDITIONS as c}
      {@const isActive = activeConds.includes(c)}
      {@const isImplied = implied.has(c)}
      {@const impSrc = implied.get(c)}
      {#if isActive || isImplied || role === 'dm'}
        <span class="group relative inline-flex">
          {#if isImplied && !isActive}
            <span class="cursor-help rounded border border-slate-700 bg-slate-800/40 px-1.5 py-0.5 text-slate-500 italic">{c}</span>
          {:else if isActive}
            <button
              class="cursor-help rounded border border-amber-700 bg-amber-950/30 px-1.5 py-0.5 text-amber-200 hover:bg-amber-900/40 disabled:opacity-40 disabled:cursor-help"
              disabled={busy || role !== 'dm'}
              on:click={() => dispatch('toggle', c)}
            >{c}{#if role === 'dm'} ×{/if}</button>
          {:else}
            <button
              class="cursor-help rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:bg-slate-800 disabled:opacity-40"
              disabled={busy}
              on:click={() => dispatch('toggle', c)}
            >{c}</button>
          {/if}
          <span class="invisible absolute z-50 top-full left-0 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-950/95 p-2 text-xs text-slate-300 shadow-lg shadow-slate-900/80 opacity-0 transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 pointer-events-none">
            <div class="font-semibold uppercase tracking-wide text-slate-200">{c}</div>
            {#if isImplied}<div class="mb-1 text-[10px] text-slate-500">implied by {impSrc}</div>{/if}
            <div class="mt-1 whitespace-pre-line">{CONDITION_DESCRIPTIONS[c] ?? '(no description)'}</div>
          </span>
        </span>
      {/if}
    {/each}
    {#if role !== 'dm' && activeConds.length === 0 && implied.size === 0}
      <span class="text-slate-600">none</span>
    {/if}
  </div>
</div>
