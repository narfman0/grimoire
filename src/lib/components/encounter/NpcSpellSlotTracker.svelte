<script lang="ts">
  // NPC spell slot tracker (DM only, non-PC — the parent gates on both).
  // Client-only, not persisted. State lives in the parent keyed by
  // participant id, because the detail panel remounts on selection change.
  import { createEventDispatcher } from 'svelte';

  export let slots: Record<number, { max: number; used: number }> = {};
  export let showEditor = false;

  const dispatch = createEventDispatcher<{
    toggleEditor: void;
    setMax: { level: number; max: number };
    toggleUsed: { level: number; slotIdx: number };
  }>();

  const SPELL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
  $: usedLevels = SPELL_LEVELS.filter((l) => (slots[l]?.max ?? 0) > 0);
</script>

<div class="mb-3">
  <div class="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-500">
    <span>Spell Slots</span>
    <button
      class="normal-case text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
      on:click={() => dispatch('toggleEditor')}
    >{showEditor ? 'done' : 'edit'}</button>
  </div>
  {#if showEditor}
    <div class="flex flex-wrap gap-2 text-xs">
      {#each SPELL_LEVELS as level}
        <label class="flex items-center gap-1">
          <span class="text-slate-500">L{level}</span>
          <input
            type="number"
            min="0"
            max="9"
            class="w-10 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-[11px]"
            value={slots[level]?.max ?? 0}
            on:change={(e) =>
              dispatch('setMax', {
                level,
                max: Math.max(0, Math.min(9, +e.currentTarget.value || 0))
              })}
          />
        </label>
      {/each}
    </div>
  {:else if usedLevels.length > 0}
    <div class="flex flex-wrap gap-3 text-xs">
      {#each usedLevels as level}
        {@const s = slots[level]}
        <div class="flex items-center gap-1">
          <span class="text-slate-500">L{level}</span>
          {#each Array(s.max) as _, i}
            <button
              class="h-4 w-4 rounded border text-center text-[9px] {i < s.used ? 'border-violet-500 bg-violet-900/50 text-violet-300' : 'border-slate-600 text-slate-600 hover:border-slate-400'}"
              title={i < s.used ? 'Restore slot' : 'Expend slot'}
              on:click={() => dispatch('toggleUsed', { level, slotIdx: i })}
            >◆</button>
          {/each}
        </div>
      {/each}
    </div>
  {:else}
    <span class="text-[11px] text-slate-600">None set — click edit to add</span>
  {/if}
</div>
