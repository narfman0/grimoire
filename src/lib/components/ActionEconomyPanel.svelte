<script lang="ts">
  // Shared action-economy UI used on the player-detail page (mode="self",
  // the player editing their own character) and on the encounter page's
  // per-participant fold-down (mode="observer", the DM viewing or managing
  // a participant). Stateless: the parent owns plan / used-flags / movement
  // state and re-feeds them as props; the panel dispatches events on every
  // interaction. `readonly` greys out the controls without hiding them so
  // the DM can still see player intent on a PC row.
  import { createEventDispatcher } from 'svelte';

  type Choice = {
    id: string;
    name: string;
    isFavorite?: boolean;
    targetMode?: 'self' | 'single' | 'multi';
    targetCount?: number;
    description?: string;
    /** Set by the encounter planner: the pick can't be taken right now
     *  (slot already spent, pool drained). Rendered greyed + disabled. */
    unavailable?: boolean;
    /** Short why ("no action left", "out of uses", "not enough charges").
     *  Shown in the option label — `<option>` has no tooltip affordance. */
    unavailableReason?: string | null;
    /** "— 2/3 Ki left" style annotation appended to the option label. */
    resourceNote?: string;
  };
  type Participant = { id: string; name: string; kind?: string };

  export let mode: 'self' | 'observer' = 'self';
  export let readonly = false;
  export let busy = false;
  export let actionChoices: Choice[] = [];
  export let bonusChoices: Choice[] = [];
  export let plannedActionId = '';
  export let plannedBonusActionId = '';
  export let actionUsed = false;
  export let bonusUsed = false;
  export let reactionUsed = false;
  export let walkSpeed = 30;
  export let movementUsed = 0;
  export let concentrating: { label: string; sinceRound?: number } | null = null;
  export let showConcentration = true;
  /** Encounter participants offered as target picks. Self is included so
   *  self-targeting picks (heals, buffs, AoE that includes the caster) work;
   *  `selfId` only labels the row to disambiguate. Empty list hides the
   *  picker. */
  export let participants: Participant[] = [];
  export let selfId: string | null = null;
  export let plannedTargetIds: string[] = [];
  export let plannedBonusTargetIds: string[] = [];

  const dispatch = createEventDispatcher<{
    actionPick: string;
    bonusPick: string;
    toggleActionUsed: void;
    toggleBonusUsed: void;
    toggleReactionUsed: void;
    movementDelta: number;
    movementReset: void;
    concentrationStart: string;
    concentrationEnd: void;
    targetPick: string[];
    bonusTargetPick: string[];
  }>();

  // Self stays in the list so the DM (or a player) can target themselves —
  // e.g. healing, self-buff, AoE that includes the caster. It's rendered with
  // a "(self)" suffix so it's still distinguishable from other participants.
  $: pickableTargets = participants;
  $: plannedAction = actionChoices.find((c) => c.id === plannedActionId) ?? null;
  $: plannedBonus = bonusChoices.find((c) => c.id === plannedBonusActionId) ?? null;

  function toggleTarget(ids: string[], id: string): string[] {
    return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }

  let concDraft = '';

  $: movementRemaining = Math.max(0, walkSpeed - movementUsed);
  $: locked = busy || readonly;
</script>

