<script lang="ts">
  // Dungeon editor: floor tabs around the ordinary painter, plus the link
  // tool. Two modes — Paint (each tab embeds BoardPainter saving to that
  // floor's map row, exactly as /maps/[id] does) and Links (a read-only
  // canvas where two clicks make a staircase: source cell, then switch
  // floor and click the destination). Resize and backgrounds stay on the
  // full per-map editor; the link to it is on every tab.
  import { invalidateAll } from '$app/navigation';
  import { api } from '$lib/client/api';
  import { confirmDialog } from '$lib/components/ui/confirm';
  import BoardPainter from '$lib/components/board/BoardPainter.svelte';
  import BoardCanvas from '$lib/components/board/BoardCanvas.svelte';
  import {
    DEFAULT_LINK_COST_FT,
    LINK_GLYPHS,
    LINK_KINDS,
    type FloorLink,
    type FloorLinkKind
  } from '$lib/board/dungeon';
  import type { Cell } from '$lib/board/types';
  import type { PageData } from './$types';

  export let data: PageData;

  $: dungeon = data.dungeon;
  $: floors = dungeon.floors;
  let activeIdx: number | null = null;
  $: if (activeIdx === null || !floors.some((f) => f.floorIdx === activeIdx)) {
    activeIdx = floors[0]?.floorIdx ?? null;
  }
  $: activeFloor = floors.find((f) => f.floorIdx === activeIdx) ?? null;
  $: floorName = (idx: number) => floors.find((f) => f.floorIdx === idx)?.name ?? `Floor ${idx}`;

  let mode: 'paint' | 'links' = 'paint';
  let busy = false;

  // ---- dungeon + floor management ------------------------------------------
  let renaming = false;
  let nameDraft = '';
  async function renameDungeon() {
    if (nameDraft.trim() && nameDraft.trim() !== dungeon.name) {
      await patchDungeon({ name: nameDraft.trim() });
    }
    renaming = false;
  }

  async function patchDungeon(body: Record<string, unknown>) {
    busy = true;
    try {
      await api.patch(`/api/dungeons/${dungeon.id}`, body);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  let addingFloor = false;
  let newFloorName = '';
  let newFloorW = 20;
  let newFloorH = 15;
  let attachMapId = '';

  async function createFloor() {
    if (!newFloorName.trim()) return;
    busy = true;
    try {
      const created = await api.post<{ id: string }>('/api/maps', {
        name: newFloorName.trim(),
        w: newFloorW,
        h: newFloorH
      });
      await api.patch(`/api/maps/${created.id}`, { dungeonId: dungeon.id });
      newFloorName = '';
      addingFloor = false;
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function attachExisting() {
    if (!attachMapId) return;
    busy = true;
    try {
      await api.patch(`/api/maps/${attachMapId}`, { dungeonId: dungeon.id });
      attachMapId = '';
      addingFloor = false;
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function removeFloor(f: { mapId: string; name: string }) {
    const ok = await confirmDialog({
      title: `Remove "${f.name}" from the dungeon?`,
      message: 'The map survives as a standalone map. Links to this floor are removed.',
      confirmLabel: 'Remove floor',
      danger: true
    });
    if (!ok) return;
    busy = true;
    try {
      await api.patch(`/api/maps/${f.mapId}`, { dungeonId: null });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  /** Swap floor order with a neighbour via a parking index — floor indexes
   *  are stable identity for links and tokens, so a swap is three writes,
   *  never a cascade of reindexing. */
  async function swapFloors(a: { mapId: string; floorIdx: number }, b: { mapId: string; floorIdx: number }) {
    busy = true;
    try {
      await api.patch(`/api/maps/${a.mapId}`, { floorIdx: 999 });
      await api.patch(`/api/maps/${b.mapId}`, { floorIdx: a.floorIdx });
      await api.patch(`/api/maps/${a.mapId}`, { floorIdx: b.floorIdx });
      // Links referencing the two indexes keep their meaning only if we
      // remap them alongside.
      const remapped = dungeon.links.map((l) => ({
        ...l,
        a: { ...l.a, floorIdx: remapIdx(l.a.floorIdx, a.floorIdx, b.floorIdx) },
        b: { ...l.b, floorIdx: remapIdx(l.b.floorIdx, a.floorIdx, b.floorIdx) }
      }));
      if (JSON.stringify(remapped) !== JSON.stringify(dungeon.links)) {
        await api.patch(`/api/dungeons/${dungeon.id}`, { links: remapped });
      }
      await invalidateAll();
    } catch {
      // api() already toasted; invalidate re-syncs whatever landed
      await invalidateAll();
    } finally {
      busy = false;
    }
  }
  const remapIdx = (idx: number, x: number, y: number) => (idx === x ? y : idx === y ? x : idx);

  function onPaintSave(e: CustomEvent<{ tiles: string }>) {
    if (!activeFloor) return;
    void api
      .patch(`/api/maps/${activeFloor.mapId}`, { tiles: e.detail.tiles })
      .then(() => invalidateAll())
      .catch(() => {});
  }

  // ---- link tool -----------------------------------------------------------
  let linkKind: FloorLinkKind = 'stairs';
  let linkOneWay = false;
  let linkCost = DEFAULT_LINK_COST_FT.stairs;
  $: linkCost = DEFAULT_LINK_COST_FT[linkKind];
  /** First endpoint, waiting for the second click. */
  let pendingA: { floorIdx: number; x: number; y: number } | null = null;

  async function onLinkClick(cell: Cell) {
    if (activeIdx === null) return;
    if (!pendingA) {
      pendingA = { floorIdx: activeIdx, x: cell.x, y: cell.y };
      return;
    }
    const link: FloorLink = {
      id: crypto.randomUUID().slice(0, 8),
      kind: linkKind,
      a: pendingA,
      b: { floorIdx: activeIdx, x: cell.x, y: cell.y },
      costFt: linkCost,
      ...(linkOneWay ? { oneWay: true } : {})
    };
    pendingA = null;
    await patchDungeon({ links: [...dungeon.links, link] });
  }

  async function deleteLink(id: string) {
    await patchDungeon({ links: dungeon.links.filter((l) => l.id !== id) });
  }

  /** Endpoint glyphs on the viewed floor, plus the pending first click. */
  $: linkMarks = ((): Array<{ x: number; y: number; glyph: string; color?: string }> => {
    if (activeIdx === null) return [];
    const marks: Array<{ x: number; y: number; glyph: string; color?: string }> = [];
    for (const l of dungeon.links) {
      for (const e of [l.a, l.b]) {
        if (e.floorIdx === activeIdx) {
          marks.push({ x: e.x, y: e.y, glyph: LINK_GLYPHS[l.kind as FloorLinkKind] ?? '⇄' });
        }
      }
    }
    if (pendingA && pendingA.floorIdx === activeIdx) {
      marks.push({ x: pendingA.x, y: pendingA.y, glyph: '·', color: 'rgba(251,146,60,0.95)' });
    }
    return marks;
  })();
</script>

<svelte:head>
  <title>{dungeon.name} · Dungeons · Grimoire</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <a href="/maps" class="text-xs text-slate-500 hover:text-slate-300">← Maps</a>
  {#if renaming}
    <form class="flex items-center gap-2" on:submit|preventDefault={renameDungeon}>
      <input class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-lg" bind:value={nameDraft} />
      <button class="text-xs text-emerald-300" type="submit">Save</button>
      <button class="text-xs text-slate-500" type="button" on:click={() => (renaming = false)}>Cancel</button>
    </form>
  {:else}
    <h1 class="text-2xl font-semibold">🏰 {dungeon.name}</h1>
    <button
      class="text-xs text-slate-500 hover:text-slate-300"
      on:click={() => {
        nameDraft = dungeon.name;
        renaming = true;
      }}
    >
      ✎ rename
    </button>
  {/if}
  <span class="ml-auto flex gap-1 text-xs">
    <button
      class="rounded border px-2 py-1 {mode === 'paint'
        ? 'border-emerald-600 text-emerald-200'
        : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
      on:click={() => (mode = 'paint')}
    >
      🖌 Paint
    </button>
    <button
      class="rounded border px-2 py-1 {mode === 'links'
        ? 'border-violet-600 text-violet-200'
        : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
      on:click={() => {
        mode = 'links';
        pendingA = null;
      }}
    >
      𝌆 Links
    </button>
  </span>
</div>

<!-- Floor tabs -->
<div class="mb-3 flex flex-wrap items-center gap-1 text-sm" data-testid="floor-tabs">
  {#each floors as f, i (f.mapId)}
    <button
      class="rounded-t border px-3 py-1 {f.floorIdx === activeIdx
        ? 'border-slate-600 bg-slate-800/60 text-slate-100'
        : 'border-slate-800 text-slate-400 hover:text-slate-200'}"
      on:click={() => (activeIdx = f.floorIdx)}
    >
      {f.name}
    </button>
    {#if f.floorIdx === activeIdx}
      <span class="flex items-center gap-1 text-[10px] text-slate-500">
        {#if i > 0}
          <button title="Move up the tab order" on:click={() => swapFloors(f, floors[i - 1])} disabled={busy}>◀</button>
        {/if}
        {#if i < floors.length - 1}
          <button title="Move down the tab order" on:click={() => swapFloors(f, floors[i + 1])} disabled={busy}>▶</button>
        {/if}
        <a class="hover:text-slate-300" href={`/maps/${f.mapId}`} title="Full editor: resize, background, rename">⚙</a>
        <button class="hover:text-red-400" title="Remove floor from dungeon" on:click={() => removeFloor(f)}>✕</button>
      </span>
    {/if}
  {/each}
  <button
    class="rounded border border-dashed border-slate-700 px-2 py-1 text-xs text-slate-500 hover:text-slate-300"
    on:click={() => (addingFloor = !addingFloor)}
  >
    + floor
  </button>
</div>

{#if addingFloor}
  <div class="mb-3 flex flex-wrap items-end gap-3 rounded border border-slate-800 bg-slate-900/40 p-3 text-xs">
    <form class="flex flex-wrap items-end gap-2" on:submit|preventDefault={createFloor}>
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase text-slate-500">New floor</span>
        <input class="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1" bind:value={newFloorName} placeholder="Crypts" />
      </label>
      <input type="number" min="1" max="100" class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1" bind:value={newFloorW} />
      ×
      <input type="number" min="1" max="100" class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1" bind:value={newFloorH} />
      <button class="rounded border border-emerald-700 bg-emerald-900/40 px-2 py-1 text-emerald-200 disabled:opacity-40" disabled={busy || !newFloorName.trim()} type="submit">
        Create
      </button>
    </form>
    {#if data.standaloneMaps.length > 0}
      <span class="text-slate-600">or</span>
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase text-slate-500">Existing map</span>
        <select class="rounded border border-slate-700 bg-slate-950 px-2 py-1" bind:value={attachMapId}>
          <option value="">— pick —</option>
          {#each data.standaloneMaps as m}
            <option value={m.id}>{m.name} ({m.w}×{m.h})</option>
          {/each}
        </select>
      </label>
      <button class="rounded border border-slate-700 px-2 py-1 text-slate-300 disabled:opacity-40" disabled={busy || !attachMapId} on:click={attachExisting}>
        Add as floor
      </button>
    {/if}
  </div>
{/if}

{#if !activeFloor}
  <p class="text-sm text-slate-500">No floors yet — add one above.</p>
{:else if mode === 'paint'}
  {#key `${activeFloor.mapId}:${activeFloor.w}x${activeFloor.h}`}
    <BoardPainter
      w={activeFloor.w}
      h={activeFloor.h}
      tiles={activeFloor.tiles}
      background={activeFloor.background}
      {busy}
      on:save={onPaintSave}
    />
  {/key}
{:else}
  <div class="mb-2 flex flex-wrap items-center gap-2 text-xs" data-testid="link-tool">
    <select class="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5" aria-label="Link kind" bind:value={linkKind}>
      {#each LINK_KINDS as k}
        <option value={k}>{LINK_GLYPHS[k]} {k}</option>
      {/each}
    </select>
    <label class="flex items-center gap-1 text-slate-400">
      <input type="checkbox" bind:checked={linkOneWay} class="accent-violet-500" />
      one-way
    </label>
    <label class="flex items-center gap-1 text-slate-400">
      cost
      <input type="number" min="5" max="120" step="5" class="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5" aria-label="Link cost in feet" bind:value={linkCost} />
      ft
    </label>
    <span class="text-slate-600">
      {#if pendingA}
        · from {floorName(pendingA.floorIdx)} ({pendingA.x}, {pendingA.y}) — switch floor if needed, click the destination
        <button class="ml-1 rounded border border-slate-700 px-1.5 hover:text-slate-200" on:click={() => (pendingA = null)}>cancel</button>
      {:else}
        · click the source cell (the top of the stairs)
      {/if}
    </span>
  </div>
  <BoardCanvas
    w={activeFloor.w}
    h={activeFloor.h}
    tiles={activeFloor.tiles}
    background={activeFloor.background}
    marks={linkMarks}
    on:cellclick={(e) => onLinkClick(e.detail)}
  />
  {#if dungeon.links.length > 0}
    <ul class="mt-3 flex flex-wrap gap-1.5 text-[11px]" data-testid="link-chips">
      {#each dungeon.links as l (l.id)}
        <li class="flex items-center gap-1 rounded border border-violet-900/60 px-1.5 py-0.5 text-violet-100">
          <span>{LINK_GLYPHS[l.kind as FloorLinkKind] ?? '⇄'}</span>
          <button class="hover:text-violet-300" title="Jump to this end" on:click={() => (activeIdx = l.a.floorIdx)}>
            {floorName(l.a.floorIdx)} ({l.a.x}, {l.a.y})
          </button>
          {l.oneWay ? '→' : '⇄'}
          <button class="hover:text-violet-300" title="Jump to the other end" on:click={() => (activeIdx = l.b.floorIdx)}>
            {floorName(l.b.floorIdx)} ({l.b.x}, {l.b.y})
          </button>
          <span class="text-violet-400/70">{l.costFt} ft</span>
          <button class="text-slate-600 hover:text-red-400" title="Delete link" on:click={() => deleteLink(l.id)}>✕</button>
        </li>
      {/each}
    </ul>
  {/if}
{/if}
