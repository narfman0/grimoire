<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<svelte:head><title>{data.author.username} · Homebrew · Grimoire</title></svelte:head>

<header class="mb-6">
  <a class="text-xs text-slate-400 hover:text-slate-200" href="/homebrew/browse">← Marketplace</a>
  <h1 class="text-2xl font-semibold">{data.author.username}</h1>
  <p class="text-sm text-slate-400">
    {data.items.length} published item{data.items.length === 1 ? '' : 's'}
    {#each Object.entries(data.counts) as [kind, n]}
      · {n} {kind}{n === 1 ? '' : 's'}
    {/each}
    {#if data.isOwner} · this is you{/if}
  </p>
</header>

{#if data.items.length === 0}
  <p class="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
    {data.author.username} hasn't published anything yet.
  </p>
{:else}
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
        <th class="py-2">Name</th>
        <th>Kind</th>
        <th>Visibility</th>
        <th>Category</th>
      </tr>
    </thead>
    <tbody>
      {#each data.items as item}
        <tr class="border-b border-slate-900 hover:bg-slate-900/40">
          <td class="py-2">
            <a class="text-emerald-300 hover:text-emerald-200" href={`/homebrew/browse/${encodeURIComponent(data.author.username)}/${item.kind}/${item.slug}`}>{item.name}</a>
            {#if item.description}
              <div class="text-[11px] text-slate-500">{item.description}</div>
            {/if}
          </td>
          <td class="text-slate-300">{item.kind}</td>
          <td class="text-xs text-slate-500">{item.visibility}</td>
          <td class="text-slate-400">{item.category || '—'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
