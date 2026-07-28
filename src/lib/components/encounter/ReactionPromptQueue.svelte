<script lang="ts">
  // Queue of PC reaction triggers that fired from the last resolved action.
  // Shown one at a time (same slot as the concentration callout) so the DM can
  // confirm or skip each. DM-only — the parent gates on role and owns the
  // queue; this component renders the head and dispatches the choice.
  import { createEventDispatcher } from 'svelte';
  import { grantSummary } from '$lib/rules/grant-summary';

  type ReactionPrompt = {
    participantId: string;
    participantName: string;
    triggerId: string;
    triggerName: string;
    grants?: { type: string; [k: string]: unknown };
  };

  export let prompts: ReactionPrompt[] = [];

  const dispatch = createEventDispatcher<{ use: ReactionPrompt; skip: void }>();
</script>

{#if prompts.length > 0}
  {@const prompt = prompts[0]}
  <div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-600 bg-amber-950/40 px-4 py-3 text-sm">
    <span class="text-amber-200">
      ⚡ <strong>{prompt.participantName}</strong> can use <strong>{prompt.triggerName}</strong> — use their reaction?
      {#if grantSummary(prompt.grants)}
        <span class="mt-0.5 block text-xs text-amber-200/80">{grantSummary(prompt.grants)}</span>
      {/if}
    </span>
    <button
      class="rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900/70"
      on:click={() => dispatch('use', prompt)}
    >
      Use reaction
    </button>
    <button
      class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
      on:click={() => dispatch('skip')}
    >
      Skip
    </button>
  </div>
{/if}
