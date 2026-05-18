<script lang="ts">
  // Tiny toggle chip for the DM's reveal controls on an encounter participant.
  // Green when on, slate when off; danger tone uses red. Emits `toggle` with
  // the new boolean state — parent dispatches the PATCH.
  import { createEventDispatcher } from 'svelte';

  export let on = false;
  export let label = '';
  export let tone: 'normal' | 'danger' = 'normal';
  export let disabled = false;

  const dispatch = createEventDispatcher<{ toggle: boolean }>();

  $: classes = (() => {
    if (on && tone === 'danger') return 'border-red-700 bg-red-950/60 text-red-200';
    if (on) return 'border-emerald-700 bg-emerald-900/40 text-emerald-200';
    return 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500';
  })();
</script>

<button
  type="button"
  class="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide disabled:opacity-40 {classes}"
  on:click={() => dispatch('toggle', !on)}
  {disabled}
>{label}</button>
