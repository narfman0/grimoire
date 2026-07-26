<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { campaignUrl, encounterUrl } from '$lib/urls';
  import { api } from '$lib/client/api';
  import type { PageData } from './$types';

  export let data: PageData;

  let newName = '';
  let busy = false;

  async function createEncounter(e: Event) {
    e.preventDefault();
    busy = true;
    try {
      await api.post('/api/encounters', { campaignCode: data.campaign.code, name: newName });
      newName = '';
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function setStatus(id: string, status: 'staging' | 'live' | 'ended') {
    busy = true;
    try {
      await api.patch(`/api/encounters/${id}`, { status });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function deleteEncounter(id: string) {
    if (!confirm('Delete this encounter?')) return;
    busy = true;
    try {
      await api.del(`/api/encounters/${id}`);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  $: byStatus = {
    live: data.encounters.filter((e) => e.status === 'live'),
    staging: data.encounters.filter((e) => e.status === 'staging'),
    ended: data.encounters.filter((e) => e.status === 'ended')
  };

  const STATUSES = ['live', 'staging', 'ended'] as const;
  const STATUS_LABEL: Record<string, string> = {
    live: 'live',
    staging: 'staging',
    ended: 'ended'
  };

  function statusClasses(status: string): string {
    if (status === 'live') return 'border-emerald-700 text-emerald-300';
    if (status === 'staging') return 'border-slate-700 text-slate-300';
    return 'border-slate-800 text-slate-500';
  }
</script>

<svelte:head>
  <title>Encounters — {data.campaign.name}</title>
</svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    <h1 class="text-2xl font-semibold">Encounters</h1>
    <p class="text-sm text-slate-400">
      {data.campaign.name} &middot; <span class="font-mono">{data.campaign.code}</span> &middot;
      <span class="uppercase tracking-wide text-xs {data.role === 'dm' ? 'text-amber-300' : 'text-slate-400'}">{data.role}</span>
    </p>
  </div>
  <a class="text-xs text-slate-400 hover:text-slate-200" href={campaignUrl(data.campaign.dmUsername, data.campaign.slug)}>
    ← back to campaign
  </a>
</header>

{#if data.role === 'dm'}
  <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
    <form on:submit={createEncounter} class="flex gap-2">
      <input
        class="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        placeholder="New encounter name (e.g., Goblin Ambush)"
        bind:value={newName}
        required
        maxlength="120"
      />
      <button class="rounded bg-emerald-600 px-3 py-2 text-sm font-medium disabled:opacity-40" disabled={busy}>
        Create
      </button>
    </form>
  </section>
{/if}

{#each STATUSES as status (status)}
  {@const items = byStatus[status]}
  {#if items.length > 0}
    <section class="mb-6">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {STATUS_LABEL[status]}
      </h2>
      <ul class="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/30">
        {#each items as enc (enc.id)}
          <li class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div class="flex-1">
              <a class="font-medium hover:text-emerald-300" href={encounterUrl(data.campaign.dmUsername, data.campaign.slug, enc.id)}>
                {enc.name}
              </a>
              <span class="ml-2 rounded border px-1.5 py-0.5 text-xs {statusClasses(enc.status)}">
                {STATUS_LABEL[enc.status]}
              </span>
              {#if enc.status === 'live'}
                <span class="ml-2 text-xs text-slate-500">round {enc.round}</span>
              {/if}
            </div>
            {#if data.role === 'dm'}
              <div class="flex gap-1 text-xs">
                {#if enc.status === 'staging'}
                  <button class="rounded border border-emerald-700 px-2 py-0.5 text-emerald-300 hover:bg-emerald-900/30" on:click={() => setStatus(enc.id, 'live')} disabled={busy}>
                    Promote to live
                  </button>
                {/if}
                {#if enc.status === 'live'}
                  <button class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={() => setStatus(enc.id, 'staging')} disabled={busy}>
                    Pause
                  </button>
                  <button class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={() => setStatus(enc.id, 'ended')} disabled={busy}>
                    End
                  </button>
                {/if}
                {#if enc.status === 'ended'}
                  <button class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={() => setStatus(enc.id, 'staging')} disabled={busy}>
                    Reopen
                  </button>
                {/if}
                <button class="rounded border border-slate-700 px-2 py-0.5 text-slate-400 hover:text-red-400" on:click={() => deleteEncounter(enc.id)} disabled={busy}>
                  ×
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/each}

{#if data.encounters.length === 0}
  <p class="rounded border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
    No encounters yet.
    {#if data.role === 'dm'}
      Create one above to start prepping combat.
    {:else}
      Your DM hasn't created any encounters yet.
    {/if}
  </p>
{/if}
