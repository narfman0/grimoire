<script lang="ts">
  // One row in the encounter participant list. Controlled: parent owns
  // selection state, initiative-edit state, hpInput, and dispatches every
  // mutating action through events.
  import { createEventDispatcher } from 'svelte';
  import HpBucketBadge from './HpBucketBadge.svelte';
  import { hpBucket as computeHpBucket, type HpBucket } from '$lib/realtime/reveals';

  type Participant = {
    id: string;
    name: string;
    placeholderName?: string | null;
    kind: string;
    initiative: number | null;
    currentHp: number | null;
    tempHp: number;
    maxHp: number | null;
    hpBucket?: string | null;
    reveals?: { vitals?: boolean | null; identity?: boolean | null; combat?: boolean | null; hidden?: boolean | null } | null;
  };

  export let p: Participant;
  export let role: 'dm' | 'player';
  export let isActive: boolean;
  export let isSelected: boolean;
  export let activeConds: string[];
  /** Display-only labels for receivedBuffs active on a PC participant.
   *  Buff *effects* are already rolled into the participant's stats by
   *  derive() upstream; this is purely so the DM (and player) can see
   *  the source — "Shield of Faith from Cleric Vortha". */
  export let receivedBuffLabels: string[] = [];
  /** Display label for concentration (or null if none); already resolved
   *  upstream from either the PC document or the SSE concentration field. */
  export let concLabel: string | null;
  export let liveCurrentHp: number | null | undefined;
  export let liveTempHp: number | undefined;
  export let editingInitiative: boolean;
  export let busy: boolean;
  /** DM-only manual reorder. The parent owns the list and computes the
   *  initiative/sortOrder writes; this row only reports the gesture. The
   *  ▲/▼ buttons are not a fallback — they are the keyboard-reachable path,
   *  since HTML5 drag-and-drop has none. */
  export let reorderable = false;
  /** True while a dragged row is hovering over this one. */
  export let dropTarget = false;
  export let canMoveUp = false;
  export let canMoveDown = false;

  const dispatch = createEventDispatcher<{
    select: void;
    startEditInitiative: void;
    commitInitiative: number | null;
    cancelEditInitiative: void;
    remove: void;
    dragStart: void;
    dragEnter: void;
    dragEnd: void;
    drop: void;
    move: -1 | 1;
  }>();

  function inputValue(e: Event): string {
    return (e.currentTarget as HTMLInputElement).value;
  }

  function bucketFor(current: number | null | undefined, max: number | null, fallback: HpBucket | string | null | undefined): HpBucket {
    const computed = computeHpBucket(current ?? null, max ?? null);
    if (computed !== 'unknown') return computed;
    return (fallback as HpBucket | null | undefined) ?? 'unknown';
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
<li
  class="flex flex-wrap items-center gap-3 py-2 px-2 text-sm cursor-pointer select-none rounded
    {isActive ? 'bg-emerald-950/30' : isSelected ? 'bg-slate-800/50' : ''}
    {dropTarget ? 'outline outline-1 outline-emerald-500' : ''}
    hover:bg-slate-800/30"
  draggable={reorderable}
  on:click={() => dispatch('select')}
  on:dragstart={() => dispatch('dragStart')}
  on:dragenter={() => dispatch('dragEnter')}
  on:dragover|preventDefault
  on:dragend={() => dispatch('dragEnd')}
  on:drop|preventDefault={() => dispatch('drop')}
>
  {#if reorderable}
    <span class="flex flex-col leading-none" title="Reorder initiative">
      <button
        class="text-[9px] text-slate-600 hover:text-emerald-300 disabled:opacity-30"
        aria-label="Move {p.placeholderName ?? p.name} up"
        disabled={busy || !canMoveUp}
        on:click|stopPropagation={() => dispatch('move', -1)}
      >▲</button>
      <button
        class="text-[9px] text-slate-600 hover:text-emerald-300 disabled:opacity-30"
        aria-label="Move {p.placeholderName ?? p.name} down"
        disabled={busy || !canMoveDown}
        on:click|stopPropagation={() => dispatch('move', 1)}
      >▼</button>
    </span>
  {/if}
  {#if role === 'dm'}
    {#if editingInitiative || p.initiative == null}
      <!-- svelte-ignore a11y-autofocus -->
      <input
        type="number"
        class="w-12 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-xs"
        placeholder="init"
        value={p.initiative ?? ''}
        autofocus={editingInitiative}
        on:click|stopPropagation
        on:blur={(e) => {
          const v = inputValue(e);
          dispatch('commitInitiative', v === '' ? null : Number(v));
        }}
        on:keydown={(e) => {
          if (e.key === 'Enter') {
            const v = inputValue(e);
            dispatch('commitInitiative', v === '' ? null : Number(v));
          } else if (e.key === 'Escape') {
            dispatch('cancelEditInitiative');
          }
        }}
      />
    {:else}
      <span class="inline-flex items-center gap-0.5 w-12 font-mono text-xs text-slate-400">
        <span>{p.initiative}</span>
        <button
          class="text-[10px] text-slate-600 hover:text-slate-300"
          title="Edit initiative"
          on:click|stopPropagation={() => dispatch('startEditInitiative')}
        >✎</button>
      </span>
    {/if}
  {:else}
    <span class="font-mono text-xs text-slate-500 w-8">
      {p.initiative ?? '—'}
    </span>
  {/if}
  <span class="flex-1 font-medium">
    {p.placeholderName ?? p.name}
    {#if concLabel !== null}
      <span class="ml-1 rounded border border-violet-700 px-1 py-0.5 text-[10px] text-violet-300">🌀</span>
    {/if}
    {#if activeConds.length > 0}
      <span class="ml-1 text-[10px] text-amber-400">{activeConds.join(', ')}</span>
    {/if}
    {#if receivedBuffLabels.length > 0}
      <span
        class="ml-1 text-[10px] text-emerald-300"
        title="Received buffs (effects already applied to stats)"
      >
        +{receivedBuffLabels.join(', ')}
      </span>
    {/if}
  </span>
  {#if role === 'dm' || p.reveals?.vitals || p.kind === 'pc'}
    {#if p.maxHp != null}
      {@const liveCur = liveCurrentHp ?? p.currentHp}
      {@const liveTemp = liveTempHp ?? p.tempHp ?? 0}
      <span class="font-mono text-xs text-slate-400">
        {liveCur ?? '—'} / {p.maxHp}{#if liveTemp > 0}<span class="text-emerald-300"> +{liveTemp}</span>{/if}
      </span>
    {/if}
  {:else}
    <HpBucketBadge value={bucketFor(liveCurrentHp, p.maxHp, p.hpBucket)} />
  {/if}
  {#if role === 'dm'}
    <button
      class="ml-auto rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-400 hover:border-red-700 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
      title={p.kind === 'pc' ? 'Remove this PC from the encounter' : `Remove ${p.kind} from encounter`}
      on:click|stopPropagation={() => dispatch('remove')}
      disabled={busy}
    >✕</button>
  {/if}
</li>
