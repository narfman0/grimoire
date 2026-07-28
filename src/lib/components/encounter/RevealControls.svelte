<script lang="ts">
  // Per-participant reveal toggles (DM only, non-PC — the parent gates on
  // both). Stateless: the parent PATCHes the flag server-side and re-runs the
  // page load so the redacted player projection stays consistent.
  import { createEventDispatcher } from 'svelte';
  import RevealChip from '$lib/components/RevealChip.svelte';

  type Reveals = {
    identity: boolean;
    vitals: boolean;
    combat: boolean;
    hidden: boolean;
  };

  export let reveals: Reveals;
  export let busy = false;

  const dispatch = createEventDispatcher<{
    toggle: Record<string, boolean>;
    revealAll: void;
    hideAll: void;
  }>();
</script>

<div class="mb-3">
  <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Reveals</div>
  <div class="flex flex-wrap items-center gap-1 text-[11px]">
    <RevealChip label="identity" on={reveals.identity} on:toggle={(e) => dispatch('toggle', { identity: e.detail })} disabled={busy} />
    <RevealChip label="vitals" on={reveals.vitals} on:toggle={(e) => dispatch('toggle', { vitals: e.detail })} disabled={busy} />
    <RevealChip label="combat" on={reveals.combat} on:toggle={(e) => dispatch('toggle', { combat: e.detail })} disabled={busy} />
    <RevealChip label="hidden" tone="danger" on={reveals.hidden} on:toggle={(e) => dispatch('toggle', { hidden: e.detail })} disabled={busy} />
    <button class="ml-2 text-slate-500 hover:text-emerald-300 underline-offset-2 hover:underline text-[11px]" on:click={() => dispatch('revealAll')} disabled={busy}>reveal all</button>
    <button class="text-slate-500 hover:text-slate-300 underline-offset-2 hover:underline text-[11px]" on:click={() => dispatch('hideAll')} disabled={busy}>hide all</button>
  </div>
</div>
