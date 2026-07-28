<script lang="ts">
  // Concentration display + start/clear control (DM only — the parent gates
  // on role). The parent resolves the label upstream (PC document vs poll
  // snapshot) and owns both mutation paths. The draft resets when the
  // selected participant changes, because the detail panel is not keyed and
  // this component survives a selection switch.
  import { createEventDispatcher } from 'svelte';

  /** null when not concentrating; '' means concentrating with no label. */
  export let label: string | null;
  /** Only used to reset the draft when the selection moves. */
  export let participantId: string;
  export let busy = false;

  const dispatch = createEventDispatcher<{ start: string; clear: void }>();

  let draft = '';
  $: if (participantId) draft = '';

  function start() {
    const clean = draft.trim();
    if (clean) {
      dispatch('start', clean);
      draft = '';
    }
  }
</script>

<div class="mb-3">
  <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Concentration</div>
  {#if label !== null}
    <span class="inline-flex items-center gap-1 rounded border border-violet-600 bg-violet-900/40 px-2 py-0.5 text-[11px] text-violet-200">
      🌀 {label || 'concentrating'}
      <button class="text-violet-300 hover:text-violet-100" on:click={() => dispatch('clear')}>×</button>
    </span>
  {:else}
    <div class="flex items-center gap-1">
      <input
        class="w-44 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
        placeholder="bless, hex, hold person…"
        maxlength="80"
        bind:value={draft}
        on:keydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            start();
          }
        }}
      />
      <button
        class="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        disabled={busy || !draft.trim()}
        on:click={start}
      >start</button>
    </div>
  {/if}
</div>
