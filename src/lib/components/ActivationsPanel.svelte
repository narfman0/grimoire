<script lang="ts">
  import type { AvailableActivation } from '$lib/rules';
  import { createEventDispatcher } from 'svelte';

  export let activations: AvailableActivation[] = [];
  export let busy = false;
  export let concentratingLabel: string | null = null;

  const dispatch = createEventDispatcher<{
    toggle: { id: string; on: boolean; variant?: string; slot?: number };
  }>();

  // Per-row variant pick. Seeded from a row's activeVariant when present
  // so toggling off then back on remembers the prior choice. The form
  // surface stays controlled (bind:value) even when the row is inactive.
  let variantPick: Record<string, string> = {};
  // Per-row slot pick for spells with scalingByCastSlot. Defaults to the
  // declaration's baseSlotLevel; player can bump up to higher slots.
  let slotPick: Record<string, number> = {};

  $: for (const a of activations) {
    if (variantPick[a.id] === undefined) {
      if (a.activeVariant) variantPick[a.id] = a.activeVariant;
      else if (a.variants && a.variants.length > 0) variantPick[a.id] = a.variants[0].id;
    }
    if (slotPick[a.id] === undefined && a.slotScaling) {
      slotPick[a.id] = a.activeSlot ?? a.slotScaling.baseSlotLevel;
    }
  }

  function handleToggle(a: AvailableActivation, on: boolean) {
    const detail: { id: string; on: boolean; variant?: string; slot?: number } = {
      id: a.id,
      on
    };
    if (on && a.variants && a.variants.length > 0) {
      detail.variant = variantPick[a.id] ?? a.variants[0].id;
    }
    if (on && a.slotScaling) {
      detail.slot = slotPick[a.id] ?? a.slotScaling.baseSlotLevel;
    }
    dispatch('toggle', detail);
  }

  function disabledReason(a: AvailableActivation): string | null {
    if (a.active) return null;
    if (a.usesRemaining === 0) return 'No uses remaining — rest to refresh';
    return null;
  }
</script>

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <h2 class="mb-2 text-sm font-semibold text-slate-200">Activations</h2>
  {#if activations.length === 0}
    <p class="text-xs text-slate-500">No activatable abilities on this character.</p>
  {:else}
    <ul class="space-y-2 text-sm">
      {#each activations as a (a.id)}
        {@const reason = disabledReason(a)}
        {@const wouldBreakConcentration =
          !a.active &&
          a.concentration &&
          concentratingLabel &&
          concentratingLabel !== a.name}
        <li
          class="rounded border p-2 {a.active
            ? 'border-emerald-700 bg-emerald-950/30'
            : 'border-slate-700 bg-slate-950/40'}"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-slate-200">{a.name}</span>
            {#if a.duration}
              <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                {a.duration}
              </span>
            {/if}
            {#if a.concentration}
              <span class="rounded bg-indigo-950/60 px-1.5 py-0.5 text-[10px] text-indigo-200">
                concentration
              </span>
            {/if}
            {#if a.usesMax !== null}
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-mono {a.usesRemaining === 0
                  ? 'bg-rose-950/60 text-rose-200'
                  : 'bg-slate-800 text-slate-300'}"
              >
                {a.usesRemaining}/{a.usesMax}
              </span>
            {/if}
            {#if a.cost && a.cost !== 'none'}
              <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                {a.cost}
              </span>
            {/if}
            <span class="ml-auto flex items-center gap-1">
              {#if a.variants && a.variants.length > 0}
                <select
                  bind:value={variantPick[a.id]}
                  class="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-xs disabled:opacity-50"
                  disabled={busy || a.active}
                  aria-label="{a.name} variant"
                >
                  {#each a.variants as v}
                    <option value={v.id}>{v.label}</option>
                  {/each}
                </select>
              {/if}
              {#if a.slotScaling}
                <label class="inline-flex items-center gap-1 text-[10px] text-slate-400">
                  slot
                  <input
                    type="number"
                    min={a.slotScaling.baseSlotLevel}
                    max="9"
                    bind:value={slotPick[a.id]}
                    class="w-12 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-xs disabled:opacity-50"
                    disabled={busy || a.active}
                    aria-label="{a.name} cast slot"
                  />
                </label>
              {/if}
              <button
                class="rounded border px-2 py-0.5 text-xs disabled:opacity-40 {a.active
                  ? 'border-emerald-600 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60'
                  : 'border-slate-600 text-slate-300 hover:bg-slate-800'}"
                disabled={busy || reason !== null}
                title={reason ?? ''}
                on:click={() => handleToggle(a, !a.active)}
              >
                {a.active ? '■ Deactivate' : '▶ Activate'}
              </button>
            </span>
          </div>
          {#if wouldBreakConcentration}
            <p class="mt-1 text-[11px] text-amber-300">
              Activating will end concentration on <span class="font-mono">{concentratingLabel}</span>.
            </p>
          {/if}
          {#if a.description}
            <p class="mt-1 whitespace-pre-wrap text-xs text-slate-400">{a.description}</p>
          {/if}
          {#if a.autoCancelOn && a.autoCancelOn.length > 0}
            <p class="mt-1 text-[11px] text-slate-500">
              Cancels if you become: {a.autoCancelOn.join(', ')}
            </p>
          {/if}
          <p class="mt-1 text-[10px] text-slate-600">
            {a.sourceContent.kind}/{a.sourceContent.slug}
          </p>
        </li>
      {/each}
    </ul>
  {/if}
</section>
