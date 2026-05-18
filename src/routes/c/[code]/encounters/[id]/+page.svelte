<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import {
    connectEncounterDoc,
    setEncounterTurn,
    type ConnectedEncounter,
    type EncounterSnapshot
  } from '$lib/realtime/encounter-doc';
  import type { PageData } from './$types';

  export let data: PageData;

  let busy = false;

  // M3.3 — realtime encounter state. We connect to room `encounter:<id>` and
  // mirror round + activeParticipantId via a Y.Doc. The DM's "next turn"
  // button writes to the Y.Doc (one shot); every other connected tab
  // observes the update within a tick. We fall back to the SSR snapshot
  // when the sync server is offline.
  let conn: ConnectedEncounter | null = null;
  let liveState: EncounterSnapshot | null = null;
  let connStatus: 'connecting' | 'open' | 'closed' | 'auth-failed' = 'connecting';

  onMount(() => {
    if (!data.syncToken) return;
    conn = connectEncounterDoc({ token: data.syncToken, encounterId: data.encounter.id });
    const unsubState = conn.state.subscribe((v) => (liveState = v));
    const unsubStatus = conn.status.subscribe((s) => {
      connStatus = s;
      // When the server flushed our last update back to the row, the page
      // data may be stale (participants table HP, etc.). Rare event, but
      // refresh on (re)connect so SSR-only fields stay accurate.
      if (s === 'open') invalidateAll().catch(() => {});
    });
    return () => {
      unsubState();
      unsubStatus();
    };
  });

  onDestroy(() => {
    conn?.destroy();
    conn = null;
  });

  // Effective values: prefer Y.Doc snapshot when connected, fall back to SSR.
  $: liveRound = liveState?.round ?? data.encounter.round;
  $: liveActive = liveState?.activeParticipantId ?? data.encounter.activeParticipantId;

  // Add-participant draft state
  let newKind: 'pc' | 'npc' | 'monster' = 'monster';
  let newName = '';
  let newCharacterId = data.campaignCharacters[0]?.id ?? '';
  let newMonsterSlug = data.monsterOptions[0]?.slug ?? '';
  let newInitiative: number | null = null;
  let newMaxHp: number | null = null;

  // When the picked monster changes, pre-fill name + HP from the statblock.
  // Use on:change rather than $: to avoid clobbering DM-overridden values.
  function selectMonster(e: Event) {
    const slug = (e.target as HTMLSelectElement).value;
    newMonsterSlug = slug;
    const opt = data.monsterOptions.find((m) => m.slug === slug);
    if (opt) {
      newName = opt.name;
      newMaxHp = opt.maxHp ?? null;
    }
  }

  // Initialize defaults from the first monster on mount so the form is filled.
  $: if (newKind === 'monster' && newMonsterSlug && !newName) {
    const opt = data.monsterOptions.find((m) => m.slug === newMonsterSlug);
    if (opt) {
      newName = opt.name;
      newMaxHp = opt.maxHp ?? null;
    }
  }

  async function addParticipant() {
    if (newKind === 'pc' && !newCharacterId) return;
    busy = true;
    try {
      const body: Record<string, unknown> = {
        name: newKind === 'pc'
          ? (data.campaignCharacters.find((c) => c.id === newCharacterId)?.name ?? newName)
          : newName,
        kind: newKind,
        initiative: newInitiative ?? undefined,
        maxHp: newMaxHp ?? undefined,
        currentHp: newMaxHp ?? undefined
      };
      if (newKind === 'pc') body.characterId = newCharacterId;
      if (newKind === 'monster' && newMonsterSlug) body.statblockSlug = newMonsterSlug;
      const res = await fetch(`/api/encounters/${data.encounter.id}/participants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        newName = '';
        newInitiative = null;
        newMaxHp = null;
        await invalidateAll();
      }
    } finally {
      busy = false;
    }
  }

  async function updateInitiative(id: string, value: number | null) {
    busy = true;
    try {
      await fetch(`/api/participants/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initiative: value })
      });
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function removeParticipant(id: string) {
    if (!confirm('Remove this participant?')) return;
    busy = true;
    try {
      await fetch(`/api/participants/${id}`, { method: 'DELETE' });
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  function inputValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  const KINDS: Array<'pc' | 'npc' | 'monster'> = ['pc', 'npc', 'monster'];

  async function advanceTurn(direction: 1 | -1) {
    if (data.role !== 'dm') return;
    const ordered = [...data.participants];
    if (ordered.length === 0) return;
    const currentActive = liveActive;
    const currentRound = liveRound;
    const idx = ordered.findIndex((p) => p.id === currentActive);
    let nextIdx = idx + direction;
    if (nextIdx < 0) nextIdx = ordered.length - 1;
    if (nextIdx >= ordered.length) nextIdx = 0;
    const wrapped = direction === 1 && idx === ordered.length - 1;
    const baseRound = currentRound === 0 ? 1 : currentRound;
    const newRound = wrapped ? baseRound + 1 : baseRound;
    const nextActive = ordered[nextIdx].id;

    // Preferred path: write via the Y.Doc — propagates to all connected
    // clients (other DM tabs + players) within a tick, and the sync-server
    // flushes the change to the encounters row on the next debounced store.
    if (conn && connStatus === 'open') {
      setEncounterTurn(conn.ydoc, { round: newRound, activeParticipantId: nextActive });
      return;
    }

    // Fallback: REST PATCH when the sync server is offline.
    busy = true;
    try {
      await fetch(`/api/encounters/${data.encounter.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activeParticipantId: nextActive, round: newRound })
      });
      await invalidateAll();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{data.encounter.name} — {data.campaign.name}</title>
</svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    <h1 class="text-2xl font-semibold">{data.encounter.name}</h1>
    <p class="text-sm text-slate-400">
      <span class="rounded border px-1.5 py-0.5 text-xs uppercase tracking-wide
        {data.encounter.status === 'live'
          ? 'border-emerald-700 text-emerald-300'
          : data.encounter.status === 'staging'
            ? 'border-slate-700 text-slate-300'
            : 'border-slate-800 text-slate-500'}">
        {data.encounter.status}
      </span>
      {#if data.encounter.status === 'live'}
        &middot; round {liveRound}
      {/if}
      {#if conn}
        <span
          class="ml-2 inline-block h-2 w-2 rounded-full {connStatus === 'open'
            ? 'bg-emerald-500'
            : connStatus === 'connecting'
              ? 'bg-amber-500'
              : 'bg-slate-600'}"
          title={connStatus === 'open' ? 'live sync connected' : `sync: ${connStatus}`}
        ></span>
      {/if}
    </p>
  </div>
  <a class="text-xs text-slate-400 hover:text-slate-200" href={`/c/${data.campaign.code}/encounters`}>
    ← all encounters
  </a>
</header>

{#if data.encounter.status === 'live' && data.role === 'dm'}
  <section class="mb-6 flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
    <span class="text-emerald-200">Turn controls:</span>
    <button class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={() => advanceTurn(-1)} disabled={busy}>
      ← Prev
    </button>
    <button class="rounded border border-emerald-700 px-2 py-0.5 hover:bg-emerald-900/40" on:click={() => advanceTurn(1)} disabled={busy}>
      Next turn →
    </button>
    <span class="ml-auto text-xs text-slate-500">
      {#if connStatus === 'open'}
        synced live · others see your turn changes in real time
      {:else}
        offline · falling back to REST
      {/if}
    </span>
  </section>
{/if}

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <h2 class="mb-3 text-sm font-semibold text-slate-200">Participants ({data.participants.length})</h2>

  {#if data.participants.length === 0}
    <p class="mb-3 text-sm text-slate-400">No participants yet.</p>
  {:else}
    <ul class="mb-3 divide-y divide-slate-800">
      {#each data.participants as p (p.id)}
        {@const isActive = p.id === liveActive}
        <li class="flex items-center gap-3 py-2 text-sm {isActive ? 'rounded bg-emerald-950/30 px-2' : ''}">
          <span class="font-mono text-xs text-slate-500 w-8">
            {#if p.initiative != null}
              {p.initiative}
            {:else}
              —
            {/if}
          </span>
          <span class="rounded border border-slate-700 px-1.5 py-0.5 text-xs uppercase tracking-wide text-slate-400 w-16 text-center">
            {p.kind}
          </span>
          <span class="flex-1 font-medium">
            {#if p.characterId}
              <a class="hover:text-emerald-300" href={`/c/${data.campaign.code}/character/${p.characterId}`}>
                {p.name}
              </a>
            {:else}
              {p.name}
            {/if}
          </span>
          {#if p.currentHp != null && p.maxHp != null}
            <span class="font-mono text-xs text-slate-400">{p.currentHp} / {p.maxHp}</span>
          {/if}
          {#if data.role === 'dm'}
            <input
              type="number"
              class="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-xs"
              placeholder="init"
              value={p.initiative ?? ''}
              on:change={(e) => {
                const v = inputValue(e);
                updateInitiative(p.id, v === '' ? null : Number(v));
              }}
            />
            <button class="text-xs text-slate-500 hover:text-red-400" on:click={() => removeParticipant(p.id)} disabled={busy}>
              ×
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.role === 'dm'}
    <div class="rounded border border-slate-800 bg-slate-950/30 p-3 text-sm">
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add participant</h3>
      <div class="mb-2 flex gap-3">
        {#each KINDS as k}
          <label class="flex items-center gap-1 text-xs">
            <input type="radio" bind:group={newKind} value={k} />
            <span>{k.toUpperCase()}</span>
          </label>
        {/each}
      </div>
      <div class="flex flex-wrap items-end gap-2">
        {#if newKind === 'pc'}
          {#if data.campaignCharacters.length === 0}
            <p class="text-xs text-amber-300">No characters in this campaign yet.</p>
          {:else}
            <label class="text-xs">
              <span class="block text-slate-400">Character</span>
              <select class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={newCharacterId}>
                {#each data.campaignCharacters as c}
                  <option value={c.id}>{c.name}</option>
                {/each}
              </select>
            </label>
          {/if}
        {:else if newKind === 'monster'}
          <label class="text-xs">
            <span class="block text-slate-400">From pack</span>
            {#if data.monsterOptions.length === 0}
              <p class="text-amber-300">No monsters loaded.</p>
            {:else}
              <select
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                value={newMonsterSlug}
                on:change={selectMonster}
              >
                {#each data.monsterOptions as m}
                  <option value={m.slug}>{m.name} (CR {m.cr})</option>
                {/each}
              </select>
            {/if}
          </label>
          <label class="text-xs">
            <span class="block text-slate-400">Name (override)</span>
            <input class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={newName} />
          </label>
          <label class="text-xs">
            <span class="block text-slate-400">Max HP</span>
            <input
              type="number"
              class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
              bind:value={newMaxHp}
              min="1"
            />
          </label>
        {:else}
          <label class="text-xs">
            <span class="block text-slate-400">Name</span>
            <input class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" placeholder="Captured noble, etc." bind:value={newName} />
          </label>
          <label class="text-xs">
            <span class="block text-slate-400">Max HP</span>
            <input
              type="number"
              class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
              bind:value={newMaxHp}
              min="1"
            />
          </label>
        {/if}
        <label class="text-xs">
          <span class="block text-slate-400">Initiative</span>
          <input
            type="number"
            class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
            bind:value={newInitiative}
          />
        </label>
        <button
          class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
          on:click={addParticipant}
          disabled={busy || (newKind !== 'pc' && !newName) || (newKind === 'pc' && !newCharacterId)}
        >
          Add
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-500">
        Monsters pre-fill HP from the SRD statblock. Override Max HP for
        weakened or empowered variants. Full monster-side action resolution
        (attack rolls, multiattack, etc.) is on the roadmap.
      </p>
    </div>
  {/if}
</section>

<p class="text-xs text-slate-500">
  M3.3 syncs round + active-turn state across all connected clients via
  Y.Doc. Per-participant HP still flows through REST (PATCH /api/participants);
  M3.4 promotes that into the same live channel and surfaces a player
  turn planner on the character sheet.
</p>