<div class="text-xs">
  <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
    <!-- Action card -->
    <div class="rounded border border-slate-700 bg-slate-950 p-2 text-xs">
      <div class="mb-1.5 text-[10px] text-slate-500">⚔ Action</div>
      <select
        class="mb-1.5 w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] disabled:opacity-60"
        value={plannedActionId}
        on:change={(e) => dispatch('actionPick', (e.currentTarget).value)}
        disabled={locked || actionChoices.length === 0}
      >
        <option value="">{actionChoices.length === 0 ? '— none available —' : '— pick action —'}</option>
        {#each actionChoices as a}
          <option
            value={a.id}
            disabled={a.unavailable === true}
            class={a.unavailable ? 'text-slate-600' : ''}
            data-unavailable={a.unavailable ? 'true' : undefined}
          >{a.name}{a.isFavorite ? ' ★' : ''}{a.resourceNote ?? ''}{a.unavailable && a.unavailableReason ? ` — ${a.unavailableReason}` : ''}</option>
        {/each}
      </select>
      {#if plannedAction?.description}
        <p class="mb-1.5 text-[10px] leading-relaxed text-slate-400">{plannedAction.description}</p>
      {/if}
      {#if plannedAction && pickableTargets.length > 0}
        <div class="mb-1.5 flex flex-wrap gap-1">
          {#each pickableTargets as p}
            {@const on = plannedTargetIds.includes(p.id)}
            <button
              class="rounded border px-1.5 py-0.5 text-[10px] {on
                ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200'
                : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}"
              disabled={locked}
              on:click={() => dispatch('targetPick', toggleTarget(plannedTargetIds, p.id))}
            >
              {p.name}{p.id === selfId ? ' (self)' : ''}
            </button>
          {/each}
        </div>
      {/if}
      <button
        class="w-full rounded border px-2 py-1 text-xs font-medium transition-colors {actionUsed
          ? 'border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300'
          : 'border-emerald-700 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40'}"
        disabled={locked}
        on:click={() => dispatch('toggleActionUsed')}
      >
        {actionUsed ? 'mark unused' : 'mark used'}
      </button>
    </div>
    <!-- Bonus action card -->
    <div class="rounded border border-slate-700 bg-slate-950 p-2 text-xs">
      <div class="mb-1.5 text-[10px] text-slate-500">✦ Bonus Action</div>
      <select
        class="mb-1.5 w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] disabled:opacity-60"
        value={plannedBonusActionId}
        on:change={(e) => dispatch('bonusPick', (e.currentTarget).value)}
        disabled={locked || bonusChoices.length === 0}
      >
        <option value="">{bonusChoices.length === 0 ? '— none available —' : '— pick bonus —'}</option>
        {#each bonusChoices as a}
          <option
            value={a.id}
            disabled={a.unavailable === true}
            class={a.unavailable ? 'text-slate-600' : ''}
            data-unavailable={a.unavailable ? 'true' : undefined}
          >{a.name}{a.isFavorite ? ' ★' : ''}{a.resourceNote ?? ''}{a.unavailable && a.unavailableReason ? ` — ${a.unavailableReason}` : ''}</option>
        {/each}
      </select>
      {#if plannedBonus?.description}
        <p class="mb-1.5 text-[10px] leading-relaxed text-slate-400">{plannedBonus.description}</p>
      {/if}
      {#if plannedBonus && pickableTargets.length > 0}
        <div class="mb-1.5 flex flex-wrap gap-1">
          {#each pickableTargets as p}
            {@const on = plannedBonusTargetIds.includes(p.id)}
            <button
              class="rounded border px-1.5 py-0.5 text-[10px] {on
                ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200'
                : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}"
              disabled={locked}
              on:click={() => dispatch('bonusTargetPick', toggleTarget(plannedBonusTargetIds, p.id))}
            >
              {p.name}{p.id === selfId ? ' (self)' : ''}
            </button>
          {/each}
        </div>
      {/if}
      <button
        class="w-full rounded border px-2 py-1 text-xs font-medium transition-colors {bonusUsed
          ? 'border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300'
          : 'border-emerald-700 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40'}"
        disabled={locked}
        on:click={() => dispatch('toggleBonusUsed')}
      >
        {bonusUsed ? 'mark unused' : 'mark used'}
      </button>
    </div>
    <!-- Movement card -->
    <div class="rounded border border-slate-700 bg-slate-950 p-2 text-xs">
      <div class="mb-1.5 text-[10px] text-slate-500">💨 Movement</div>
      <div class="flex items-center gap-1 flex-wrap">
        <span class="font-mono {movementRemaining === 0 ? 'text-slate-500' : 'text-emerald-200'}">{movementRemaining}/{walkSpeed} ft</span>
        <button
          class="rounded border border-slate-700 px-1 text-[10px] hover:bg-slate-800 disabled:opacity-40"
          disabled={locked || movementRemaining === 0}
          on:click={() => dispatch('movementDelta', 5)}
        >−5</button>
        <button
          class="rounded border border-slate-700 px-1 text-[10px] hover:bg-slate-800 disabled:opacity-40"
          disabled={locked || movementUsed === 0}
          on:click={() => dispatch('movementDelta', -5)}
        >+5</button>
        <button
          class="rounded border border-slate-700 px-1 text-[10px] hover:bg-slate-800 disabled:opacity-40"
          disabled={locked || movementUsed === 0}
          on:click={() => dispatch('movementReset')}
        >↺</button>
      </div>
    </div>
    <!-- Reaction card -->
    <div class="rounded border border-slate-700 bg-slate-950 p-2 text-xs">
      <div class="mb-1.5 text-[10px] text-slate-500">↩ Reaction</div>
      <button
        class="w-full rounded border px-2 py-1 text-xs font-medium transition-colors {reactionUsed
          ? 'border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300'
          : 'border-emerald-700 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40'}"
        disabled={locked}
        on:click={() => dispatch('toggleReactionUsed')}
      >
        {reactionUsed ? 'mark unused' : 'mark used'}
      </button>
    </div>
  </div>
  {#if showConcentration}
    <div class="mt-2">
      {#if concentrating}
        <div class="flex items-center gap-2 rounded border border-indigo-700 bg-indigo-950/40 px-2 py-1 text-xs text-indigo-200">
          <span>🌀 Concentrating:</span>
          <span class="font-semibold">{concentrating.label}</span>
          {#if concentrating.sinceRound != null}
            <span class="text-indigo-400/70">(since R{concentrating.sinceRound})</span>
          {/if}
          <button
            class="ml-1 rounded border border-indigo-700 px-1.5 py-0 text-[10px] hover:bg-indigo-900/40 disabled:opacity-40"
            disabled={locked}
            on:click={() => dispatch('concentrationEnd')}
          >drop</button>
        </div>
      {:else if mode === 'self' && !readonly}
        <div class="flex items-center gap-1">
          <span class="text-xs text-slate-500">🌀 Concentrate on</span>
          <input
            class="w-44 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
            placeholder="bless, hex, hold person…"
            maxlength="80"
            bind:value={concDraft}
            on:keydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const label = concDraft.trim();
                if (label) {
                  dispatch('concentrationStart', label);
                  concDraft = '';
                }
              }
            }}
          />
          <button
            class="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40"
            disabled={busy || concDraft.trim() === ''}
            on:click={() => {
              const label = concDraft.trim();
              if (label) {
                dispatch('concentrationStart', label);
                concDraft = '';
              }
            }}
          >start</button>
        </div>
      {/if}
    </div>
  {/if}
</div>
