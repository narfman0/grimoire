<script lang="ts">
  import { page } from '$app/stores';
  import { goto, invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  export let data: PageData;

  let busy = '';

  function updateFilter(patch: Record<string, string>) {
    const params = new URLSearchParams($page.url.searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete('page'); // reset to first page on filter change
    goto(`/homebrew/browse?${params.toString()}`, { keepFocus: true });
  }

  function onSearchChange(e: Event) {
    const el = e.target as HTMLInputElement;
    updateFilter({ q: el.value });
  }
  function onKindChange(e: Event) {
    const el = e.target as HTMLSelectElement;
    updateFilter({ kind: el.value });
  }
  function onSortChange(e: Event) {
    const el = e.target as HTMLSelectElement;
    updateFilter({ sort: el.value });
  }

  async function subscribe(item: PageData['items'][number]) {
    busy = `sub:${item.kind}/${item.slug}/${item.authorUserId}`;
    try {
      await fetch('/api/homebrew/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: item.kind, slug: item.slug, authorUserId: item.authorUserId })
      });
      await invalidateAll();
    } finally {
      busy = '';
    }
  }
  async function unsubscribe(item: PageData['items'][number]) {
    busy = `unsub:${item.kind}/${item.slug}/${item.authorUserId}`;
    try {
      await fetch(
        `/api/homebrew/subscriptions/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.slug)}/${encodeURIComponent(item.authorUserId ?? '')}`,
        { method: 'DELETE' }
      );
      await invalidateAll();
    } finally {
      busy = '';
    }
  }
</script>

<svelte:head><title>Homebrew marketplace · Grimoire</title></svelte:head>

<header class="mb-4">
  <h1 class="text-2xl font-semibold">Homebrew marketplace</h1>
  <p class="text-sm text-slate-400">Browse community-authored content. Subscribe for live updates, or fork into your own library to edit.</p>
</header>

<!-- Filter bar -->
<div class="mb-4 grid gap-2 sm:grid-cols-12">
  <input
    type="search"
    class="sm:col-span-5 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
    placeholder="Search by name"
    value={data.filter.q}
    on:change={onSearchChange}
  />
  <select
    class="sm:col-span-4 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
    value={data.filter.kind}
    on:change={onKindChange}
  >
    <option value="">All kinds</option>
    {#each data.kinds as k}
      <option value={k}>{k}</option>
    {/each}
  </select>
  <select
    class="sm:col-span-3 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
    value={data.filter.sort}
    on:change={onSortChange}
  >
    <option value="newest">Newest</option>
    <option value="name">Name</option>
    <option value="subscribed">Most subscribed</option>
  </select>
</div>

{#if data.items.length === 0}
  <p class="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
    No public homebrew{data.filter.q || data.filter.kind ? ' matches those filters' : ' yet'}.
    Be the first to publish — head to <a href="/me/homebrew/feats" class="text-emerald-300 hover:text-emerald-200">/me/homebrew</a>.
  </p>
{:else}
  <ul class="grid gap-3 sm:grid-cols-2">
    {#each data.items as item}
      <li class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
        <div class="mb-1 flex items-baseline justify-between">
          <a
            href={`/homebrew/browse/${encodeURIComponent(item.authorUsername ?? 'unknown')}/${item.kind}/${item.slug}`}
            class="text-emerald-300 hover:text-emerald-200 font-medium"
          >{item.name}</a>
          <span class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{item.kind}</span>
        </div>
        <div class="mb-2 text-xs text-slate-500">
          by <a href={`/homebrew/author/${encodeURIComponent(item.authorUsername ?? '')}`} class="hover:text-slate-300">{item.authorUsername ?? 'unknown'}</a>
          {#if item.category} · {item.category}{/if}
          · {item.subscriberCount} subscriber{item.subscriberCount === 1 ? '' : 's'}
        </div>
        {#if item.description}
          <p class="mb-3 text-sm text-slate-400 line-clamp-3">{item.description}</p>
        {/if}
        <div class="flex items-center gap-2 text-xs">
          {#if item.viewerSubscribed}
            <button
              class="rounded border border-emerald-700 bg-emerald-950/50 px-2 py-1 text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-40"
              on:click={() => unsubscribe(item)}
              disabled={busy === `unsub:${item.kind}/${item.slug}/${item.authorUserId}`}
            >✓ Subscribed</button>
          {:else}
            <button
              class="rounded bg-emerald-600 px-2 py-1 hover:bg-emerald-500 disabled:opacity-40"
              on:click={() => subscribe(item)}
              disabled={busy === `sub:${item.kind}/${item.slug}/${item.authorUserId}`}
            >+ Subscribe</button>
          {/if}
          <a
            class="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"
            href={`/homebrew/browse/${encodeURIComponent(item.authorUsername ?? 'unknown')}/${item.kind}/${item.slug}`}
          >View</a>
        </div>
      </li>
    {/each}
  </ul>

  {#if data.total > data.pageSize}
    <nav class="mt-4 flex items-center justify-between text-sm text-slate-400">
      <span>Page {data.page + 1} of {Math.ceil(data.total / data.pageSize)} · {data.total} total</span>
      <div class="flex gap-2">
        {#if data.page > 0}
          <a class="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800" href={`?${new URLSearchParams({ ...Object.fromEntries($page.url.searchParams), page: String(data.page - 1) }).toString()}`}>← Prev</a>
        {/if}
        {#if (data.page + 1) * data.pageSize < data.total}
          <a class="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800" href={`?${new URLSearchParams({ ...Object.fromEntries($page.url.searchParams), page: String(data.page + 1) }).toString()}`}>Next →</a>
        {/if}
      </div>
    </nav>
  {/if}
{/if}
