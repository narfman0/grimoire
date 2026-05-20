<script context="module" lang="ts">
  export interface MonsterOption {
    slug: string;
    name: string;
    source: string;
    cr: string;
    maxHp: number | null;
    ac: number | null;
    type: string;
    size: string;
  }
</script>

<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import MonsterStatblockView from './MonsterStatblockView.svelte';
  import { monsterDerive, type MonsterDerived } from '$lib/rules/monster-derive';

  export let monsters: MonsterOption[] = [];
  export let disabled = false;

  const dispatch = createEventDispatcher<{ pick: MonsterOption; close: void }>();

  let query = '';
  let filterCr = '';
  let filterType = '';
  let filterSize = '';
  let filterSource = '';
  let selectedIndex = 0;
  let inputEl: HTMLInputElement;

  /** The monster the user has highlighted for preview (separate from
   *  selectedIndex, which is the row that arrow-keys/hover focus). Null
   *  until the user clicks a row or presses Enter. */
  let previewMonster: MonsterOption | null = null;
  /** Cached derived statblock for the currently-previewed monster. Fetched
   *  via /api/content/monster/{slug} on demand; falls back to a sparse
   *  view from the summary fields if the fetch hasn't returned yet. */
  let previewStatblock: MonsterDerived | null = null;
  let previewLoading = false;
  let previewError: string | null = null;
  let previewToken = 0; // ignore stale fetches if the user re-picks fast

  // CR sort order helper
  const CR_ORDER: Record<string, number> = {
    '0': 0, '1/8': 0.125, '1/4': 0.25, '1/2': 0.5
  };
  function crNum(cr: string): number {
    return CR_ORDER[cr] ?? parseFloat(cr) ?? 99;
  }

  // Unique filter values
  $: allTypes = [...new Set(monsters.map(m => m.type).filter(Boolean))].sort();
  $: allSizes = ['tiny','small','medium','large','huge','gargantuan'].filter(s =>
    monsters.some(m => m.size === s)
  );
  $: allSources = [...new Set(monsters.map(m => m.source).filter(Boolean))].sort();
  $: allCrs = [...new Set(monsters.map(m => m.cr))].sort((a,b) => crNum(a) - crNum(b));

  $: filtered = monsters
    .filter(m => {
      if (filterCr && m.cr !== filterCr) return false;
      if (filterType && m.type !== filterType) return false;
      if (filterSize && m.size !== filterSize) return false;
      if (filterSource && m.source !== filterSource) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      if (filterCr === '') return a.name.localeCompare(b.name);
      return crNum(a.cr) - crNum(b.cr) || a.name.localeCompare(b.name);
    })
    .slice(0, 100);

  $: if (filtered) selectedIndex = 0;

  onMount(() => inputEl?.focus());

  /** Click / arrow-Enter → highlight this monster for preview. Adding to
   *  the encounter is a separate gesture (the footer button or a second
   *  Enter when this monster is already previewed). */
  async function preview(m: MonsterOption) {
    previewMonster = m;
    previewStatblock = null;
    previewError = null;
    previewLoading = true;
    const token = ++previewToken;
    try {
      const res = await fetch(`/api/content/monster/${m.slug}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: Record<string, unknown> };
      if (token !== previewToken) return; // user clicked another row
      previewStatblock = monsterDerive(body.data);
    } catch (err) {
      if (token !== previewToken) return;
      previewError = err instanceof Error ? err.message : 'load failed';
    } finally {
      if (token === previewToken) previewLoading = false;
    }
  }

  function confirmPick() {
    if (previewMonster) dispatch('pick', previewMonster);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = Math.max(selectedIndex - 1, 0); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const row = filtered[selectedIndex];
      if (!row) return;
      // First Enter on a row previews it; second Enter (when it's already the
      // preview target) confirms. Keyboard power-users hit Enter twice for
      // the old immediate-add behavior.
      if (previewMonster && previewMonster.slug === row.slug) confirmPick();
      else preview(row);
    }
    else if (e.key === 'Escape') {
      if (previewMonster) { previewMonster = null; previewStatblock = null; }
      else dispatch('close');
    }
  }

  const CR_COLOR: Record<string, string> = {
    '0':'text-slate-400','1/8':'text-slate-400','1/4':'text-slate-400','1/2':'text-slate-400',
    '1':'text-green-400','2':'text-green-400','3':'text-green-400','4':'text-green-400',
    '5':'text-yellow-400','6':'text-yellow-400','7':'text-yellow-400','8':'text-yellow-400',
    '9':'text-orange-400','10':'text-orange-400','11':'text-orange-400','12':'text-orange-400',
    '13':'text-red-400','14':'text-red-400','15':'text-red-400','16':'text-red-400',
    '17':'text-red-500','18':'text-red-500','19':'text-red-500','20':'text-red-500',
    '21':'text-purple-400','22':'text-purple-400','23':'text-purple-400','24':'text-purple-400',
    '25':'text-purple-500','26':'text-purple-500','27':'text-purple-500','28':'text-purple-500',
    '29':'text-fuchsia-400','30':'text-fuchsia-400',
  };
  function crColor(cr: string) { return CR_COLOR[cr] ?? 'text-slate-400'; }

  const SIZE_ABBR: Record<string, string> = {
    tiny:'T', small:'S', medium:'M', large:'L', huge:'H', gargantuan:'G', varies:'V'
  };
</script>

<!-- backdrop -->
<button
  class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
  aria-label="Close"
  tabindex="-1"
  on:click={() => dispatch('close')}
/>

<!-- panel -->
<div
  class="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
  role="dialog"
  aria-modal="true"
  aria-label="Add monster"
>
  <!-- search row -->
  <div class="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
    <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
    <input
      bind:this={inputEl}
      bind:value={query}
      type="text"
      placeholder="Search monsters…"
      class="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
      {disabled}
      on:keydown={onKeydown}
    />
    <button class="text-slate-600 hover:text-slate-400" on:click={() => dispatch('close')} aria-label="Close">✕</button>
  </div>

  <!-- filter bar -->
  <div class="flex flex-wrap gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-2">
    <select
      bind:value={filterCr}
      class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-xs text-slate-300"
    >
      <option value="">Any CR</option>
      {#each allCrs as cr}
        <option value={cr}>CR {cr}</option>
      {/each}
    </select>

    <select
      bind:value={filterType}
      class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-xs text-slate-300"
    >
      <option value="">Any type</option>
      {#each allTypes as t}
        <option value={t}>{t}</option>
      {/each}
    </select>

    <select
      bind:value={filterSize}
      class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-xs text-slate-300"
    >
      <option value="">Any size</option>
      {#each allSizes as s}
        <option value={s}>{s}</option>
      {/each}
    </select>

    <select
      bind:value={filterSource}
      class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-xs text-slate-300"
    >
      <option value="">Any source</option>
      {#each allSources as s}
        <option value={s}>{s}</option>
      {/each}
    </select>

    {#if filterCr || filterType || filterSize || filterSource}
      <button
        class="text-xs text-slate-500 hover:text-slate-300"
        on:click={() => { filterCr=''; filterType=''; filterSize=''; filterSource=''; }}
      >
        clear filters
      </button>
    {/if}

    <span class="ml-auto text-xs text-slate-600">{filtered.length} shown</span>
  </div>

  <!-- results -->
  <ul class="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
    {#if filtered.length === 0}
      <li class="px-4 py-6 text-center text-sm text-slate-500">No monsters match</li>
    {:else}
      {#each filtered as m, idx}
        <li>
          <button
            class="grid w-full grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 px-4 py-2 text-left text-sm transition-colors
              {previewMonster?.slug === m.slug
                ? 'bg-emerald-900/30 ring-1 ring-emerald-700 ring-inset'
                : idx === selectedIndex
                  ? 'bg-slate-700/60'
                  : 'hover:bg-slate-800/60'}"
            on:click={() => preview(m)}
            on:mouseenter={() => (selectedIndex = idx)}
          >
            <span class="font-medium text-slate-100 truncate">{m.name}</span>
            <span class="text-xs text-slate-500">{SIZE_ABBR[m.size] ?? ''} {m.type}</span>
            {#if m.ac != null}
              <span class="text-xs text-blue-400/80">AC {m.ac}</span>
            {:else}
              <span></span>
            {/if}
            {#if m.maxHp != null}
              <span class="text-xs text-emerald-400/80">{m.maxHp} HP</span>
            {:else}
              <span></span>
            {/if}
            <span class="text-xs font-mono {crColor(m.cr)}">CR {m.cr}</span>
          </button>
        </li>
      {/each}
    {/if}
  </ul>

  {#if previewMonster}
    <div class="border-t border-slate-800 bg-slate-950/50 px-4 py-3 overflow-y-auto max-h-[40vh]">
      <div class="mb-2 flex items-baseline gap-2">
        <span class="text-sm font-semibold text-slate-100">{previewMonster.name}</span>
        <span class="text-xs text-slate-500">{previewMonster.source}</span>
      </div>
      {#if previewLoading}
        <div class="text-xs text-slate-500">Loading details…</div>
      {:else if previewError}
        <div class="text-xs text-amber-400">Couldn't load full statblock ({previewError}). Showing summary.</div>
        <div class="mt-2 text-xs text-slate-400">
          {previewMonster.size} {previewMonster.type}
          {#if previewMonster.ac != null} · AC {previewMonster.ac}{/if}
          {#if previewMonster.maxHp != null} · HP {previewMonster.maxHp}{/if}
          · CR {previewMonster.cr}
        </div>
      {:else if previewStatblock}
        <MonsterStatblockView statblock={previewStatblock} dense />
      {/if}
    </div>
  {/if}

  <div class="flex items-center gap-2 border-t border-slate-800 px-4 py-2 text-xs">
    <span class="text-slate-600 hidden sm:inline">
      {monsters.length} loaded · ↑↓ navigate · Enter to {previewMonster ? 'add' : 'preview'} · Esc to {previewMonster ? 'clear' : 'close'}
    </span>
    <div class="ml-auto flex items-center gap-2">
      <button
        class="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
        on:click={() => dispatch('close')}
      >Cancel</button>
      <button
        class="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1 text-emerald-200 hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!previewMonster || disabled}
        on:click={confirmPick}
      >Add{previewMonster ? ` ${previewMonster.name}` : ''}</button>
    </div>
  </div>
</div>
