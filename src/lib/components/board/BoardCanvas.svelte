<script lang="ts" context="module">
  export interface BoardToken {
    id: string;
    x: number;
    y: number;
    sizeCells: number;
    /** Short label drawn in the disc (initials). */
    label: string;
    /** Full name for the tooltip. */
    title?: string;
    color: string;
    /** HP-bucket ring color; null hides the ring. */
    ring?: string | null;
    active?: boolean;
    draggable?: boolean;
  }

  export interface OverlayLayer {
    /** cellKey() strings. */
    cells: Iterable<string>;
    /** rgba() fill. */
    color: string;
  }

  export interface RulerLine {
    a: { x: number; y: number };
    b: { x: number; y: number };
    label: string;
  }
</script>

<script lang="ts">
  // Shared board renderer: tiles + fog + overlays + tokens on one canvas,
  // with cell-level pointer events. Deliberately dumb — the painter, the
  // encounter panel and the table-mode view own all state and semantics;
  // this component just draws props and reports cells.
  import { createEventDispatcher } from 'svelte';
  import { decodeRuns } from '$lib/board/rle';
  import { tileById } from '$lib/board/tileset';
  import type { Cell } from '$lib/board/types';

  export let w: number;
  export let h: number;
  /** RLE tile string (already role-redacted by the server for players). */
  export let tiles: string;
  /** RLE fog bitmask, or null to skip fog rendering entirely. */
  export let revealed: string | null = null;
  /** How to draw unrevealed cells: 'dm' shades them translucently (the DM
   *  sees through their own fog), 'player' paints them out. */
  export let fogStyle: 'dm' | 'player' = 'player';
  export let background: string | null = null;
  export let backgroundOpacity = 0.5;
  export let tokens: BoardToken[] = [];
  export let overlays: OverlayLayer[] = [];
  /** Movement-path preview, drawn as a polyline through cell centers. */
  export let path: Cell[] = [];
  export let ruler: RulerLine | null = null;
  /** When false the canvas is display-only (table mode). */
  export let interactive = true;
  /** Cap on the rendered cell size in CSS px. */
  export let maxCellPx = 34;

  const dispatch = createEventDispatcher<{
    paintstart: Cell;
    paintmove: Cell;
    paintend: void;
    cellclick: Cell;
    cellhover: Cell | null;
    tokendrop: { id: string; x: number; y: number };
  }>();

  let canvas: HTMLCanvasElement;
  let wrapWidth = 0;

  $: cellPx = wrapWidth > 0 ? Math.max(10, Math.min(maxCellPx, Math.floor(wrapWidth / w))) : 0;
  $: cssW = cellPx * w;
  $: cssH = cellPx * h;

  // Decode defensively: while props settle (a resize changes w before
  // tiles), the string may mismatch — skip the frame instead of throwing.
  function tryDecode(encoded: string | null, len: number): Uint16Array | null {
    if (encoded === null) return null;
    try {
      return decodeRuns(encoded, len);
    } catch {
      return null;
    }
  }
  $: tileArr = tryDecode(tiles, w * h);
  $: fogArr = tryDecode(revealed, w * h);

  // Background image cache.
  let bgImage: HTMLImageElement | null = null;
  let bgLoadedFor: string | null = null;
  $: if (background && background !== bgLoadedFor) {
    const img = new Image();
    img.onload = () => {
      bgImage = img;
      bgLoadedFor = background;
    };
    img.src = background;
  } else if (!background) {
    bgImage = null;
    bgLoadedFor = null;
  }

  // Token drag state (ghost cell under the pointer).
  let dragTokenId: string | null = null;
  let dragCell: Cell | null = null;
  let painting = false;
  let lastPaintKey: string | null = null;
  let hoverCell: Cell | null = null;

  function cellFromEvent(e: PointerEvent): Cell | null {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / cellPx);
    const y = Math.floor((e.clientY - rect.top) / cellPx);
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    return { x, y };
  }

  function tokenAt(cell: Cell): BoardToken | undefined {
    // Later tokens draw on top, so hit-test back-to-front.
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      const size = Math.max(1, t.sizeCells);
      if (cell.x >= t.x && cell.x < t.x + size && cell.y >= t.y && cell.y < t.y + size) return t;
    }
    return undefined;
  }

  function onPointerDown(e: PointerEvent) {
    if (!interactive) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    canvas.setPointerCapture(e.pointerId);
    const token = tokenAt(cell);
    if (token?.draggable) {
      dragTokenId = token.id;
      dragCell = { x: token.x, y: token.y };
      return;
    }
    painting = true;
    lastPaintKey = `${cell.x},${cell.y}`;
    dispatch('paintstart', cell);
  }

  function onPointerMove(e: PointerEvent) {
    if (!interactive) return;
    const cell = cellFromEvent(e);
    if (`${cell?.x},${cell?.y}` !== `${hoverCell?.x},${hoverCell?.y}`) {
      hoverCell = cell;
      dispatch('cellhover', cell);
    }
    if (!cell) return;
    if (dragTokenId) {
      const token = tokens.find((t) => t.id === dragTokenId);
      const size = Math.max(1, token?.sizeCells ?? 1);
      dragCell = {
        x: Math.min(cell.x, w - size),
        y: Math.min(cell.y, h - size)
      };
      return;
    }
    if (painting) {
      const key = `${cell.x},${cell.y}`;
      if (key !== lastPaintKey) {
        lastPaintKey = key;
        dispatch('paintmove', cell);
      }
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!interactive) return;
    if (dragTokenId && dragCell) {
      dispatch('tokendrop', { id: dragTokenId, x: dragCell.x, y: dragCell.y });
      dragTokenId = null;
      dragCell = null;
      return;
    }
    if (painting) {
      painting = false;
      lastPaintKey = null;
      dispatch('paintend');
    }
    const cell = cellFromEvent(e);
    if (cell) dispatch('cellclick', cell);
  }

  function onPointerLeave() {
    if (hoverCell !== null) {
      hoverCell = null;
      dispatch('cellhover', null);
    }
  }

  function draw() {
    if (!canvas || cellPx <= 0 || !tileArr) return;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    // Tiles.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tile = tileById(tileArr[y * w + x]);
        ctx.fillStyle = tile.color.dark;
        ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }

    // Background image over the tile fills (translucent), under everything
    // else — the trace-over workflow wants the drawing visible but the
    // painted tiles distinguishable.
    if (bgImage) {
      ctx.globalAlpha = backgroundOpacity;
      ctx.drawImage(bgImage, 0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
    }

    // Tile glyphs (skip when cells get tiny).
    if (cellPx >= 16) {
      ctx.font = `${Math.floor(cellPx * 0.5)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const tile = tileById(tileArr[y * w + x]);
          if (!tile.glyph) continue;
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.fillText(tile.glyph, x * cellPx + cellPx / 2, y * cellPx + cellPx / 2 + 1);
        }
      }
    }

    // Grid.
    ctx.strokeStyle = 'rgba(148,163,184,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      ctx.moveTo(x * cellPx + 0.5, 0);
      ctx.lineTo(x * cellPx + 0.5, cssH);
    }
    for (let y = 0; y <= h; y++) {
      ctx.moveTo(0, y * cellPx + 0.5);
      ctx.lineTo(cssW, y * cellPx + 0.5);
    }
    ctx.stroke();

    // Overlays (reachable shading, AoE preview, threatened cells, …).
    for (const layer of overlays) {
      ctx.fillStyle = layer.color;
      for (const key of layer.cells) {
        const [x, y] = key.split(',').map(Number);
        if (x >= 0 && y >= 0 && x < w && y < h) {
          ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        }
      }
    }

    // Path preview.
    if (path.length > 1) {
      ctx.strokeStyle = 'rgba(52,211,153,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(path[0].x * cellPx + cellPx / 2, path[0].y * cellPx + cellPx / 2);
      for (const c of path.slice(1)) {
        ctx.lineTo(c.x * cellPx + cellPx / 2, c.y * cellPx + cellPx / 2);
      }
      ctx.stroke();
    }

    // Fog.
    if (fogArr) {
      ctx.fillStyle = fogStyle === 'dm' ? 'rgba(2,6,23,0.55)' : 'rgb(9,11,17)';
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (fogArr[y * w + x] !== 1) {
            ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
          }
        }
      }
    }

    // Tokens.
    for (const t of tokens) {
      const size = Math.max(1, t.sizeCells);
      const isDragged = t.id === dragTokenId;
      const cx = ((isDragged && dragCell ? dragCell.x : t.x) + size / 2) * cellPx;
      const cy = ((isDragged && dragCell ? dragCell.y : t.y) + size / 2) * cellPx;
      const r = (size * cellPx) / 2 - 2;
      if (isDragged) ctx.globalAlpha = 0.7;
      if (t.active) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(251,191,36,0.95)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = t.color;
      ctx.fill();
      if (t.ring) {
        ctx.beginPath();
        ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
        ctx.strokeStyle = t.ring;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (cellPx >= 14) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = `600 ${Math.max(9, Math.floor(cellPx * 0.38 * size))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.label.slice(0, 2), cx, cy + 1);
      }
      ctx.globalAlpha = 1;
    }

    // Ruler.
    if (ruler) {
      const ax = ruler.a.x * cellPx + cellPx / 2;
      const ay = ruler.a.y * cellPx + cellPx / 2;
      const bx = ruler.b.x * cellPx + cellPx / 2;
      const by = ruler.b.y * cellPx + cellPx / 2;
      ctx.strokeStyle = 'rgba(96,165,250,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 12px system-ui, sans-serif';
      const label = ruler.label;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15,23,42,0.9)';
      ctx.fillRect((ax + bx) / 2 - tw / 2 - 4, (ay + by) / 2 - 18, tw + 8, 16);
      ctx.fillStyle = 'rgb(147,197,253)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, (ax + bx) / 2, (ay + by) / 2 - 10);
    }
  }

  // Redraw whenever anything visual changes. Listing the deps keeps Svelte's
  // tracker honest (a bare draw() call would never re-run).
  $: if (canvas && cellPx > 0) {
    void [tileArr, fogArr, tokens, overlays, path, ruler, bgImage, backgroundOpacity, dragCell, fogStyle];
    draw();
  }
</script>

<div class="w-full" bind:clientWidth={wrapWidth}>
  <canvas
    bind:this={canvas}
    style="width: {cssW}px; height: {cssH}px; touch-action: none;"
    class="rounded border border-slate-800 {interactive ? 'cursor-crosshair' : ''}"
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointerleave={onPointerLeave}
  ></canvas>
</div>
