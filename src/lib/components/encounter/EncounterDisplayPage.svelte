<!--
  Table mode — a read-only, big-type view of a running encounter for the
  screen in the middle of the table (projector, TV, spare tablet).

  Shared by both encounter URL schemes; the route wrappers pass only the
  back-link. Nothing here mutates: no buttons, no inputs, no selection.

  Redaction: the page data arrives from buildEncounterDisplayData(), which
  runs the *player* branch of the encounter loader regardless of who opened
  the view — the DM's own hidden ambush must not land on the shared screen.
  The 2s poll can't do that server-side (it redacts for the viewer, and the
  viewer here may be the DM), so the poll list is re-redacted client-side by
  mergeDisplayParticipants → buildLiveParticipantList(..., isDM=false). See
  $lib/encounter/display-list.

  Liveness rides the existing encounter channel — the same 2s poll the
  interactive page uses, no extra endpoint and no second timer.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import HpBucketBadge from '$lib/components/HpBucketBadge.svelte';
  import { hpBucket, type HpBucket } from '$lib/realtime/reveals';
  import {
    connectEncounter,
    type ConnectedEncounter,
    type EncounterSnapshot,
    type ParticipantHp
  } from '$lib/realtime/encounter-channel';
  import {
    mergeDisplayParticipants,
    showsExactHp,
    type DisplayHp
  } from '$lib/encounter/display-list';
  import BoardCanvas, { type BoardToken } from '$lib/components/board/BoardCanvas.svelte';
  import { maskTilesForPlayer } from '$lib/board/fog';
  import { decodeRuns } from '$lib/board/rle';
  import { visibleAnnotations, visibleTokenPositions } from '$lib/encounter/board-visibility';
  import type { EncounterDisplayData } from '$lib/server/encounter-display';

  export let data: EncounterDisplayData;
  /** Back to the interactive encounter page — route-specific URL scheme. */
  export let encounterHref: string;

  let conn: ConnectedEncounter | null = null;
  let liveState: EncounterSnapshot | null = null;
  let connStatus: 'connecting' | 'open' | 'closed' = 'connecting';

  onMount(() => {
    const seedHp: Record<string, ParticipantHp> = {};
    for (const p of data.participants) {
      seedHp[p.id] = { currentHp: p.currentHp, tempHp: p.tempHp, conditions: p.conditions };
    }
    conn = connectEncounter({
      encounterId: data.encounter.id,
      seed: {
        round: data.encounter.round,
        status: data.encounter.status as EncounterSnapshot['status'],
        activeParticipantId: data.encounter.activeParticipantId,
        participantHp: seedHp
      }
    });
    const unsubState = conn.state.subscribe((v) => (liveState = v));
    const unsubStatus = conn.status.subscribe((s) => (connStatus = s));
    return () => {
      unsubState();
      unsubStatus();
    };
  });

  onDestroy(() => {
    conn?.destroy();
    conn = null;
  });

  $: round = liveState?.round ?? data.encounter.round;
  $: status = liveState?.status ?? data.encounter.status;
  $: activeId = liveState?.activeParticipantId ?? data.encounter.activeParticipantId;
  // The poll ships maxHp per participant; the channel's ParticipantHp type
  // predates it and omits the field. Widen rather than re-declare.
  $: liveHp = (liveState?.participantHp ?? {}) as Record<string, DisplayHp>;
  $: participants = mergeDisplayParticipants(
    data.participants,
    liveState?.participants ?? null,
    liveHp
  );
  $: activeName = participants.find((p) => p.id === activeId)?.name ?? null;

  // ---- battle board (player lens, always) ---------------------------------
  //
  // Same rule as the participant list above: the poll and the board GET
  // redact for the *viewer*, and the viewer here may be the DM — so tiles
  // are re-masked and positions re-filtered against the fog client-side,
  // unconditionally. Idempotent when the payload was already player-shaped.
  type DisplayBoard = NonNullable<EncounterDisplayData['board']>;
  function playerBoard(b: DisplayBoard): DisplayBoard {
    try {
      return {
        ...b,
        tiles: maskTilesForPlayer(b.tiles, b.revealed, b.w, b.h),
        background: null,
        // A DM projecting table mode must not put their own DM-only notes on
        // the wall, and a note on a fogged cell is a tell in itself.
        annotations: visibleAnnotations(
          b.annotations,
          { w: b.w, h: b.h, revealedJson: b.revealed },
          false
        )
      };
    } catch {
      return b;
    }
  }
  let board: DisplayBoard | null = data.board ? playerBoard(data.board) : null;
  let fetchingVersion: number | null = null;
  $: liveBoardVersion =
    liveState && liveState.participants !== null
      ? liveState.boardVersion
      : data.board?.version ?? null;
  $: if (liveBoardVersion === null && board) board = null;
  $: if (
    liveBoardVersion !== null &&
    liveBoardVersion !== fetchingVersion &&
    (!board || liveBoardVersion > board.version)
  ) {
    fetchingVersion = liveBoardVersion;
    void fetch(`/api/encounters/${data.encounter.id}/board`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        // Version guard: an in-flight GET must not reinstate an older board.
        const next = b as DisplayBoard | null;
        if (next && (!board || next.version >= board.version)) board = playerBoard(next);
      })
      .catch(() => {})
      .finally(() => (fetchingVersion = null));
  }

  // ---- dungeon floors (table mode) ----------------------------------------
  //
  // Same posture as the quick board above: whatever the wire gave us (and a
  // DM's poll gives everything), the wall shows the player lens. Floors are
  // fetched lazily and re-masked client-side; the switcher lists only floors
  // with a revealed cell, and the default view follows the party.
  $: dungeon =
    liveState && liveState.participants !== null ? liveState.dungeon : data.dungeon ?? null;
  let floorCache: Record<number, DisplayBoard & { floorIdx: number }> = {};
  let fetchingFloorKey: string | null = null;
  let manualFloor: number | null = null;

  $: rawPositions =
    liveState && liveState.participants !== null
      ? liveState.positions
      : data.participantPositions ?? {};

  /** Follow the party: the floor holding the most PC tokens, else the first
   *  listed. A manual pick from the switcher wins until the party moves. */
  $: partyFloor = ((): number => {
    if (!dungeon || dungeon.floors.length === 0) return 0;
    const counts = new Map<number, number>();
    for (const p of participants) {
      if (p.kind !== 'pc') continue;
      const pos = rawPositions[p.id];
      if (!pos) continue;
      counts.set(pos.floor ?? 0, (counts.get(pos.floor ?? 0) ?? 0) + 1);
    }
    let best = dungeon.floors[0].idx;
    let bestCount = -1;
    for (const f of dungeon.floors) {
      const c = counts.get(f.idx) ?? 0;
      if (c > bestCount) {
        best = f.idx;
        bestCount = c;
      }
    }
    return best;
  })();
  $: viewedFloor =
    manualFloor !== null && dungeon?.floors.some((f) => f.idx === manualFloor)
      ? manualFloor
      : partyFloor;

  $: if (dungeon) {
    const want = dungeon.floorVersions[String(viewedFloor)];
    const have = floorCache[viewedFloor]?.version ?? -1;
    const key = `${viewedFloor}:${want}`;
    if (want !== undefined && want > have && fetchingFloorKey !== key) {
      fetchingFloorKey = key;
      void fetch(`/api/encounters/${data.encounter.id}/floors/${viewedFloor}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((f) => {
          const next = f as (DisplayBoard & { floorIdx: number }) | null;
          if (next && next.version >= (floorCache[next.floorIdx]?.version ?? -1)) {
            floorCache = {
              ...floorCache,
              [next.floorIdx]: { ...playerBoard(next), floorIdx: next.floorIdx }
            };
          }
        })
        .catch(() => {})
        .finally(() => (fetchingFloorKey = null));
    }
  }

  /** Floors fit for the wall: any revealed cell. Recomputed from fetched
   *  masks so a DM's all-floors list never leaks unentered levels. */
  $: wallFloors = (dungeon?.floors ?? []).filter((f) => {
    const cached = floorCache[f.idx];
    if (!cached) return f.idx === viewedFloor; // let the current fetch settle
    try {
      return Array.from(decodeRuns(cached.revealed, cached.w * cached.h)).some((b) => b === 1);
    } catch {
      return false;
    }
  });

  $: surface = dungeon ? floorCache[viewedFloor] ?? null : board;

  $: boardTokens = ((): BoardToken[] => {
    const board = surface;
    if (!board) return [];
    // First-poll guard: the channel store exists (empty) synchronously, so
    // fall back to the SSR seed until a poll has actually landed.
    const raw = rawPositions;
    const visible = visibleTokenPositions(
      Object.entries(raw)
        .filter(([, p]) => (dungeon ? (p.floor ?? 0) === viewedFloor : true))
        .map(([id, p]) => ({ id, posX: p.x, posY: p.y, sizeCells: p.sizeCells })),
      { w: board.w, h: board.h, revealedJson: board.revealed },
      false
    );
    return participants
      .filter((p) => visible[p.id])
      .map((p) => {
        const pos = visible[p.id];
        const parts = p.name.trim().split(/\s+/);
        return {
          id: p.id,
          x: pos.x,
          y: pos.y,
          sizeCells: pos.sizeCells,
          label: ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase(),
          title: p.name,
          color: p.kind === 'pc' ? '#065f46' : '#7f1d1d',
          ring: null,
          active: p.id === activeId
        };
      });
  })();
</script>

<svelte:head>
  <title>{data.encounter.name} — table mode</title>
</svelte:head>

<section data-testid="display-view" class="flex min-h-[70vh] flex-col">
  <header class="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-4">
    <div class="min-w-0">
      <p class="text-xs uppercase tracking-[0.2em] text-slate-500">{data.campaign.name}</p>
      <h1 class="truncate text-3xl font-semibold tracking-tight sm:text-5xl">
        {data.encounter.name}
      </h1>
    </div>
    <div class="text-right">
      {#if status === 'ended'}
        <p class="text-2xl font-semibold uppercase tracking-wide text-slate-500 sm:text-3xl">
          Ended
        </p>
      {:else}
        <p class="text-[10px] uppercase tracking-[0.2em] text-slate-500">Round</p>
        <p class="font-mono text-4xl font-semibold text-emerald-300 sm:text-6xl" data-testid="display-round">
          {round}
        </p>
      {/if}
    </div>
  </header>

  {#if activeName}
    <p class="mb-4 text-lg text-slate-400 sm:text-2xl" data-testid="display-turn">
      <span class="text-emerald-400">▶</span>
      <span class="font-semibold text-slate-100">{activeName}</span>'s turn
    </p>
  {/if}

  {#if dungeon && wallFloors.length > 1}
    <div class="mb-2 flex items-center gap-2 text-sm" data-testid="display-floors">
      {#each wallFloors as f (f.idx)}
        <button
          class="rounded border px-3 py-1 {f.idx === viewedFloor
            ? 'border-violet-500 text-violet-100'
            : 'border-slate-700 text-slate-400'}"
          on:click={() => (manualFloor = f.idx)}
        >
          {f.name}
        </button>
      {/each}
    </div>
  {/if}
  {#if surface}
    <div class="mb-6" data-testid="display-board">
      <BoardCanvas
        w={surface.w}
        h={surface.h}
        tiles={surface.tiles}
        revealed={surface.revealed}
        fogStyle="player"
        tokens={boardTokens}
        annotations={surface.annotations ?? {}}
        interactive={false}
        maxCellPx={44}
      />
    </div>
  {/if}

  {#if participants.length === 0}
    <p class="rounded border border-dashed border-slate-800 p-8 text-center text-xl text-slate-500">
      No one in the initiative order yet.
    </p>
  {:else}
    <ol class="flex-1 divide-y divide-slate-800/80" data-testid="display-order">
      {#each participants as p (p.id)}
        <li
          class="flex items-center gap-4 py-3 sm:gap-6 sm:py-4 {p.id === activeId
            ? 'rounded-l border-l-4 border-emerald-500 bg-emerald-950/25 pl-3'
            : 'pl-4'}"
        >
          <span class="w-10 shrink-0 text-center font-mono text-2xl text-slate-500 sm:w-14 sm:text-4xl">
            {p.initiative ?? '—'}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-2xl font-medium sm:text-4xl">{p.name}</span>
            {#if p.conditions.length > 0}
              <span class="mt-1 flex flex-wrap gap-1.5">
                {#each p.conditions as c (c)}
                  <span
                    class="rounded border border-amber-800/70 bg-amber-950/40 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-300 sm:text-sm"
                  >{c}</span>
                {/each}
              </span>
            {/if}
          </span>
          {#if showsExactHp(p)}
            <span class="shrink-0 font-mono text-xl text-slate-300 sm:text-3xl" data-testid="display-hp">
              {p.currentHp ?? '—'}<span class="text-slate-600">/{p.maxHp}</span>{#if p.tempHp > 0}<span
                  class="text-emerald-300"
                > +{p.tempHp}</span>{/if}
            </span>
          {:else}
            <span class="shrink-0">
              <!-- The band comes from the server: an unrevealed row's exact
                   HP never reaches this screen to be bucketed here. -->
              <HpBucketBadge
                value={(p.hpBucket as HpBucket | null) ?? hpBucket(p.currentHp, p.maxHp)}
                size="lg"
              />
            </span>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  <footer class="mt-8 flex items-center justify-between text-[11px] text-slate-600">
    <a class="hover:text-slate-400" href={encounterHref}>← back to the encounter</a>
    <span>
      {connStatus === 'open' ? 'live' : connStatus === 'connecting' ? 'reconnecting…' : 'paused'}
    </span>
  </footer>
</section>
