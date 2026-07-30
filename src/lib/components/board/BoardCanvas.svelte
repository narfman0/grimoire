<script lang="ts" context="module">
  /** A small dot on the token's edge: conditions, concentration, whatever
   *  the caller wants to flag without opening the row. */
  export interface TokenBadge {
    /** Dot fill. */
    color: string;
    /** One character drawn inside the dot, when cells are big enough for it
     *  to be legible. */
    glyph?: string;
    /** Tooltip text — the caller joins these into the token's title. */
    title?: string;
  }

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
    /** Drawn with its own ring, outside the active-turn one — being
     *  inspected is not the same as being up. */
    selected?: boolean;
    draggable?: boolean;
    /** Status dots on the disc edge; at most the first three are drawn. */
    badges?: TokenBadge[];
    /** Side marker for occupancy/threat math ('pc' vs anything else); the
     *  canvas itself ignores it. */
    team?: string;
    /** Longest melee reach in feet, for the threat overlay — also ignored
     *  by the canvas itself. */
    reachFt?: number;
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
  /** Per-cell notes, keyed `"x,y"`. Drawn as a corner mark; the tooltip is
   *  the consumer's job (the canvas has one title for the whole element). */
  export let annotations: Record<string, { note: string; dmOnly?: boolean }> = {};
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
    /** A click on a token that didn't move it. Inspection, not a move — the
     *  encounter page selects the row, nothing else. */
    tokenclick: { id: string };
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
  /** Did the pointer cross into another cell during this press? Separates a
   *  paint *stroke* from a plain click: a stroke must not also read as a
   *  click (it used to, so ending a fog stroke fired `cellclick` at the
   *  consumers too), and a click must still get through, because that's how
   *  every non-painter tool on this canvas is driven. */
  let paintMoved = false;
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
    paintMoved = false;
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
        paintMoved = true;
        dispatch('paintmove', cell);
      }
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!interactive) return;
    if (dragTokenId) {
      const id = dragTokenId;
      const start = tokens.find((t) => t.id === id);
      const dropped = dragCell;
      dragTokenId = null;
      dragCell = null;
      // Dropping a token back where it started is a click, not a move: the
      // old code POSTed the same coordinates back, bumping the board version
      // and making every other tab refetch for nothing.
      if (dropped && start && (dropped.x !== start.x || dropped.y !== start.y)) {
        dispatch('tokendrop', { id, x: dropped.x, y: dropped.y });
      } else {
        dispatch('tokenclick', { id });
      }
      return;
    }
    const wasStroke = painting && paintMoved;
    if (painting) {
      painting = false;
      paintMoved = false;
      lastPaintKey = null;
      dispatch('paintend');
    }
    if (wasStroke) return; // a drag across cells is a stroke, not a click
    const cell = cellFromEvent(e);
    if (!cell) return;
    // A non-draggable token still reports the click (players can inspect the
    // board without being able to move anything).
    const token = tokenAt(cell);
    if (token) dispatch('tokenclick', { id: token.id });
    dispatch('cellclick', cell);
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
      // Selection sits outside the active ring so a token can be both the
      // creature whose turn it is and the one being inspected.
      if (t.selected) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(125,211,252,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
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
      // Status dots, walking down the disc's right edge. Three at most —
      // beyond that they'd overlap and the row card is the honest answer.
      const badges = (t.badges ?? []).slice(0, 3);
      if (badges.length > 0 && cellPx >= 12) {
        const br = Math.max(3, Math.floor(cellPx * 0.16));
        for (const [i, badge] of badges.entries()) {
          const bx = cx + r - br * 0.4;
          const by = cy - r + br + i * (br * 2 + 1);
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fillStyle = badge.color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(2,6,23,0.85)';
          ctx.lineWidth = 1;
          ctx.stroke();
          if (badge.glyph && br >= 5) {
            ctx.fillStyle = 'rgba(2,6,23,0.95)';
            ctx.font = `700 ${Math.floor(br * 1.4)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(badge.glyph.slice(0, 1), bx, by + 0.5);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // Annotation marks: a small corner triangle per noted cell, drawn over
    // the fog so a DM-only note on a hidden cell is still visible to the DM.
    for (const key of Object.keys(annotations)) {
      const [x, y] = key.split(',').map(Number);
      if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const size = Math.max(4, Math.floor(cellPx * 0.28));
      const x0 = (x + 1) * cellPx;
      const y0 = y * cellPx;
      ctx.beginPath();
      ctx.moveTo(x0 - size, y0);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x0, y0 + size);
      ctx.closePath();
      ctx.fillStyle = annotations[key].dmOnly ? 'rgba(196,181,253,0.95)' : 'rgba(250,204,21,0.95)';
      ctx.fill();
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
    void [
      tileArr,
      fogArr,
      tokens,
      overlays,
      path,
      ruler,
      annotations,
      bgImage,
      backgroundOpacity,
      dragCell,
      fogStyle
    ];
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
