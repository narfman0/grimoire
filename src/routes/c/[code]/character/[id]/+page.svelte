<script lang="ts">
  import type { PageData } from './$types';
  import Sheet from '$lib/components/Sheet.svelte';
  export let data: PageData;
</script>

<svelte:head>
  <title>{data.character.name} — {data.campaign.name}</title>
</svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    <h1 class="text-2xl font-semibold">{data.character.name}</h1>
    <p class="text-sm text-slate-400">
      {#if data.document}
        {#each data.document.classes as c, i}
          {c.slug}{#if c.subclass} ({c.subclass}){/if} {c.level}{#if i < data.document.classes.length - 1}, {/if}
        {/each}
        &middot; {data.document.species.slug}{#if data.document.subspecies} ({data.document.subspecies.slug}){/if}
      {:else}
        no document yet
      {/if}
    </p>
  </div>
  <a class="text-xs text-slate-400 hover:text-slate-200" href={`/c/${data.campaign.code}`}>
    ← back to {data.campaign.name}
  </a>
</header>

{#if data.derived}
  <Sheet derived={data.derived} />
{:else}
  <section class="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm">
    <h2 class="text-base font-semibold text-amber-200">No character document</h2>
    <p class="mt-2 text-amber-100">
      This character was created without a full document. Editable creation
      lands in A.4 — for now, recreate via the form on the campaign page or
      PATCH a document via <code class="text-xs">PATCH /api/characters/{data.character.id}</code>.
    </p>
  </section>
{/if}
