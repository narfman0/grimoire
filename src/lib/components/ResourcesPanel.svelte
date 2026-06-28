<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Resource } from '$lib/rules/types';

  export let resources: Resource[] = [];
  export let busy = false;

  const dispatch = createEventDispatcher<{ use: string; restore: string }>();
</script>

{#if resources.length > 0}
  <div class="space-y-2">
    {#each resources as res}
      <div class="flex items-center gap-2">
        <span class="min-w-[120px] text-xs text-slate-300">{res.name}</span>
        <div class="flex gap-1">
          {#each Array(res.max) as _, i}
            {@const spent = i < res.used}
            <button
              class="h-4 w-4 rounded border text-[10px]
                {spent
                  ? 'border-slate-600 bg-slate-800 text-slate-500'
                  : 'border-amber-600 bg-amber-900/30 text-amber-200 hover:bg-amber-800/50'}"
              disabled={busy}
              title={spent ? `Restore ${res.name}` : `Use ${res.name}`}
              on:click={() => spent ? dispatch('restore', res.id) : dispatch('use', res.id)}
            ></button>
          {/each}
        </div>
        <span class="text-xs text-slate-500">{res.max - res.used}/{res.max} · {res.per}</span>
      </div>
    {/each}
  </div>
{/if}
