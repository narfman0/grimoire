<script lang="ts">
  import { goto } from '$app/navigation';
  import { invalidateAll } from '$app/navigation';
  import { api } from '$lib/client/api';
  import { confirmDialog } from '$lib/components/ui/confirm';
  import { TEMPLATES, templateTiles } from '$lib/board/templates';
  import type { PageData } from './$types';

  export let data: PageData;

  let creating = false;
  let name = '';
  let dungeonName = '';
  let creatingDungeon = false;

  async function createDungeon() {
    if (!dungeonName.trim()) return;
    creatingDungeon = true;
    try {
      const created = await api.post<{ id: string }>('/api/dungeons', {
        name: dungeonName.trim()
      });
      await goto(`/maps/dungeons/${created.id}`);
    } catch {
      // api() already toasted
    } finally {
      creatingDungeon = false;
    }
  }

  async function removeDungeon(d: { id: string; name: string }) {
    const ok = await confirmDialog({
      title: `Delete "${d.name}"?`,
      message: 'Its floors become standalone maps again; nothing is painted over.',
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      await api.del(`/api/dungeons/${d.id}`);
      await invalidateAll();
    } catch {
      // api() already toasted
    }
  }
  let template = 'blank-room';
  let customW = 20;
  let customH = 15;

  async function createMap() {
    if (!name.trim()) return;
    creating = true;
    try {
      const seed = template === 'custom' ? null : templateTiles(template);
      const body = seed
        ? { name: name.trim(), w: seed.w, h: seed.h, tiles: seed.tiles }
        : { name: name.trim(), w: customW, h: customH };
      const created = await api.post<{ id: string }>('/api/maps', body);
      await goto(`/maps/${created.id}`);
    } catch {
      // api() already toasted
    } finally {
      creating = false;
    }
  }

  async function removeMap(map: { id: string; name: string }) {
    const ok = await confirmDialog({
      title: `Delete "${map.name}"?`,
      message: 'Encounters that used it keep their own copy.',
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      await api.del(`/api/maps/${map.id}`);
      await invalidateAll();
    } catch {
      // api() already toasted
    }
  }

  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();
</script>

<svelte:head>
  <title>Maps · Grimoire</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-semibold">Maps</h1>
<p class="mb-6 text-sm text-slate-400">
  Paint battle maps here, then attach them to an encounter — the encounter gets its own copy.
</p>

<section class="mb-8 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <h2 class="mb-3 text-sm font-semibold text-slate-300">New map</h2>
  <form class="flex flex-wrap items-end gap-3 text-sm" on:submit|preventDefault={createMap}>
    <label class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-wide text-slate-500">Name</span>
      <input
        class="w-48 rounded border border-slate-700 bg-slate-950 px-2 py-1"
        bind:value={name}
        placeholder="Tavern brawl"
        required
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-wide text-slate-500">Start from</span>
      <select class="rounded border border-slate-700 bg-slate-950 px-2 py-1" bind:value={template}>
        {#each TEMPLATES as t}
          <option value={t.slug}>{t.name}</option>
        {/each}
        <option value="custom">Blank (custom size)</option>
      </select>
    </label>
    {#if template === 'custom'}
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">Width</span>
        <input
          type="number"
          min="1"
          max="100"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1"
          bind:value={customW}
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-slate-500">Height</span>
        <input
          type="number"
          min="1"
          max="100"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1"
          bind:value={customH}
        />
      </label>
    {/if}
    <button
      class="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1 text-emerald-200 hover:bg-emerald-900/70 disabled:opacity-40"
      disabled={creating || !name.trim()}
      type="submit"
    >
      Create & paint
    </button>
  </form>
</section>

<section class="mb-8 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <h2 class="mb-3 text-sm font-semibold text-slate-300">Dungeons</h2>
  <p class="mb-3 text-xs text-slate-500">
    Group maps into floors joined by stairs and ropes; attach the whole dungeon to a campaign and
    its fog persists across encounters.
  </p>
  <form class="mb-4 flex flex-wrap items-end gap-3 text-sm" on:submit|preventDefault={createDungeon}>
    <label class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-wide text-slate-500">Name</span>
      <input
        class="w-48 rounded border border-slate-700 bg-slate-950 px-2 py-1"
        bind:value={dungeonName}
        placeholder="Barrowmaze"
        required
      />
    </label>
    <button
      class="rounded border border-violet-700 bg-violet-950/40 px-3 py-1 text-violet-200 hover:bg-violet-900/50 disabled:opacity-40"
      disabled={creatingDungeon || !dungeonName.trim()}
      type="submit"
    >
      New dungeon
    </button>
  </form>
  {#if data.dungeons.length === 0}
    <p class="text-xs text-slate-600">No dungeons yet.</p>
  {:else}
    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.dungeons as d (d.id)}
        <li class="rounded-lg border border-violet-900/50 bg-slate-900/30 p-4">
          <div class="flex items-start justify-between gap-2">
            <a class="font-medium text-slate-200 hover:text-violet-300" href={`/maps/dungeons/${d.id}`}>
              🏰 {d.name}
            </a>
            <button
              class="text-xs text-slate-600 hover:text-red-400"
              title="Delete dungeon (floors survive as maps)"
              on:click={() => removeDungeon(d)}
            >
              ✕
            </button>
          </div>
          <p class="mt-1 text-xs text-slate-500">
            {d.floorCount} floor{d.floorCount === 1 ? '' : 's'} · updated {fmtDate(d.updatedAt)}
          </p>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if data.maps.length === 0}
  <p class="text-sm text-slate-500">No maps yet — paint your first one above.</p>
{:else}
  <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each data.maps as map (map.id)}
      <li class="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
        <div class="flex items-start justify-between gap-2">
          <a class="font-medium text-slate-200 hover:text-emerald-300" href={`/maps/${map.id}`}>
            {map.name}
          </a>
          <button
            class="text-xs text-slate-600 hover:text-red-400"
            title="Delete map"
            on:click={() => removeMap(map)}
          >
            ✕
          </button>
        </div>
        <p class="mt-1 text-xs text-slate-500">
          {map.w}×{map.h} · {map.cellFt} ft cells · updated {fmtDate(map.updatedAt)}
        </p>
        {#if map.dungeonName}
          <p class="mt-1 text-[11px] text-violet-300/80">🏰 floor of {map.dungeonName}</p>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
