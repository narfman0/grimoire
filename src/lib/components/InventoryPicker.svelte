<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  export let items: Array<{
    slug: string;
    name: string;
    source: string;
    category: string;
    kindHint: string;
    requiresAttunement: boolean;
  }> = [];
  export let disabled = false;

  const dispatch = createEventDispatcher<{ pick: { slug: string } }>();

  let query = '';
  let inputEl: HTMLInputElement;
  let selectedIndex = 0;

  $: filtered = query.trim().length === 0
    ? items.slice(0, 50)
    : items
        .filter((i) =>
          i.name.toLowerCase().includes(query.toLowerCase()) ||
          i.category.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 50);

  $: if (filtered) selectedIndex = 0;

  onMount(() => {
    inputEl?.focus();
  });

  function pick(slug: string) {
    dispatch('pick', { slug });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) pick(filtered[selectedIndex].slug);
    } else if (e.key === 'Escape') {
      dispatch('pick', { slug: '' });
    }
  }

  const CATEGORY_COLORS: Record<string, string> = {
    weapon: 'text-red-400',
    armor: 'text-blue-400',
    wondrous: 'text-purple-400',
    ring: 'text-yellow-400',
    rod: 'text-orange-400',
    staff: 'text-green-400',
    wand: 'text-cyan-400',
    potion: 'text-pink-400',
    scroll: 'text-indigo-400',
    ammunition: 'text-red-300',
    adventuring: 'text-slate-400',
    tool: 'text-slate-400',
  };

  function catColor(cat: string) {
    return CATEGORY_COLORS[cat] ?? 'text-slate-500';
  }
</script>

<!-- backdrop -->
<button
  class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
  aria-label="Close picker"
  tabindex="-1"
  on:click={() => dispatch('pick', { slug: '' })}
></button>

<!-- panel -->
<div
  class="fixed left-1/2 top-1/2 z-50 flex w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
  role="dialog"
  aria-modal="true"
  aria-label="Add inventory item"
>
  <div class="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
    <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
    <input
      bind:this={inputEl}
      bind:value={query}
      type="text"
      placeholder="Search items…"
      class="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
      {disabled}
      on:keydown={onKeydown}
    />
    <button
      class="text-slate-600 hover:text-slate-400"
      on:click={() => dispatch('pick', { slug: '' })}
      aria-label="Close"
    >
      ✕
    </button>
  </div>

  <ul class="max-h-80 overflow-y-auto divide-y divide-slate-800/60">
    {#if filtered.length === 0}
      <li class="px-4 py-6 text-center text-sm text-slate-500">No items match "{query}"</li>
    {:else}
      {#each filtered as item, idx}
        <li>
          <button
            class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors
              {idx === selectedIndex ? 'bg-slate-700/60' : 'hover:bg-slate-800/60'}"
            on:click={() => pick(item.slug)}
            on:mouseenter={() => (selectedIndex = idx)}
          >
            <span class="flex-1 font-medium text-slate-100">{item.name}</span>
            {#if item.kindHint}
              <span class="text-xs {catColor(item.category)}">{item.kindHint}</span>
            {/if}
            {#if item.requiresAttunement}
              <span class="text-xs text-amber-500/70">attune</span>
            {/if}
            <span class="text-xs text-slate-600">{item.source}</span>
          </button>
        </li>
      {/each}
    {/if}
  </ul>

  <div class="border-t border-slate-800 px-4 py-2 text-xs text-slate-600">
    {items.length} items · ↑↓ navigate · Enter to add · Esc to close
  </div>
</div>
