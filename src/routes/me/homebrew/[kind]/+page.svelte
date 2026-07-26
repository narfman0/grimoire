<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { api } from '$lib/client/api';
  import type { PageData } from './$types';
  export let data: PageData;

  let busy = '';

  function onVisibilityChange(slug: string, current: string, e: Event) {
    const el = e.target as HTMLSelectElement;
    void setVisibility(slug, current, el.value as 'private' | 'unlisted' | 'public');
  }

  async function setVisibility(slug: string, current: string, next: 'private' | 'unlisted' | 'public') {
    if (current === next) return;
    if (next === 'public' && current !== 'public') {
      if (!confirm("Make this public? Anyone logged in will see it in /homebrew/browse.")) return;
    }
    busy = slug;
    try {
      await api(
        `/api/homebrew/${encodeURIComponent(data.kind)}/${encodeURIComponent(slug)}/visibility`,
        { method: 'PUT', body: { visibility: next } }
      );
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = '';
    }
  }
</script>

<svelte:head><title>My homebrew {data.kind}s · Grimoire</title></svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    <a class="text-xs text-slate-400 hover:text-slate-200" href="/me/homebrew">← All kinds</a>
    <h1 class="text-2xl font-semibold">Homebrew {data.kind}s</h1>
  </div>
  <a
    href={`/me/homebrew/${encodeURIComponent(data.kind)}/new`}
    class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500"
  >+ New {data.kind}</a>
</header>

{#if data.items.length === 0}
  <p class="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
    No homebrew {data.kind}s yet. Create one to see it in any of your characters' pickers.
  </p>
{:else}
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
        <th class="py-2">Name</th>
        <th>Category</th>
        <th>Visibility</th>
        <th class="text-right">Updated</th>
      </tr>
    </thead>
    <tbody>
      {#each data.items as it}
        <tr class="border-b border-slate-900 hover:bg-slate-900/40">
          <td class="py-2">
            <a class="text-emerald-300 hover:text-emerald-200" href={`/me/homebrew/${encodeURIComponent(data.kind)}/${it.slug}`}>{it.name}</a>
            <div class="font-mono text-[11px] text-slate-500">{it.slug}</div>
            {#if it.description}
              <div class="text-[11px] text-slate-500">{it.description}</div>
            {/if}
          </td>
          <td class="text-slate-300">{it.category || '—'}</td>
          <td class="text-xs">
            <select
              class="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-xs"
              value={it.visibility}
              on:change={(e) => onVisibilityChange(it.slug, it.visibility, e)}
              disabled={busy === it.slug}
            >
              <option value="private">private</option>
              <option value="unlisted">unlisted</option>
              <option value="public">public</option>
            </select>
          </td>
          <td class="text-right text-xs text-slate-500">{new Date(it.updatedAt).toLocaleDateString()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
