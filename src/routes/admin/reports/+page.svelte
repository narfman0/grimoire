<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { api } from '$lib/client/api';
  import type { PageData } from './$types';
  export let data: PageData;

  let busy = '';

  async function resolve(id: string, resolution: 'hidden' | 'dismissed') {
    busy = id;
    try {
      await api.patch(`/api/admin/reports/${encodeURIComponent(id)}`, { resolution });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = '';
    }
  }
</script>

<svelte:head><title>Reports · Admin · Grimoire</title></svelte:head>

<header class="mb-6">
  <h1 class="text-2xl font-semibold">Reports queue</h1>
  <p class="text-sm text-slate-400">
    Open reports of homebrew content. <strong>Hide</strong> sets the row's visibility back to private (subscribers keep their existing link). <strong>Dismiss</strong> closes the report with no content action.
  </p>
</header>

{#if data.reports.length === 0}
  <p class="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
    No open reports.
  </p>
{:else}
  <ul class="space-y-3">
    {#each data.reports as r}
      <li class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
        <div class="mb-2 flex items-baseline justify-between">
          <div>
            <a
              class="text-emerald-300 hover:text-emerald-200"
              href={`/homebrew/browse/${encodeURIComponent(r.content.ownerUsername ?? 'unknown')}/${r.content.kind}/${r.content.slug}`}
            >{r.content.name}</a>
            <span class="ml-2 rounded border border-slate-700 px-1 text-[10px] uppercase tracking-wide text-slate-400">{r.content.kind}</span>
            <span class="ml-2 text-xs text-slate-500">by {r.content.ownerUsername ?? 'deleted'} · currently {r.content.visibility}</span>
          </div>
          <span class="text-xs text-slate-500">reported {new Date(r.createdAt).toLocaleString()} by {r.reporterUsername ?? 'deleted user'}</span>
        </div>
        <p class="mb-3 whitespace-pre-wrap rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">{r.reason}</p>
        <div class="flex items-center gap-2 text-sm">
          <button
            class="rounded bg-red-700 px-3 py-1 text-red-100 hover:bg-red-600 disabled:opacity-40"
            on:click={() => resolve(r.id, 'hidden')}
            disabled={busy === r.id}
          >Hide content</button>
          <button
            class="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800 disabled:opacity-40"
            on:click={() => resolve(r.id, 'dismissed')}
            disabled={busy === r.id}
          >Dismiss</button>
        </div>
      </li>
    {/each}
  </ul>
{/if}
