<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<svelte:head><title>Database · Admin · Grimoire</title></svelte:head>

<header class="mb-6">
  <h1 class="text-2xl font-semibold">Database explorer</h1>
  <p class="text-sm text-slate-400">{data.tables.length} tables</p>
</header>

<ul class="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">
  {#each data.tables as t (t.name)}
    <li class="flex items-center justify-between px-4 py-3 text-sm">
      <a class="font-mono font-medium hover:text-emerald-300" href={`/admin/db/${encodeURIComponent(t.name)}`}>{t.name}</a>
      <span class="text-xs text-slate-500">{t.rowCount.toLocaleString()} rows</span>
    </li>
  {/each}
</ul>
