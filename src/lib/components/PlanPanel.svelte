<script context="module" lang="ts">
  /** Per-turn used flags + movement/slot/free-text fields surfaced by the
   *  encounter +plan foldout. Client-only state for v1 — not persisted
   *  across reloads. The encounter page owns the Record<participantId,
   *  EconomyState> map and feeds one entry into the panel per render. */
  export interface EconomyState {
    movement: number;
    freeActions: string;
    slotLevel: number;
    actionUsed: boolean;
    bonusUsed: boolean;
    reactionUsed: boolean;
  }
</script>

<script lang="ts">
  // The +plan foldout that hangs off each participant row on the encounter
  // page. Controlled component: the parent owns `plan` (broadcast through
  // the SSE channel), `economy` (per-row client state), and reacts to every
  // dispatched change. Wraps ActionEconomyPanel and adds the DM-only
  // resolve/clear buttons, the cast-at-slot picker for spell actions, and
  // the free-actions text field.
  import { createEventDispatcher } from 'svelte';
  import ActionEconomyPanel from './ActionEconomyPanel.svelte';
  import type { TurnPlan } from '$lib/realtime/encounter-channel';

  type Choice = {
    id: string;
    name: string;
    isFavorite?: boolean;
    targetMode?: 'self' | 'single' | 'multi';
    targetCount?: number;
    /** Legality bits computed by the parent (see
     *  $lib/encounter/action-availability) — greys the pick out. */
    unavailable?: boolean;
    unavailableReason?: string | null;
    resourceNote?: string;
  };
  type Participant = { id: string; name: string; kind?: string };

  export let participant: Participant;
  export let plan: TurnPlan | null;
  export let role: 'dm' | 'player';
  export let participants: Participant[];
  export let actionChoices: Choice[];
  export let bonusChoices: Choice[];
  export let walkSpeed: number;
  export let busy = false;
  export let economy: EconomyState;
  /** True when the currently-picked action is a known spell; reveals the
   *  cast-at-slot dropdown. Owned by the parent because it depends on the
   *  participant's spell list. */
  export let showSlotLevel = false;

  const dispatch = createEventDispatcher<{
    actionPick: string;
    bonusPick: string;
    targetPick: string[];
    bonusTargetPick: string[];
    toggleActionUsed: void;
    toggleBonusUsed: void;
    toggleReactionUsed: void;
    movementDelta: number;
    movementReset: void;
    slotLevelChange: number;
    freeActionsChange: string;
    resolve: void;
    clear: void;
  }>();

  $: hasPlan = !!plan && !!(plan.actionLabel || plan.bonusActionLabel);
</script>

<div class="basis-full bg-slate-900/60 border-t border-slate-800 px-4 py-3 mt-1 rounded-b">
  <div class="mb-2 flex items-center gap-2">
    <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Plan</div>
    {#if role === 'dm' && hasPlan}
      <button
        class="rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-900/40"
        on:click={() => dispatch('resolve')}
      >
        resolve
      </button>
      <button
        class="text-[10px] text-slate-500 hover:text-red-400"
        on:click={() => dispatch('clear')}
      >
        clear
      </button>
    {/if}
  </div>
  <ActionEconomyPanel
    mode="observer"
    {busy}
    {actionChoices}
    {bonusChoices}
    plannedActionId={plan?.actionId ?? ''}
    plannedBonusActionId={plan?.bonusActionId ?? ''}
    actionUsed={economy.actionUsed}
    bonusUsed={economy.bonusUsed}
    reactionUsed={economy.reactionUsed}
    {walkSpeed}
    movementUsed={economy.movement}
    showConcentration={false}
    {participants}
    selfId={participant.id}
    plannedTargetIds={plan?.targetParticipantIds ?? []}
    plannedBonusTargetIds={plan?.bonusTargetParticipantIds ?? []}
    on:actionPick={(e) => dispatch('actionPick', e.detail)}
    on:bonusPick={(e) => dispatch('bonusPick', e.detail)}
    on:targetPick={(e) => dispatch('targetPick', e.detail)}
    on:bonusTargetPick={(e) => dispatch('bonusTargetPick', e.detail)}
    on:toggleActionUsed={() => dispatch('toggleActionUsed')}
    on:toggleBonusUsed={() => dispatch('toggleBonusUsed')}
    on:toggleReactionUsed={() => dispatch('toggleReactionUsed')}
    on:movementDelta={(e) => dispatch('movementDelta', e.detail)}
    on:movementReset={() => dispatch('movementReset')}
  />
  {#if showSlotLevel}
    <div class="mt-2 flex items-center gap-1.5 text-xs">
      <span class="text-[10px] text-slate-500">Cast at slot:</span>
      <select
        class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[10px]"
        value={economy.slotLevel}
        on:change={(e) => dispatch('slotLevelChange', Number(e.currentTarget.value))}
      >
        {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as lvl}
          <option value={lvl}>L{lvl}</option>
        {/each}
      </select>
    </div>
  {/if}
  <div class="mt-2 flex items-center gap-2 text-xs">
    <span class="text-slate-500 whitespace-nowrap">Free Actions:</span>
    <input
      class="flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] placeholder-slate-600"
      placeholder="object interaction, communicate, etc."
      value={economy.freeActions}
      on:input={(e) => dispatch('freeActionsChange', e.currentTarget.value)}
    />
  </div>
</div>
