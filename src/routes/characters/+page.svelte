<script lang="ts">
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
      <li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <div class="min-w-0 flex-1">
          {#if c.campaigns.length > 0}
            <a
              class="font-medium hover:text-emerald-300"
              href={`/c/${c.campaigns[0].code}/character/${c.id}`}
              title={`Open in ${c.campaigns[0].name}`}
            >
              {c.name}
            </a>
          {:else if c.slug}
            <a class="font-medium hover:text-emerald-300" href={`/characters/${c.ownerUsername}/${c.slug}`}>
              {c.name}
            </a>
          {:else}
            <span class="font-medium text-slate-300">{c.name}</span>
          {/if}
          {#if c.descLine}
            <p class="text-xs text-slate-500">{c.descLine}</p>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-1 text-xs text-slate-400">
          {#if c.campaigns.length === 0}
            <span class="text-slate-600">— not linked to any campaign</span>
          {:else}
            {#each c.campaigns as link}
              <a
                class="rounded border border-slate-700 px-2 py-0.5 hover:border-emerald-600 hover:text-emerald-200"
                href={`/c/${link.code}/character/${c.id}`}
              >
                {link.name}
              </a>
            {/each}
          {/if}
          {#if c.totalLevel > 0}
            <span class="ml-1 font-mono text-[10px] text-slate-600">L{c.totalLevel}</span>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}

<p class="mt-6 text-xs text-slate-500">
  ← <a class="hover:text-slate-200" href="/">All campaigns</a>
</p>
