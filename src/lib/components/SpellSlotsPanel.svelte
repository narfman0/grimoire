<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let slots: Array<{ level: number; max: number; used: number }> = [];
  export let busy = false;

  const dispatch = createEventDispatcher<{ use: number; restore: number }>();
</script>

{#if slots.length > 0}
  <div class="mt-3 space-y-1">
    {#each slots as slot}
      <div class="flex items-center gap-2">
        <span class="w-16 text-xs text-slate-400">Level {slot.level}</span>
        <div class="flex gap-1">
          {#each Array(slot.max) as _, i}
            {@const used = i < slot.used}
            <button
              class="h-4 w-4 rounded-full border text-[10px]
                {used
                  ? 'border-slate-600 bg-slate-800 text-slate-500'
                  : 'border-emerald-600 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/60'}"
              disabled={busy}
              title={used ? `Restore level ${slot.level} slot` : `Use level ${slot.level} slot`}
              on:click={() => used ? dispatch('restore', slot.level) : dispatch('use', slot.level)}
            ></button>
          {/each}
        </div>
        <span class="text-xs text-slate-500">{slot.max - slot.used}/{slot.max}</span>
      </div>
    {/each}
  </div>
{/if}
