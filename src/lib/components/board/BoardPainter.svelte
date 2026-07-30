<script lang="ts">
  // Board painting surface — palette + tools around BoardCanvas. Two modes
  // over one tool set:
  //   edit — paints tile ids into the tile layer (map builder, DM terrain
  //          edits mid-fight)
  //   fog  — paints the 0/1 reveal bitmask (DM reveal brush)
  // The parent owns persistence: it gets a `save` event with the full RLE
  // string (a 100×100 board is a few KB — no incremental protocol) and
  // PATCHes whichever route owns the data. With `autosave` every finished
  // stroke saves — that's the mid-fight fog brush, where "players see the
  // corridor within a poll cycle" is the point.
  import { createEventDispatcher } from 'svelte';
  import { decodeRuns, encodeRuns } from '$lib/board/rle';
  import { doorCounterpart, TILES, tileById, VOID_TILE_ID } from '$lib/board/tileset';
  import type { Cell } from '$lib/board/types';
  import BoardCanvas, { type OverlayLayer } from './BoardCanvas.svelte';

  export let w: number;
  export let h: number;
  export let tiles: string;
  /** Fog bitmask; rendered in both modes when provided, painted in 'fog'. */
  export let revealed: string | null = null;
  export let mode: 'edit' | 'fog' = 'edit';
  export let background: string | null = null;
  export let backgroundOpacity = 0.5;
  export let busy = false;
  /** Dispatch a save after every completed stroke (fog brush). */
  export let autosave = false;

  const dispatch = createEventDispatcher<{
    save: { tiles: string; revealed: string | null };
    dirty: boolean;
  }>();

  // Palette. Edit mode paints tile ids; fog mode paints reveal bits.
  const FOG_PALETTE = [
    { id: 1, name: 'Reveal', color: { light: '#fef3c7', dark: '#fbbf24' } },
    { id: 0, name: 'Hide', color: { light: '#334155', dark: '#0f172a' } }
  ];
  $: palette = mode === 'edit' ? TILES.filter((t) => t.id !== VOID_TILE_ID) : FOG_PALETTE;
  let selectedIdx = 0;
  $: selected = palette[Math.min(selectedIdx, palette.length - 1)];

  type Tool = 'brush' | 'rect' | 'fill' | 'eraser' | 'door';
  let tool: Tool = 'brush';
  let brushSize: 1 | 2 | 3 = 1;
  $: tools = (
    mode === 'edit'
      ? (['brush', 'rect', 'fill', 'eraser', 'door'] as Tool[])
      : (['brush', 'rect', 'fill'] as Tool[])
  );

  // The working buffer. Re-syncs from props whenever the parent's copy
  // changes and nothing is dirty locally (e.g. after our own save lands).
  let buffer: Uint16Array = new Uint16Array(0);
  let dirty = false;
  let syncedSource = '';
  $: source = mode === 'edit' ? tiles : revealed ?? '';
  $: if (!dirty && source !== syncedSource) {
    try {
      buffer = decodeRuns(source, w * h);
      syncedSource = source;
    } catch {
      // transient prop mismatch during a resize; skip
    }
  }

  function setDirty(v: boolean) {
    if (dirty !== v) {
      dirty = v;
      dispatch('dirty', v);
    }
  }

  // Undo/redo as full-buffer snapshots, one per stroke. 10k cells × 50
  // snapshots is ~1 MB — trivial next to the canvas itself.
  let undoStack: Uint16Array[] = [];
  let redoStack: Uint16Array[] = [];
  function checkpoint() {
    undoStack = [...undoStack.slice(-49), buffer.slice()];
    redoStack = [];
  }
  function undo() {
    const prev = undoStack.at(-1);
    if (!prev) return;
    undoStack = undoStack.slice(0, -1);
    redoStack = [...redoStack, buffer.slice()];
    buffer = prev;
    setDirty(true);
    if (autosave) save();
  }
  function redo() {
    const next = redoStack.at(-1);
    if (!next) return;
    redoStack = redoStack.slice(0, -1);
    undoStack = [...undoStack, buffer.slice()];
    buffer = next;
    setDirty(true);
    if (autosave) save();
  }

  function paintValue(): number {
    if (tool === 'eraser') return mode === 'edit' ? VOID_TILE_ID : 0;
    return selected.id;
  }

  function stamp(cell: Cell) {
    const half = Math.floor((brushSize - 1) / 2);
    const value = paintValue();
    let changed = false;
    for (let dy = -half; dy < brushSize - half; dy++) {
      for (let dx = -half; dx < brushSize - half; dx++) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (buffer[y * w + x] !== value) {
          buffer[y * w + x] = value;
          changed = true;
        }
      }
    }
    if (changed) {
      buffer = buffer; // svelte: reassign to invalidate
      setDirty(true);
    }
  }

  function flood(cell: Cell) {
    const from = buffer[cell.y * w + cell.x];
    const to = paintValue();
    if (from === to) return;
    checkpoint();
    const stack: number[] = [cell.y * w + cell.x];
    while (stack.length > 0) {
      const i = stack.pop()!;
      if (buffer[i] !== from) continue;
      buffer[i] = to;
      const x = i % w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i < w * (h - 1)) stack.push(i + w);
    }
    buffer = buffer;
    setDirty(true);
    if (autosave) save();
  }

  function toggleDoor(cell: Cell) {
    const cur = tileById(buffer[cell.y * w + cell.x]);
    const counterpart = doorCounterpart(cur.id);
    if (!counterpart) return;
    checkpoint();
    buffer[cell.y * w + cell.x] = counterpart.id;
    buffer = buffer;
    setDirty(true);
    if (autosave) save();
  }

  // Rect tool: anchor on paintstart, preview while dragging, apply on end.
  let rectAnchor: Cell | null = null;
  let rectCursor: Cell | null = null;
  $: rectPreview = ((): OverlayLayer[] => {
    if (!rectAnchor || !rectCursor) return [];
    const cells: string[] = [];
    const x0 = Math.min(rectAnchor.x, rectCursor.x);
    const x1 = Math.max(rectAnchor.x, rectCursor.x);
    const y0 = Math.min(rectAnchor.y, rectCursor.y);
    const y1 = Math.max(rectAnchor.y, rectCursor.y);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) cells.push(`${x},${y}`);
    }
    return [{ cells, color: 'rgba(52,211,153,0.35)' }];
  })();

  function onPaintStart(cell: Cell) {
    if (busy) return;
    if (tool === 'fill') {
      flood(cell);
      return;
    }
    if (tool === 'door') {
      toggleDoor(cell);
      return;
    }
    if (tool === 'rect') {
      rectAnchor = cell;
      rectCursor = cell;
      return;
    }
    checkpoint();
    stamp(cell);
  }

  function onPaintMove(cell: Cell) {
    if (busy) return;
    if (tool === 'rect') {
      if (rectAnchor) rectCursor = cell;
      return;
    }
    if (tool === 'brush' || tool === 'eraser') stamp(cell);
  }

  function onPaintEnd() {
    if (tool === 'rect' && rectAnchor && rectCursor) {
      checkpoint();
      const value = paintValue();
      const x0 = Math.min(rectAnchor.x, rectCursor.x);
      const x1 = Math.max(rectAnchor.x, rectCursor.x);
      const y0 = Math.min(rectAnchor.y, rectCursor.y);
      const y1 = Math.max(rectAnchor.y, rectCursor.y);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) buffer[y * w + x] = value;
      }
      buffer = buffer;
      setDirty(true);
      rectAnchor = null;
      rectCursor = null;
    }
    if (autosave && dirty) save();
  }

  export function save() {
    const encoded = encodeRuns(buffer);
    syncedSource = encoded;
    setDirty(false);
    dispatch('save', {
      tiles: mode === 'edit' ? encoded : tiles,
      revealed: mode === 'fog' ? encoded : revealed
    });
  }

  function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty) save();
      return;
    }
    if (e.key === '[') brushSize = Math.max(1, brushSize - 1) as typeof brushSize;
    if (e.key === ']') brushSize = Math.min(3, brushSize + 1) as typeof brushSize;
    const digit = Number(e.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= palette.length) {
      selectedIdx = digit - 1;
    }
  }

  const TOOL_LABELS: Record<Tool, string> = {
    brush: '🖌 Brush',
    rect: '▭ Rect',
    fill: '🪣 Fill',
    eraser: '⌫ Eraser',
    door: '🚪 Door'
  };
