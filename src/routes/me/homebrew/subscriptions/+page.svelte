<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { api } from '$lib/client/api';
  import type { PageData } from './$types';
  export let data: PageData;

  let busy = '';

  function subUrl(kind: string, slug: string, authorUserId: string): string {
    return `/api/homebrew/subscriptions/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}/${encodeURIComponent(authorUserId)}`;
  }

  async function unsubscribe(kind: string, slug: string, authorUserId: string) {
    busy = `unsub:${kind}/${slug}/${authorUserId}`;
    try {
      await api.del(subUrl(kind, slug, authorUserId));
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = '';
    }
  }

  async function upgrade(kind: string, slug: string, authorUserId: string, toVersion: number) {
    busy = `upgrade:${kind}/${slug}/${authorUserId}`;
    try {
      await api.patch(subUrl(kind, slug, authorUserId), { pinnedVersion: toVersion });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = '';
    }
  }
</script>

<svelte:head><title>My subscriptions · Grimoire</title></svelte:head>

<header class="mb-6">
  <h1 class="text-2xl font-semibold">My subscriptions</h1>
  <p class="text-sm text-slate-400">
    Homebrew rows you've subscribed to from other authors. Each subscription pins to a specific version; click <em>Upgrade</em> when the author publishes a newer one. Browse more at <a href="/homebrew/browse" class="text-emerald-300 hover:text-emerald-200">/homebrew/browse</a>.
  </p>
</header>

{#if data.subscriptions.length === 0}
  <p class="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
    No subscriptions yet. Find homebrew you like in the marketplace and click Subscribe.
  </p>
{:else}
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
        <th class="py-2">Name</th>
        <th>Kind</th>
        <th>Author</th>
        <th>Version</th>
        <th>Visibility</th>
        <th class="text-right">Subscribed</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each data.subscriptions as s}
        <tr class="border-b border-slate-900 hover:bg-slate-900/40">
          <td class="py-2">
            {#if s.orphaned}
              <span class="text-slate-500 italic">(deleted)</span>
              <div class="font-mono text-[11px] text-slate-600">{s.slug}</div>
            {:else}
              <a class="text-emerald-300 hover:text-emerald-200" href={`/homebrew/browse/${encodeURIComponent(s.authorUsername)}/${s.kind}/${s.slug}`}>{s.contentName}</a>
              <div class="font-mono text-[11px] text-slate-500">{s.slug}</div>
            {/if}
          </td>
          <td class="text-slate-300">{s.kind}</td>
          <td><a class="text-slate-300 hover:text-slate-100" href={`/homebrew/author/${encodeURIComponent(s.authorUsername)}`}>{s.authorUsername}</a></td>
          <td class="text-xs">
            <span class="text-slate-300">v{s.pinnedVersion ?? '—'}</span>
            {#if s.updateAvailable}
              <span class="ml-1 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200">v{s.latestPublishedVersion} available</span>
            {/if}
          </td>
          <td class="text-xs text-slate-500">{s.visibility ?? '—'}</td>
          <td class="text-right text-xs text-slate-500">{new Date(s.createdAt).toLocaleDateString()}</td>
          <td class="space-x-1 text-right">
            {#if s.updateAvailable && s.latestPublishedVersion !== null}
              {@const target = s.latestPublishedVersion}
              <button
                class="rounded border border-amber-700 bg-amber-900/40 px-2 py-0.5 text-xs text-amber-100 hover:bg-amber-800 disabled:opacity-40"
                on:click={() => upgrade(s.kind, s.slug, s.authorUserId, target)}
                disabled={busy === `upgrade:${s.kind}/${s.slug}/${s.authorUserId}`}
              >Upgrade</button>
            {/if}
            <button
              class="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
              on:click={() => unsubscribe(s.kind, s.slug, s.authorUserId)}
              disabled={busy === `unsub:${s.kind}/${s.slug}/${s.authorUserId}`}
            >Unsubscribe</button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
