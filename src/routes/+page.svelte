<script lang="ts">
  import type { PageData } from './$types';

  export let data: PageData;

  let createName = '';
  let joinCode = '';
  let busy = false;
  let error: string | null = null;

  async function createCampaign(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: createName })
      });
      if (!res.ok) {
        error = `Could not create campaign (${res.status})`;
        return;
      }
      const { code } = (await res.json()) as { id: string; code: string };
      window.location.href = `/c/${code}`;
    } finally {
      busy = false;
    }
  }

  async function joinCampaign(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const code = joinCode.trim().toUpperCase();
      const res = await fetch(`/api/campaigns/${code}/join`, { method: 'POST' });
      if (!res.ok) {
        error = res.status === 404 ? 'No campaign with that code.' : `Could not join (${res.status}).`;
        return;
      }
      window.location.href = `/c/${code}`;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Home — Grimoire</title>
</svelte:head>

<header class="mb-6">
  <h1 class="text-2xl font-semibold">Home</h1>
  <p class="text-sm text-slate-400">Logged in as <span class="font-mono">{data.user.username}</span>.</p>
</header>

<section class="mb-8">
  <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
    Characters
    {#if data.characters.length > 0}<span class="ml-1 text-xs text-slate-600">({data.characters.length})</span>{/if}
  </h2>
  {#if data.characters.length === 0}
    <p class="rounded border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
      No characters yet. Open a campaign below and use "+ create one."
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
            {:else}
              <span class="font-medium text-slate-300">{c.name}</span>
              <span class="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                retired
              </span>
            {/if}
            {#if c.descLine}
              <p class="text-xs text-slate-500">{c.descLine}</p>
            {/if}
          </div>
          <div class="flex flex-wrap items-center gap-1 text-xs text-slate-400">
            {#each c.campaigns as link}
              <a
                class="rounded border border-slate-700 px-2 py-0.5 hover:border-emerald-600 hover:text-emerald-200"
                href={`/c/${link.code}/character/${c.id}`}
              >
                {link.name}
              </a>
            {/each}
            {#if c.totalLevel > 0}
              <span class="ml-1 font-mono text-[10px] text-slate-600">L{c.totalLevel}</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-slate-500">
      <a class="hover:text-slate-200" href="/characters">All characters →</a>
    </p>
  {/if}
</section>

<section class="mb-8">
  <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
    Campaigns
    {#if data.campaigns.length > 0}<span class="ml-1 text-xs text-slate-600">({data.campaigns.length})</span>{/if}
  </h2>
  {#if data.campaigns.length === 0}
    <p class="rounded border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
      No campaigns yet. Create one below or join one with a code.
    </p>
  {:else}
    <ul class="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">
      {#each data.campaigns as c}
        <li class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div class="flex-1">
            <a class="font-medium hover:text-emerald-300" href={`/c/${c.code}`}>{c.name}</a>
            <span class="ml-2 font-mono text-xs text-slate-500">{c.code}</span>
          </div>
          <div class="flex items-center gap-3 text-xs text-slate-500">
            <span title="Characters in this campaign">
              {c.characterCount} <span class="text-slate-600">PC{c.characterCount === 1 ? '' : 's'}</span>
            </span>
            <span title="Encounters in this campaign">
              {c.encounterCount} <span class="text-slate-600">enc</span>
            </span>
            <span class="rounded bg-slate-800 px-1.5 py-0.5 uppercase tracking-wide {c.role === 'dm' ? 'text-amber-300' : 'text-slate-400'}">{c.role}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="grid gap-8 md:grid-cols-2">
  <form on:submit={createCampaign} class="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
    <h2 class="text-lg font-semibold">Create campaign</h2>
    <p class="text-sm text-slate-400">You'll be added as the DM. Share the 6-character code with players.</p>
    <input
      class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
      placeholder="Campaign name"
      bind:value={createName}
      required
    />
    <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
      Create &amp; enter
    </button>
  </form>

  <form on:submit={joinCampaign} class="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
    <h2 class="text-lg font-semibold">Join campaign</h2>
    <p class="text-sm text-slate-400">Enter the 6-character code.</p>
    <input
      class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono uppercase"
      placeholder="ABCDEF"
      maxlength="6"
      bind:value={joinCode}
      required
    />
    <button class="rounded bg-sky-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>Join</button>
  </form>
</section>

{#if error}
  <p class="mt-4 rounded border border-red-800 bg-red-950/60 px-4 py-2 text-red-200">{error}</p>
{/if}
