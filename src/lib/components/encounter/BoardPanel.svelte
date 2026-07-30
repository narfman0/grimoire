<script lang="ts" context="module">
  export interface BoardWireShape {
    encounterId: string;
    sourceMapId: string | null;
    w: number;
    h: number;
    cellFt: number;
    tiles: string;
    revealed: string;
    background: string | null;
    version: number;
  }
</script>

<script lang="ts">
  // Encounter battle-board panel. Owns the board wire state (SSR-seeded,
  // refetched from GET .../board whenever the poll's boardVersion outruns
  // the local copy) and the DM tools; the parent owns participants and
  // position writes (tokens arrive pre-redacted and pre-labeled, moves
  // leave as `moveToken` events).
  //
  // Modes: tokens (drag + placement + planning overlays), ruler, and — DM
  // only — fog (reveal brush, autosaves per stroke) and terrain (embedded
  // painter, explicit save).
  import { createEventDispatcher } from 'svelte';
  import { api } from '$lib/client/api';
  import { confirmDialog } from '$lib/components/ui/confirm';
  import BoardCanvas, {
    type BoardToken,
    type OverlayLayer,
    type RulerLine
  } from '$lib/components/board/BoardCanvas.svelte';
  import BoardPainter from '$lib/components/board/BoardPainter.svelte';
  import { encodeRuns } from '$lib/board/rle';
  import {
    decodeBoard,
    distanceFt,
    footprintCells,
    reachableCells,
    threatenedCells,
    type Grid
  } from '$lib/board/geometry';
  import type { Cell } from '$lib/board/types';

  export let encounterId: string;
  export let role: 'dm' | 'player';
  export let board: BoardWireShape | null = null;
  export let boardVersion: number | null = null;
  export let tokens: BoardToken[] = [];
  export let unplaced: Array<{ id: string; label: string }> = [];
  /** Selected participant context for planning overlays. */
  export let selected: { id: string; speedFt: number; kind: string } | null = null;
  export let busy = false;

  const dispatch = createEventDispatcher<{
    moveToken: { id: string; x: number; y: number };
  }>();

  let liveBoard: BoardWireShape | null = board;
  let collapsed = false;
  type Mode = 'tokens' | 'ruler' | 'fog' | 'terrain';
  let mode: Mode = 'tokens';
  let placing: string | null = null;
  let rulerAnchor: Cell | null = null;
  let rulerHover: Cell | null = null;
  let overlaysOn = true;

  // --- keep the board fresh off the poll's change token -------------------
  let fetchingVersion: number | null = null;
  $: if (boardVersion === null && liveBoard) {
    liveBoard = null; // detached in another tab
  }
  $: if (
    boardVersion !== null &&
    boardVersion !== fetchingVersion &&
    (!liveBoard || boardVersion > liveBoard.version)
  ) {
    fetchingVersion = boardVersion;
    void api
      .get<BoardWireShape>(`/api/encounters/${encounterId}/board`, { silent: true })
      .then((b) => (liveBoard = b))
      .catch(() => {})
      .finally(() => (fetchingVersion = null));
  }

  // --- DM attach flow -------------------------------------------------------
  let mapsList: Array<{ id: string; name: string; w: number; h: number }> | null = null;
  let attachMapId = '';
  let blankW = 20;
  let blankH = 15;
  let attaching = false;
  $: if (role === 'dm' && !liveBoard && mapsList === null) {
    mapsList = [];
    void api
      .get<{ maps: Array<{ id: string; name: string; w: number; h: number }> }>('/api/maps', {
        silent: true
      })
      .then((r) => (mapsList = r.maps))
      .catch(() => {});
  }

  async function attach(body: Record<string, unknown>) {
    attaching = true;
    try {
      liveBoard = await api<BoardWireShape>(`/api/encounters/${encounterId}/board`, {
        method: 'PUT',
        body
      });
      mode = 'tokens';
    } catch {
      // api() already toasted
    } finally {
      attaching = false;
    }
  }

  async function detach() {
    const ok = await confirmDialog({
      title: 'Detach the board?',
      message: 'Token positions are kept; the tiles and fog are discarded.',
      confirmLabel: 'Detach',
      danger: true
    });
    if (!ok) return;
    try {
      await api.del(`/api/encounters/${encounterId}/board`);
      liveBoard = null;
    } catch {
      // api() already toasted
    }
  }

  async function patchBoard(body: { tiles?: string; revealed?: string }) {
    try {
      liveBoard = await api.patch<BoardWireShape>(`/api/encounters/${encounterId}/board`, body);
    } catch {
      // api() already toasted
    }
  }

  function bulkFog(bit: 0 | 1) {
    if (!liveBoard) return;
    void patchBoard({ revealed: encodeRuns(new Array(liveBoard.w * liveBoard.h).fill(bit)) });
  }

  // --- planning overlays ----------------------------------------------------
  function tryGrid(b: BoardWireShape): Grid | null {
    try {
      return decodeBoard({ w: b.w, h: b.h, cellFt: b.cellFt, tiles: b.tiles });
    } catch {
      return null;
    }
  }
  $: grid = liveBoard ? tryGrid(liveBoard) : null;

  $: selectedToken = selected ? tokens.find((t) => t.id === selected.id) : undefined;
  $: overlays = ((): OverlayLayer[] => {
    if (!overlaysOn || mode !== 'tokens' || !grid || !selected || !selectedToken) return [];
    const team = selected.kind === 'pc' ? 'pc' : 'foe';
    const occupied = { allies: [] as Cell[], enemies: [] as Cell[] };
    const threatSources: Array<{ cell: Cell; team: string; sizeCells: number }> = [];
    for (const t of tokens) {
      if (t.id === selected.id) continue;
      const tTeam = t.team ?? 'foe';
      const cells = footprintCells({ x: t.x, y: t.y }, t.sizeCells);
      (tTeam === team ? occupied.allies : occupied.enemies).push(...cells);
      threatSources.push({ cell: { x: t.x, y: t.y }, team: tTeam, sizeCells: t.sizeCells });
    }
    const reach = reachableCells(
      grid,
      { x: selectedToken.x, y: selectedToken.y },
      selected.speedFt,
      occupied
    );
    const threat = threatenedCells(grid, threatSources, team);
    return [
      { cells: reach.costFt.keys(), color: 'rgba(52,211,153,0.18)' },
      { cells: threat, color: 'rgba(248,113,113,0.14)' }
    ];
  })();

  // --- ruler ----------------------------------------------------------------
  $: ruler = ((): RulerLine | null => {
    if (mode !== 'ruler' || !rulerAnchor || !rulerHover || !grid) return null;
    return {
      a: rulerAnchor,
      b: rulerHover,
      label: `${distanceFt(grid, rulerAnchor, rulerHover)} ft`
    };
  })();

  function onCellClick(cell: Cell) {
    if (mode === 'ruler') {
      rulerAnchor = rulerAnchor && rulerHover ? null : cell;
      return;
    }
    if (mode === 'tokens' && placing) {
      dispatch('moveToken', { id: placing, x: cell.x, y: cell.y });
      placing = null;
    }
  }
