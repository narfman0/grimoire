<script context="module" lang="ts">
  import type { AvailableToggle } from '$lib/rules/types';

  export interface ToggleRow extends AvailableToggle {
    sourceName?: string;
    description?: string;
  }
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import HoverPopup from './HoverPopup.svelte';

  export let toggles: ToggleRow[] = [];
  export let busy = false;

  const dispatch = createEventDispatcher<{ toggle: { id: string; enabled: boolean } }>();

  function handleChange(id: string, e: Event) {
    dispatch('toggle', { id, enabled: (e.target as HTMLInputElement).checked });
  }
</script>

{#if toggles.length > 0}
  <div>
    <h2 class="mb-2 text-sm font-semibold text-slate-200">Toggles</h2>
    <ul class="flex flex-wrap gap-2 text-sm">
      {#each toggles as t}
        <li>
          <label class="inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs
            {t.currentlyEnabled
              ? 'border-emerald-600 bg-emerald-900/30 text-emerald-200'
              : 'border-slate-700 text-slate-400 hover:text-slate-200'}">
            <input
              type="checkbox"
              class="hidden"
              checked={t.currentlyEnabled}
              disabled={busy}
              on:change={(e) => handleChange(t.id, e)}
            />
            <HoverPopup>
              <span>{t.name}</span>
              <svelte:fragment slot="popup">
                <div class="mb-1 font-semibold text-slate-200">{t.sourceName ?? t.name}</div>
                {#if t.description}
                  <p class="whitespace-pre-wrap text-slate-300">{t.description}</p>
                {/if}
              </svelte:fragment>
            </HoverPopup>
          </label>
        </li>
      {/each}
    </ul>
  </div>
{/if}
