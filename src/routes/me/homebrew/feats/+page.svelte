<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<svelte:head><title>Homebrew feats · Grimoire</title></svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <h1 class="text-2xl font-semibold">Homebrew feats</h1>
  <a
    href="/me/homebrew/feats/new"
    class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500"
  >+ New feat</a>
</header>

{#if data.feats.length === 0}
  <p class="rounded border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
    You haven't authored any homebrew feats yet. Create one and it'll show up in the feat picker on
    any of your characters across all your campaigns.
  </p>
{:else}
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
        <th class="py-2">Name</th>
        <th>Category</th>
        <th>Modifiers</th>
        <th>Choices</th>
        <th class="text-right">Updated</th>
      </tr>
    </thead>
    <tbody>
      {#each data.feats as f}
        <tr class="border-b border-slate-900 hover:bg-slate-900/40">
          <td class="py-2">
            <a class="text-emerald-300 hover:text-emerald-200" href={`/me/homebrew/feats/${f.slug}`}>{f.name}</a>
            <div class="font-mono text-[11px] text-slate-500">{f.slug}</div>
          </td>
          <td class="text-slate-300">{f.category || '—'}</td>
          <td class="text-slate-400">{f.modifierCount}</td>
          <td class="text-slate-400">{f.enabledChoices.length > 0 ? f.enabledChoices.join(', ') : '—'}</td>
          <td class="text-right text-xs text-slate-500">{new Date(f.updatedAt).toLocaleDateString()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