</script>

{#if liveBoard || role === 'dm'}
  <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4" data-testid="board-panel">
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <button
        class="text-sm font-semibold text-slate-300 hover:text-slate-100"
        on:click={() => (collapsed = !collapsed)}
      >
        {collapsed ? '▸' : '▾'} Battle map
      </button>
      {#if liveBoard && !collapsed}
        <span class="text-[10px] text-slate-600">
          {liveBoard.w}×{liveBoard.h} · {liveBoard.cellFt} ft cells
        </span>
        <span class="mx-1 text-slate-700">|</span>
        <button
          class="rounded border px-2 py-0.5 text-xs {mode === 'tokens'
            ? 'border-emerald-600 text-emerald-200'
            : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
          on:click={() => (mode = 'tokens')}
        >
          Tokens
        </button>
        <button
          class="rounded border px-2 py-0.5 text-xs {mode === 'ruler'
            ? 'border-emerald-600 text-emerald-200'
            : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
          on:click={() => {
            mode = 'ruler';
            rulerAnchor = null;
          }}
        >
          📏 Ruler
        </button>
        {#if role === 'dm'}
          <button
            class="rounded border px-2 py-0.5 text-xs {mode === 'fog'
              ? 'border-amber-600 text-amber-200'
              : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
            on:click={() => (mode = 'fog')}
          >
            🌫 Fog
          </button>
          <button
            class="rounded border px-2 py-0.5 text-xs {mode === 'terrain'
              ? 'border-amber-600 text-amber-200'
              : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
            on:click={() => (mode = 'terrain')}
          >
            ⛰ Terrain
          </button>
          <button
            class="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200"
            on:click={() => bulkFog(1)}
            title="Reveal the whole board"
          >
            👁 Reveal all
          </button>
          <button
            class="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:text-slate-200"
            on:click={() => bulkFog(0)}
            title="Hide the whole board"
          >
            🙈 Hide all
          </button>
          <button
            class="ml-auto rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-500 hover:text-red-400"
            on:click={detach}
          >
            Detach
          </button>
        {/if}
        {#if mode === 'tokens' && selected}
          <label class="flex items-center gap-1 text-[11px] text-slate-500">
            <input type="checkbox" bind:checked={overlaysOn} class="accent-emerald-500" />
            overlays
          </label>
        {/if}
      {/if}
    </div>

    {#if !collapsed}
      {#if !liveBoard}
        <!-- DM attach flow (players never see this branch — the whole panel
             is hidden for them when no board exists). -->
        <div class="flex flex-wrap items-end gap-3 text-xs">
          <label class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-wide text-slate-500">From your library</span>
            <select
              class="rounded border border-slate-700 bg-slate-950 px-2 py-1"
              bind:value={attachMapId}
            >
              <option value="">— pick a map —</option>
              {#each mapsList ?? [] as m}
                <option value={m.id}>{m.name} ({m.w}×{m.h})</option>
              {/each}
            </select>
          </label>
          <button
            class="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1 text-emerald-200 disabled:opacity-40"
            disabled={!attachMapId || attaching}
            on:click={() => attach({ mapId: attachMapId })}
          >
            Attach map
          </button>
          <span class="text-slate-600">or</span>
          <label class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-wide text-slate-500">Blank</span>
            <span class="flex items-center gap-1">
              <input
                type="number"
                min="1"
                max="100"
                class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                bind:value={blankW}
              />
              ×
              <input
                type="number"
                min="1"
                max="100"
                class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                bind:value={blankH}
              />
            </span>
          </label>
          <button
            class="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:text-slate-100 disabled:opacity-40"
            disabled={attaching}
            on:click={() => attach({ w: blankW, h: blankH })}
          >
            Create blank
          </button>
          <a class="text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline" href="/maps">
            Map builder →
          </a>
        </div>
      {:else if mode === 'fog' && role === 'dm'}
        <BoardPainter
          w={liveBoard.w}
          h={liveBoard.h}
          tiles={liveBoard.tiles}
          revealed={liveBoard.revealed}
          mode="fog"
          background={liveBoard.background}
          autosave
          {busy}
          on:save={(e) => e.detail.revealed && patchBoard({ revealed: e.detail.revealed })}
        />
      {:else if mode === 'terrain' && role === 'dm'}
        <BoardPainter
          w={liveBoard.w}
          h={liveBoard.h}
          tiles={liveBoard.tiles}
          revealed={liveBoard.revealed}
          mode="edit"
          background={liveBoard.background}
          {busy}
          on:save={(e) => patchBoard({ tiles: e.detail.tiles })}
        />
      {:else}
        {#if unplaced.length > 0 && mode === 'tokens'}
          <div class="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
            place:
            {#each unplaced as u (u.id)}
              <button
                class="rounded border px-1.5 py-0.5 {placing === u.id
                  ? 'border-emerald-500 text-emerald-200'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
                on:click={() => (placing = placing === u.id ? null : u.id)}
                title={placing === u.id ? 'Click a cell to drop the token' : `Place ${u.label}`}
              >
                {u.label}
              </button>
            {/each}
            {#if placing}
              <span class="text-emerald-300">→ click a cell</span>
            {/if}
          </div>
        {/if}
        <BoardCanvas
          w={liveBoard.w}
          h={liveBoard.h}
          tiles={liveBoard.tiles}
          revealed={liveBoard.revealed}
          fogStyle={role === 'dm' ? 'dm' : 'player'}
          background={liveBoard.background}
          backgroundOpacity={0.45}
          {tokens}
          {overlays}
          ruler={ruler}
          on:tokendrop={(e) => dispatch('moveToken', e.detail)}
          on:cellclick={(e) => onCellClick(e.detail)}
          on:cellhover={(e) => (rulerHover = e.detail ?? rulerHover)}
        />
        {#if mode === 'ruler'}
          <p class="mt-1 text-[10px] text-slate-600">
            Click to anchor the ruler, click again to clear.
          </p>
        {/if}
      {/if}
    {/if}
  </section>
{/if}
