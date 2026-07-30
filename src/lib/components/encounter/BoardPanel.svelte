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
  // Modes: tokens (drag + placement + planning overlays), ruler, AoE
  // (template preview + caught-creature handoff to the resolve panel), and
  // — DM only — fog (reveal brush, autosaves per stroke) and terrain
  // (embedded painter, explicit save).
  import { createEventDispatcher } from 'svelte';
  import { api } from '$lib/client/api';
  import { confirmDialog } from '$lib/components/ui/confirm';
  import BoardCanvas, {
    type BoardToken,
    type OverlayLayer,
    type RulerLine
  } from '$lib/components/board/BoardCanvas.svelte';
  import BoardPainter from '$lib/components/board/BoardPainter.svelte';
  import { decodeRuns, encodeRuns } from '$lib/board/rle';
  import {
    aoeCells,
    decodeBoard,
    distanceFt,
    footprintCells,
    pathTo,
    reachableCells,
    threatenedCells,
    type AoeShape,
    type Grid
  } from '$lib/board/geometry';
  import { AOE_PRESETS, tokensInCells } from '$lib/board/aoe';
  import { revealVisible, visibleFromAny } from '$lib/board/vision';
  import { cellKey, type Cell } from '$lib/board/types';

  export let encounterId: string;
  export let role: 'dm' | 'player';
  export let board: BoardWireShape | null = null;
  export let boardVersion: number | null = null;
  export let tokens: BoardToken[] = [];
  export let unplaced: Array<{ id: string; label: string }> = [];
  /** Selected participant context for planning overlays. `plannable` also
   *  arms click-to-plan: a click on a reachable cell becomes the plan's
   *  moveTo. */
  export let selected: {
    id: string;
    speedFt: number;
    kind: string;
    plannable?: boolean;
    moveTo?: { x: number; y: number } | null;
  } | null = null;
  export let busy = false;

  const dispatch = createEventDispatcher<{
    moveToken: { id: string; x: number; y: number };
    planMove: { id: string; x: number; y: number; path: Cell[] | null };
    /** Fired whenever the panel's board copy changes (attach, paint,
     *  refetch, detach) so the parent's geometry consumers (resolve
     *  warnings, turn suggestions) never work from a stale SSR board. */
    boardChanged: BoardWireShape | null;
    /** A locked AoE template's caught participants, handed to the resolve
     *  panel as its multi-save target list. */
    aoeTargets: { participantIds: string[]; label: string };
  }>();

  let liveBoard: BoardWireShape | null = board;

  /** Version-guarded assignment: an in-flight GET must never reinstate an
   *  older board over fog strokes that already landed locally. */
  function acceptBoard(b: BoardWireShape | null) {
    if (b && liveBoard && b.version < liveBoard.version) return;
    liveBoard = b;
  }
  $: dispatch('boardChanged', liveBoard);
  let collapsed = false;
  type Mode = 'tokens' | 'ruler' | 'aoe' | 'fog' | 'terrain';
  let mode: Mode = 'tokens';
  let placing: string | null = null;
  let rulerAnchor: Cell | null = null;
  let hoverCell: Cell | null = null;
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
      .then((b) => acceptBoard(b))
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
      acceptBoard(
        await api<BoardWireShape>(`/api/encounters/${encounterId}/board`, {
          method: 'PUT',
          body
        })
      );
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
      acceptBoard(await api.patch<BoardWireShape>(`/api/encounters/${encounterId}/board`, body));
    } catch {
      // api() already toasted
    }
  }

  function bulkFog(bit: 0 | 1) {
    if (!liveBoard) return;
    void patchBoard({ revealed: encodeRuns(new Array(liveBoard.w * liveBoard.h).fill(bit)) });
  }

  // --- fog auto-reveal from PC line of sight ---------------------------------
  //
  // With this on, the DM stops hand-brushing corridors: whenever the party's
  // token positions change, whatever the PCs can see is ORed into the fog
  // mask. Fog only grows — a room the party walked through stays revealed
  // after they leave, which is how table fog behaves.
  //
  // Applied from the DM tab rather than server-side on the position write:
  // it needs no schema column for the toggle, and the DM's tab is the fog
  // writer in practice anyway. Players never run it (the button is DM-only),
  // so two DM tabs are the only concurrency, and the PATCH is idempotent —
  // ORing the same cells twice is a no-op that skips the write entirely.
  //
  // One consequence worth knowing at the table: "Hide all" while this is on
  // re-reveals everything the party can currently see on the next tick. Turn
  // the toggle off first to black out a map they're standing on.
  let autoReveal = false;
  /** Signature of the PC token layout the last reveal ran against, so a
   *  poll tick that changes nothing doesn't re-walk the board. */
  let lastRevealSig = '';
  let revealing = false;

  $: pcVisionCells = tokens
    .filter((t) => (t.team ?? 'foe') === 'pc')
    .map((t) => ({ x: t.x, y: t.y }));

  $: if (autoReveal && role === 'dm' && liveBoard && grid && !revealing) {
    const sig = `${liveBoard.version}:${pcVisionCells.map((c) => `${c.x},${c.y}`).join('|')}`;
    if (sig !== lastRevealSig) {
      lastRevealSig = sig;
      applyAutoReveal(liveBoard, grid, pcVisionCells);
    }
  }

  function applyAutoReveal(b: BoardWireShape, g: Grid, froms: Cell[]) {
    if (froms.length === 0) return;
    let fog: Uint16Array;
    try {
      fog = decodeRuns(b.revealed, b.w * b.h);
    } catch {
      return; // corrupt mask: leave it to the DM's brush rather than guessing
    }
    const next = revealVisible(fog, visibleFromAny(g, froms), b.w, b.h);
    if (!next) return; // already lit — no version bump, no refetch storm
    revealing = true;
    void patchBoard({ revealed: encodeRuns(next) }).finally(() => (revealing = false));
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
  $: planContext = ((): {
    reach: ReturnType<typeof reachableCells>;
    threat: Set<string>;
  } | null => {
    if (!overlaysOn || mode !== 'tokens' || !grid || !selected || !selectedToken) return null;
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
    return {
      reach: reachableCells(
        grid,
        { x: selectedToken.x, y: selectedToken.y },
        selected.speedFt,
        occupied
      ),
      threat: threatenedCells(grid, threatSources, team)
    };
  })();
  $: overlays = ((): OverlayLayer[] => {
    // The AoE template owns the canvas while that tool is active — stacking
    // reach and threat under it makes the burst unreadable.
    if (mode === 'aoe') {
      return aoeFootprint.length > 0
        ? [
            {
              cells: aoeFootprint.map(cellKey),
              color: aoeLocked ? 'rgba(251,146,60,0.42)' : 'rgba(251,146,60,0.26)'
            }
          ]
        : [];
    }
    if (!planContext) return [];
    const layers: OverlayLayer[] = [
      { cells: planContext.reach.costFt.keys(), color: 'rgba(52,211,153,0.18)' },
      { cells: planContext.threat, color: 'rgba(248,113,113,0.14)' }
    ];
    if (selected?.moveTo) {
      layers.push({ cells: [cellKey(selected.moveTo)], color: 'rgba(52,211,153,0.45)' });
    }
    return layers;
  })();
  /** Cheapest path to the planned destination, for OA-aware display. */
  $: planPath =
    planContext && selected?.moveTo ? pathTo(planContext.reach, selected.moveTo) ?? [] : [];

  // --- ruler ----------------------------------------------------------------
  $: ruler = ((): RulerLine | null => {
    if (mode !== 'ruler' || !rulerAnchor || !hoverCell || !grid) return null;
    return {
      a: rulerAnchor,
      b: hoverCell,
      label: `${distanceFt(grid, rulerAnchor, hoverCell)} ft`
    };
  })();

  // --- AoE templates --------------------------------------------------------
  //
  // The optimizer has been using aoeCells to score its own AoE picks since
  // §F; this puts the same geometry under the DM's cursor. Sphere and cube
  // centre on the hovered cell; cone and line project *from* a caster, so
  // they need an origin — the selected token, or an explicit anchor click
  // when nothing is selected.
  let aoeShape: AoeShape = 'sphere';
  let aoeSizeFt = 20;
  /** Explicit origin for cone/line when no token is selected. */
  let aoeAnchor: Cell | null = null;
  /** Locked template — survives the cursor leaving the canvas so the DM can
   *  read the caught list and hand it to the resolve panel. */
  let aoeLocked: { origin: Cell; dir: Cell | null } | null = null;

  $: aoeNeedsDirection = aoeShape === 'cone' || aoeShape === 'line';
  /** Where the template emanates from, for the *live* (unlocked) preview. */
  $: aoeOrigin = ((): Cell | null => {
    if (mode !== 'aoe') return null;
    if (aoeNeedsDirection) {
      if (selectedToken) return { x: selectedToken.x, y: selectedToken.y };
      return aoeAnchor;
    }
    return hoverCell;
  })();
  /** The template actually being displayed: the locked one if there is one,
   *  otherwise whatever the cursor implies. */
  $: aoeTemplate = ((): { origin: Cell; dir: Cell | null } | null => {
    if (mode !== 'aoe' || !grid) return null;
    if (aoeLocked) return aoeLocked;
    if (!aoeOrigin) return null;
    if (aoeNeedsDirection && !hoverCell) return null;
    // Sphere ignores `dir`; cube reads it as a facing, and origin===dir
    // (the cursor cell) means "centred here", which is what we want.
    return { origin: aoeOrigin, dir: hoverCell };
  })();
  $: aoeFootprint =
    grid && aoeTemplate
      ? aoeCells(grid, aoeTemplate.origin, aoeShape, aoeSizeFt, aoeTemplate.dir ?? undefined)
      : [];
  /** Participants the locked template catches, in roster order. Only for a
   *  locked template: a list that flickers under the cursor is unreadable
   *  and the handoff button would be a moving target. */
  $: aoeCaught =
    aoeLocked && aoeFootprint.length > 0
      ? tokensInCells(aoeFootprint, tokens).map((id) => ({
          id,
          name: tokens.find((t) => t.id === id)?.title ?? tokens.find((t) => t.id === id)?.label ?? id
        }))
      : [];
  $: aoeLabel = `${aoeShape} ${aoeSizeFt} ft`;

  function resetAoe() {
    aoeLocked = null;
    aoeAnchor = null;
  }

  function applyAoePreset(value: string) {
    const preset = AOE_PRESETS[Number(value)];
    if (!preset) return;
    aoeShape = preset.shape;
    aoeSizeFt = preset.sizeFt;
    aoeLocked = null;
  }

  function onCellClick(cell: Cell) {
    if (mode === 'ruler') {
      rulerAnchor = rulerAnchor && hoverCell ? null : cell;
      return;
    }
    if (mode === 'aoe') {
      // Locked → clicking anywhere releases. Cone/line with no caster and
      // no anchor yet → this click is the anchor. Otherwise lock here.
      if (aoeLocked) {
        aoeLocked = null;
        return;
      }
      if (aoeNeedsDirection && !selectedToken && !aoeAnchor) {
        aoeAnchor = cell;
        return;
      }
      const origin = aoeNeedsDirection
        ? selectedToken
          ? { x: selectedToken.x, y: selectedToken.y }
          : aoeAnchor
        : cell;
      if (!origin) return;
      aoeLocked = { origin, dir: cell };
      return;
    }
    if (mode === 'tokens' && placing) {
      dispatch('moveToken', { id: placing, x: cell.x, y: cell.y });
      placing = null;
      return;
    }
    // Click-to-plan: a reachable cell becomes the selected participant's
    // planned destination (soft — resolve warns, never blocks).
    if (mode === 'tokens' && selected?.plannable && planContext && selectedToken) {
      if (cell.x === selectedToken.x && cell.y === selectedToken.y) return;
      if (!planContext.reach.costFt.has(cellKey(cell))) return;
      dispatch('planMove', {
        id: selected.id,
        x: cell.x,
        y: cell.y,
        path: pathTo(planContext.reach, cell)
      });
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
        <button
          class="rounded border px-2 py-0.5 text-xs {mode === 'aoe'
            ? 'border-orange-500 text-orange-200'
            : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
          on:click={() => {
            mode = 'aoe';
            resetAoe();
          }}
        >
          💥 AoE
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
            class="rounded border px-2 py-0.5 text-xs {autoReveal
              ? 'border-amber-500 text-amber-200'
              : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
            on:click={() => (autoReveal = !autoReveal)}
            title="Reveal what the party can see as they move. Fog only grows — revealed stays revealed."
            data-testid="auto-reveal-toggle"
          >
            🔭 Auto-reveal{autoReveal ? ' on' : ''}
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
        {#if mode === 'aoe'}
          <div
            class="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400"
            data-testid="aoe-controls"
          >
            <select
              class="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5"
              aria-label="AoE shape"
              bind:value={aoeShape}
              on:change={() => (aoeLocked = null)}
            >
              <option value="sphere">sphere</option>
              <option value="cone">cone</option>
              <option value="line">line</option>
              <option value="cube">cube</option>
            </select>
            <label class="flex items-center gap-1">
              <input
                type="number"
                min="5"
                max="200"
                step="5"
                class="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-center"
                aria-label="AoE size in feet"
                bind:value={aoeSizeFt}
                on:input={() => (aoeLocked = null)}
              />
              ft
            </label>
            <select
              class="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5"
              aria-label="AoE preset"
              on:change={(e) => applyAoePreset(e.currentTarget.value)}
            >
              <option value="">— preset —</option>
              {#each AOE_PRESETS as p, i}
                <option value={String(i)}>{p.label}</option>
              {/each}
            </select>
            {#if aoeLocked}
              <button
                class="rounded border border-slate-700 px-1.5 py-0.5 hover:text-slate-200"
                on:click={resetAoe}
              >
                clear
              </button>
            {/if}
            <span class="text-slate-600">
              {#if aoeLocked}
                · locked — {aoeFootprint.length} cell(s)
              {:else if aoeNeedsDirection && !selectedToken && !aoeAnchor}
                · click the caster's cell, then aim
              {:else if aoeNeedsDirection}
                · aim from {selectedToken ? 'the selected token' : 'the anchor'}, click to lock
              {:else}
                · hover to aim, click to lock
              {/if}
            </span>
          </div>
        {/if}
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
          path={planPath}
          ruler={ruler}
          on:tokendrop={(e) => dispatch('moveToken', e.detail)}
          on:cellclick={(e) => onCellClick(e.detail)}
          on:cellhover={(e) => (hoverCell = e.detail ?? hoverCell)}
        />
        {#if mode === 'ruler'}
          <p class="mt-1 text-[10px] text-slate-600">
            Click to anchor the ruler, click again to clear.
          </p>
        {/if}
        {#if mode === 'aoe' && aoeLocked}
          <div class="mt-2 rounded border border-orange-900/60 bg-orange-950/20 p-2" data-testid="aoe-caught">
            {#if aoeCaught.length === 0}
              <p class="text-[11px] text-slate-500">Nothing caught in the template.</p>
            {:else}
              <div class="mb-1 flex flex-wrap items-center gap-1 text-[11px]">
                <span class="text-slate-500">Caught ({aoeCaught.length}):</span>
                {#each aoeCaught as c (c.id)}
                  <span class="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-300">
                    {c.name}
                  </span>
                {/each}
              </div>
              {#if role === 'dm'}
                <button
                  class="rounded border border-orange-700 bg-orange-900/40 px-2 py-0.5 text-[11px] text-orange-200 hover:border-orange-500"
                  on:click={() =>
                    dispatch('aoeTargets', {
                      participantIds: aoeCaught.map((c) => c.id),
                      label: aoeLabel
                    })}
                >
                  → check all as multi-save targets
                </button>
              {/if}
            {/if}
          </div>
        {/if}
      {/if}
    {/if}
  </section>
{/if}
