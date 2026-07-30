<script lang="ts">
  // End-of-turn legendary-action prompt: a PC's turn just ended and a
  // legendary creature has budget left. DM-only — the parent gates on role,
  // owns the queue (one entry per creature per triggering turn), renders its
  // head here, and shifts it on any choice. RAW allows one legendary action
  // per trigger moment, so using an action also shifts the queue.
  import { createEventDispatcher } from 'svelte';

  type LegendaryPromptAction = {
    name: string;
    cost: number;
    affordable: boolean;
  };

  export let participantName: string;
  export let actions: LegendaryPromptAction[] = [];
  /** Legendary actions left this round. */
  export let remaining = 0;
  export let budget = 3;
  /** How many further prompts are queued behind this one. */
  export let queuedBehind = 0;

  const dispatch = createEventDispatcher<{ use: LegendaryPromptAction; skip: void }>();
</script>

<div
  class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-violet-700 bg-violet-950/40 px-4 py-3 text-sm"
  data-testid="legendary-prompt"
>
  <span class="text-violet-200">
    ★ <strong>{participantName}</strong> — {remaining}/{budget} legendary
    action{budget === 1 ? '' : 's'} left. Use one?
  </span>
  {#each actions as action}
    <button
      class="rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900/70 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-transparent disabled:text-slate-500"
      disabled={!action.affordable}
      title={action.affordable ? undefined : `Needs ${action.cost} actions`}
      on:click={() => dispatch('use', action)}
    >
      {action.name}{action.cost > 1 ? ` (${action.cost})` : ''}
    </button>
  {/each}
  <button
    class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
    on:click={() => dispatch('skip')}
  >
    Skip
  </button>
  {#if queuedBehind > 0}
    <span class="text-xs text-violet-200/70">+{queuedBehind} more</span>
  {/if}
</div>
