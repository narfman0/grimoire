<script lang="ts">
  import CharacterRow from '$lib/components/CharacterRow.svelte';
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<svelte:head>
  <title>My characters — Grimoire</title>
</svelte:head>

<header class="mb-6">
  <h1 class="text-2xl font-semibold">My characters</h1>
  <p class="text-sm text-slate-400">
    Every PC you own, with the campaigns each is linked to.
    To create a new one, head to a campaign and use "+ create one" — characters
    are still created in-campaign for now; this page is the cross-campaign view.
  </p>
</header>

{#if data.characters.length === 0}
  <p class="rounded border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
    No characters yet. Create one inside a campaign.
  </p>
{:else}
  <ul class="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">
    {#each data.characters as c (c.id)}
      <CharacterRow
        id={c.id}
        name={c.name}
        slug={c.slug}
        ownerUsername={c.ownerUsername}
        descLine={c.descLine}
        totalLevel={c.totalLevel}
        portrait={c.portrait}
        campaigns={c.campaigns}
      />
    {/each}
  </ul>
{/if}

<p class="mt-6 text-xs text-slate-500">
  ← <a class="hover:text-slate-200" href="/">All campaigns</a>
</p>
