<script lang="ts">
  // Table-view quick damage / heal. Relative amounts only — the server
  // computes the result, so this works on an enemy whose exact HP the table
  // isn't shown. Touch-sized for a tablet.
  import { createEventDispatcher } from 'svelte';

  export let label: string;
  export let busy = false;

  let amount: number | undefined;
  const dispatch = createEventDispatcher<{ apply: { mode: 'damage' | 'heal'; amount: number } }>();

  function apply(mode: 'damage' | 'heal') {
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n <= 0) return;
    dispatch('apply', { mode, amount: n });
    amount = undefined;
  }
</script>

<div class="mt-2 flex items-center gap-1.5" data-testid="quick-hp">
  <input
    type="number"
    inputmode="numeric"
    min="1"
    class="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-center font-mono text-sm"
    placeholder="±hp"
    aria-label="HP amount for {label}"
    bind:value={amount}
    on:keydown={(e) => e.key === 'Enter' && apply('damage')}
  />
  <button
    class="rounded bg-red-700/70 px-3 py-1 text-sm hover:bg-red-700 disabled:opacity-40"
    disabled={busy}
    aria-label="Damage {label}"
    on:click={() => apply('damage')}
  >− dmg</button>
  <button
    class="rounded bg-emerald-700/70 px-3 py-1 text-sm hover:bg-emerald-700 disabled:opacity-40"
    disabled={busy}
    aria-label="Heal {label}"
    on:click={() => apply('heal')}
  >+ heal</button>
</div>
