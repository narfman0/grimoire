<script lang="ts">
  import type { PageData } from './$types';
  import Sheet from '$lib/components/Sheet.svelte';
  export let data: PageData;
</script>

<svelte:head>
  <title>{data.character.name} — Sheet preview</title>
</svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    <h1 class="text-2xl font-semibold">{data.character.name}</h1>
    <p class="text-sm text-slate-400">{data.label}</p>
  </div>
  <nav class="flex gap-3 text-sm">
    {#each data.allSlugs as slug}
      <a
        class="rounded border px-2 py-1 {slug === data.slug
          ? 'border-emerald-600 text-emerald-300'
          : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
        href={`/sheet/${slug}`}
      >
        {slug === 'half-orc-zealot-barbarian' ? 'Vorm' : 'Shellmar'}
      </a>
    {/each}
  </nav>
</header>

<Sheet derived={data.derived} />