</script>

<svelte:window on:keydown={onKeydown} />

<div data-testid="board-painter">
  <div class="mb-2 flex flex-wrap items-center gap-2 text-xs">
    {#each tools as t}
      <button
        class="rounded border px-2 py-1 {tool === t
          ? 'border-emerald-600 bg-emerald-900/40 text-emerald-200'
          : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
        on:click={() => (tool = t)}
        title={t === tool ? undefined : `Switch to ${t}`}
      >
        {TOOL_LABELS[t]}
      </button>
    {/each}
    {#if tool === 'brush' || tool === 'eraser'}
      <span class="ml-1 text-slate-500">size</span>
      {#each [1, 2, 3] as s}
        <button
          class="h-6 w-6 rounded border text-center {brushSize === s
            ? 'border-emerald-600 text-emerald-200'
            : 'border-slate-700 text-slate-500 hover:text-slate-300'}"
          on:click={() => (brushSize = s as 1 | 2 | 3)}
        >
          {s}
        </button>
      {/each}
    {/if}
    <span class="mx-1 text-slate-700">|</span>
    <button
      class="rounded border border-slate-700 px-2 py-1 text-slate-400 hover:text-slate-200 disabled:opacity-40"
      on:click={undo}
      disabled={undoStack.length === 0}
      title="Undo (Ctrl+Z)"
    >
      ↶ Undo
    </button>
    <button
      class="rounded border border-slate-700 px-2 py-1 text-slate-400 hover:text-slate-200 disabled:opacity-40"
      on:click={redo}
      disabled={redoStack.length === 0}
      title="Redo (Ctrl+Shift+Z)"
    >
      ↷ Redo
    </button>
    {#if !autosave}
      <button
        class="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1 text-emerald-200 hover:bg-emerald-900/70 disabled:opacity-40"
        on:click={save}
        disabled={!dirty || busy}
        data-testid="painter-save"
      >
        {dirty ? 'Save' : 'Saved'}
      </button>
    {/if}
  </div>

  <div class="mb-2 flex flex-wrap gap-1" data-testid="painter-palette">
    {#each palette as tile, i}
      <button
        class="flex items-center gap-1 rounded border px-1.5 py-1 text-[11px] {selectedIdx === i
          ? 'border-emerald-500 text-slate-100'
          : 'border-slate-800 text-slate-400 hover:border-slate-600'}"
        title="{tile.name}{i < 9 ? ` (${i + 1})` : ''}"
        on:click={() => (selectedIdx = i)}
      >
        <span
          class="inline-block h-4 w-4 rounded-sm border border-black/30"
          style="background: {tile.color.dark}"
        ></span>
        {tile.name}
      </button>
    {/each}
  </div>

  <BoardCanvas
    {w}
    {h}
    tiles={mode === 'edit' ? encodeRuns(buffer.length === w * h ? buffer : new Uint16Array(w * h)) : tiles}
    revealed={mode === 'fog' ? encodeRuns(buffer.length === w * h ? buffer : new Uint16Array(w * h)) : revealed}
    fogStyle="dm"
    {background}
    {backgroundOpacity}
    overlays={rectPreview}
    on:paintstart={(e) => onPaintStart(e.detail)}
    on:paintmove={(e) => onPaintMove(e.detail)}
    on:paintend={onPaintEnd}
  />
  <p class="mt-1 text-[10px] text-slate-600">
    Keys: 1–9 palette · [ ] brush size · Ctrl+Z undo · Ctrl+S save
  </p>
</div>
