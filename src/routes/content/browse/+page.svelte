<script lang="ts">
  import { page } from '$app/stores';
  import { goto, invalidateAll } from '$app/navigation';
  import { api } from '$lib/client/api';
  import type { PageData } from './$types';
  export let data: PageData;

  let busy = '';

  function updateFilter(patch: Record<string, string>) {
    const params = new URLSearchParams($page.url.searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete('page');
    goto(`/content/browse?${params.toString()}`, { keepFocus: true });
  }

  function onChangeFor(field: string) {
    return (e: Event) => updateFilter({ [field]: (e.target as HTMLInputElement | HTMLSelectElement).value });
  }

  /** Detail URL for an item — pack content takes a separate path because it
   *  has no author username. */
  function detailHref(item: PageData['items'][number]): string {
    if (item.authorUsername) {
      return `/content/browse/${encodeURIComponent(item.authorUsername)}/${item.kind}/${item.slug}`;
    }
    return `/content/browse/pack/${encodeURIComponent(item.packSlug)}/${item.kind}/${item.slug}`;
  }

  async function subscribe(item: PageData['items'][number]) {
    if (!item.authorUserId) return;
    busy = `sub:${item.kind}/${item.slug}/${item.authorUserId}`;
    try {
      await api.post('/api/homebrew/subscriptions', {
        kind: item.kind,
        slug: item.slug,
        authorUserId: item.authorUserId
      });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = '';
    }
  }
  async function unsubscribe(item: PageData['items'][number]) {
    if (!item.authorUserId) return;
    busy = `unsub:${item.kind}/${item.slug}/${item.authorUserId}`;
    try {
      await api.del(
        `/api/homebrew/subscriptions/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.slug)}/${encodeURIComponent(item.authorUserId)}`
      );
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = '';
    }
  }
</script>

<svelte:head><title>Content marketplace · Grimoire</title></svelte:head>

<header class="mb-4">
  <h1 class="text-2xl font-semibold">Content marketplace</h1>
  <p class="text-sm text-slate-400">SRD packs, homebrew, and future editions in one library. Subscribe to homebrew for live updates, or fork into your own library to edit.</p>
</header>

<div class="mb-4 grid gap-2 sm:grid-cols-12">
  <input
    type="search"
    class="sm:col-span-4 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
    placeholder="Search by name"
    value={data.filter.q}
    on:change={onChangeFor('q')}
  />
  <select
    class="sm:col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
    value={data.filter.kind}
    on:change={onChangeFor('kind')}
  >
    <option value="">All kinds</option>
    {#each data.kinds as k}
      <option value={k}>{k}</option>
    {/each}
  </select>
  <select
    class="sm:col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
    value={data.filter.source}
    on:change={onChangeFor('source')}
  >
    <option value="">All sources</option>
    {#each data.sources as s}
      <option value={s}>{s}</option>
    {/each}
  </select>
  <select
    class="sm:col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
    value={data.filter.edition}
    on:change={onChangeFor('edition')}
  >
    <option value="">All editions</option>
    {#each data.editions as e}
      <option value={e}>{e}</option>
    {/each}
  </select>
  <select
    class="sm:col-span-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
    value={data.filter.sort}
    on:change={onChangeFor('sort')}
  >
    <option value="newest">Newest</option>
    <option value="name">Name</option>
    <option value="subscribed">Most subscribed</option>
  </select>
</div>

{#if data.items.length === 0}
  <p class="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
    No content matches those filters.
  </p>
{:else}
  <ul class="grid gap-3 sm:grid-cols-2">
    {#each data.items as item}
      <li class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
        <div class="mb-1 flex items-baseline justify-between gap-2">
          <a
            href={detailHref(item)}
            class="text-emerald-300 hover:text-emerald-200 font-medium"
          >{item.name}</a>
          <span class="flex items-center gap-1">
            {#if item.cr != null}
              <span class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">CR {item.cr}</span>
            {/if}
            <span class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{item.kind}</span>
          </span>
        </div>
        <div class="mb-2 text-xs text-slate-500">
          {#if item.authorUsername}
            by <a href={`/homebrew/author/${encodeURIComponent(item.authorUsername)}`} class="hover:text-slate-300">{item.authorUsername}</a>
          {:else}
            from <span class="text-slate-300">{item.source}</span>
          {/if}
          {#if item.edition} · <span class="rounded border border-slate-700 px-1 text-[10px] uppercase tracking-wide">{item.edition}</span>{/if}
          {#if item.category} · {item.category}{/if}
          {#if item.authorUsername} · {item.subscriberCount} subscriber{item.subscriberCount === 1 ? '' : 's'}{/if}
        </div>
        {#if item.description}
          <p class="mb-3 text-sm text-slate-400 line-clamp-3">{item.description}</p>
        {/if}
        <div class="flex items-center gap-2 text-xs">
          {#if item.authorUserId}
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
          {/if}
          <a
            class="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"
            href={detailHref(item)}
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
