<script lang="ts">
  // /maps/[id] — the standalone painter. Owns persistence (PATCH the map on
  // painter save), rename, cell size, resize (crop/expand top-left anchored)
  // and the optional background image with its trace-over opacity slider.
  import { invalidateAll } from '$app/navigation';
  import { api } from '$lib/client/api';
  import { confirmDialog } from '$lib/components/ui/confirm';
  import BoardPainter from '$lib/components/board/BoardPainter.svelte';
  import { decodeRuns, encodeRuns } from '$lib/board/rle';
  import { tileBySlug } from '$lib/board/tileset';
  import type { PageData } from './$types';

  export let data: PageData;

  let busy = false;
  let painterDirty = false;
  let painter: BoardPainter;

  // Local working copy so a resize + save round-trip doesn't flash stale
  // dimensions while invalidateAll re-runs the loader.
  $: map = data.map;

  let renaming = false;
  let nameDraft = '';
  async function rename() {
    if (!nameDraft.trim() || nameDraft.trim() === map.name) {
      renaming = false;
      return;
    }
    await patchMap({ name: nameDraft.trim() });
    renaming = false;
  }

  let resizeW = 0;
  let resizeH = 0;
  $: {
    resizeW = map.w;
    resizeH = map.h;
  }

  let backgroundOpacity = 0.5;

  async function patchMap(body: Record<string, unknown>) {
    busy = true;
    try {
      await api.patch(`/api/maps/${map.id}`, body);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  function onSave(e: CustomEvent<{ tiles: string }>) {
    void patchMap({ tiles: e.detail.tiles });
  }

  /** Crop/expand top-left anchored; new cells become floor. */
  async function applyResize() {
    if (resizeW === map.w && resizeH === map.h) return;
    if (painterDirty) {
      const ok = await confirmDialog({
        title: 'Discard unsaved paint?',
        message: 'Resizing works from the last saved state.',
        confirmLabel: 'Resize anyway',
        danger: true
      });
      if (!ok) return;
    }
    const FLOOR = tileBySlug('floor')?.id ?? 1;
    const old = decodeRuns(map.tiles, map.w * map.h);
    const next = new Array<number>(resizeW * resizeH).fill(FLOOR);
    for (let y = 0; y < Math.min(map.h, resizeH); y++) {
      for (let x = 0; x < Math.min(map.w, resizeW); x++) {
        next[y * resizeW + x] = old[y * map.w + x];
      }
    }
    await patchMap({ w: resizeW, h: resizeH, tiles: encodeRuns(next) });
  }

  let uploading = false;
  async function uploadBackground(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    try {
      const fd = new FormData();
      fd.append('background', file);
      await api.post(`/api/maps/${map.id}/background`, fd);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      uploading = false;
      input.value = '';
    }
  }

  async function removeBackground() {
    busy = true;
    try {
      await api.del(`/api/maps/${map.id}/background`);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{map.name} · Maps · Grimoire</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <a href="/maps" class="text-xs text-slate-500 hover:text-slate-300">← Maps</a>
  {#if renaming}
    <form class="flex items-center gap-2" on:submit|preventDefault={rename}>
      <input
        class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-lg"
        bind:value={nameDraft}
      />
      <button class="text-xs text-emerald-300" type="submit">Save</button>
      <button class="text-xs text-slate-500" type="button" on:click={() => (renaming = false)}>
        Cancel
      </button>
    </form>
  {:else}
    <h1 class="text-2xl font-semibold">{map.name}</h1>
    <button
      class="text-xs text-slate-500 hover:text-slate-300"
      on:click={() => {
        nameDraft = map.name;
        renaming = true;
      }}
    >
      ✎ rename
    </button>
  {/if}
</div>

<div class="mb-3 flex flex-wrap items-end gap-4 text-xs">
  <label class="flex items-center gap-2">
    <span class="text-slate-500">Cell size (ft)</span>
    <input
      type="number"
      min="1"
      max="100"
      class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1"
      value={map.cellFt}
      on:change={(e) => patchMap({ cellFt: Number(e.currentTarget.value) })}
    />
  </label>
  <div class="flex items-center gap-2">
    <span class="text-slate-500">Grid</span>
    <input
      type="number"
      min="1"
      max="100"
      class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1"
      bind:value={resizeW}
    />
    ×
    <input
      type="number"
      min="1"
      max="100"
      class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1"
      bind:value={resizeH}
    />
    {#if resizeW !== map.w || resizeH !== map.h}
      <button
        class="rounded border border-amber-700 bg-amber-950/40 px-2 py-1 text-amber-300"
        on:click={applyResize}
        disabled={busy}
      >
        Apply resize
      </button>
    {/if}
  </div>
  <div class="flex items-center gap-2">
    <span class="text-slate-500">Background</span>
    {#if map.background}
      <label class="flex items-center gap-1">
        <span class="text-slate-500">opacity</span>
        <input type="range" min="0.1" max="1" step="0.1" bind:value={backgroundOpacity} />
      </label>
      <button class="text-slate-500 hover:text-red-400" on:click={removeBackground} disabled={busy}>
        remove
      </button>
    {:else}
      <label
        class="cursor-pointer rounded border border-slate-700 px-2 py-1 text-slate-400 hover:text-slate-200"
      >
        {uploading ? 'Uploading…' : 'Upload image'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="hidden"
          on:change={uploadBackground}
          disabled={uploading}
        />
      </label>
    {/if}
  </div>
</div>

<!-- Remount only when identity or dimensions change — a plain save must
     keep the painter (and its undo stack) alive; it re-syncs from props. -->
{#key `${map.id}:${map.w}x${map.h}`}
  <BoardPainter
    bind:this={painter}
    w={map.w}
    h={map.h}
    tiles={map.tiles}
    background={map.background}
    {backgroundOpacity}
    {busy}
    on:save={onSave}
    on:dirty={(e) => (painterDirty = e.detail)}
  />
{/key}
