<script lang="ts">
  import type { ReceivedBuff } from '$lib/rules';
  import { createEventDispatcher } from 'svelte';

  type SpellOption = {
    pickerId?: string;
    slug: string;
    name: string;
    level?: number;
    concentration?: boolean;
  };

  export let buffs: ReceivedBuff[] = [];
  export let spellOptions: SpellOption[] = [];
  export let busy = false;

  const dispatch = createEventDispatcher<{
    add: { spellSlug: string; slot?: number };
    remove: { id: string };
    update: { id: string; patch: Partial<ReceivedBuff> };
  }>();

  let pickerSlug = '';

  function handleAdd() {
    if (!pickerSlug) return;
    const opt = spellOptions.find((s) => s.slug === pickerSlug);
    const slot = opt?.level !== undefined ? opt.level : undefined;
    dispatch('add', { spellSlug: pickerSlug, ...(slot !== undefined ? { slot } : {}) });
    pickerSlug = '';
  }

  function spellName(slug: string): string {
    return spellOptions.find((s) => s.slug === slug)?.name ?? slug;
  }

  function inputValue(e: Event): string {
    return (e.currentTarget as HTMLInputElement).value;
  }
  function inputInt(e: Event): number {
    return parseInt((e.currentTarget as HTMLInputElement).value, 10);
  }
</script>

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <h2 class="mb-2 text-sm font-semibold text-slate-200">Received Buffs</h2>
  <p class="mb-2 text-xs text-slate-500">
    Buffs an ally cast on you (Shield of Faith, Bless, Longstrider, etc.). Add an
    entry when a buff lands; remove it when the buff ends. Modifiers apply to your
    sheet while the entry is present.
  </p>
  {#if buffs.length > 0}
    <ul class="mb-3 space-y-2 text-sm">
      {#each buffs as b (b.id)}
        <li class="rounded border border-emerald-700 bg-emerald-950/30 p-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-slate-200">{spellName(b.spellSlug)}</span>
            {#if b.slot !== undefined}
              <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                slot {b.slot}
              </span>
            {/if}
            <button
              class="ml-auto rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
              disabled={busy}
              on:click={() => dispatch('remove', { id: b.id })}
            >
              Remove
            </button>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <label class="inline-flex items-center gap-1 text-[11px] text-slate-400">
              source
              <input
                type="text"
                placeholder="e.g. from Cleric Vortha"
                value={b.sourceLabel ?? ''}
                class="w-48 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-xs"
                disabled={busy}
                on:change={(e) => dispatch('update', { id: b.id, patch: { sourceLabel: inputValue(e) } })}
              />
            </label>
            {#if b.slot !== undefined}
              <label class="inline-flex items-center gap-1 text-[11px] text-slate-400">
                slot
                <input
                  type="number"
                  min="1"
                  max="9"
                  value={b.slot}
                  class="w-12 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-xs"
                  disabled={busy}
                  on:change={(e) => dispatch('update', { id: b.id, patch: { slot: inputInt(e) } })}
                />
              </label>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="flex items-center gap-2">
    <select
      bind:value={pickerSlug}
      class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs disabled:opacity-50"
      disabled={busy}
      aria-label="Pick a spell to receive as a buff"
    >
      <option value="">— pick a spell —</option>
      {#each spellOptions as opt}
        <option value={opt.slug}>
          {opt.name}{opt.level !== undefined ? ` (L${opt.level})` : ''}{opt.concentration ? ' · concentration' : ''}
        </option>
      {/each}
    </select>
    <button
      class="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40"
      disabled={busy || !pickerSlug}
      on:click={handleAdd}
    >
      Add buff
    </button>
  </div>
</section>
