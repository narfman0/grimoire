<script lang="ts">
  // Exact-HP bar for rows a player may see numbers for. Rows without exact
  // vitals render HpBucketBadge instead — the parent decides.
  export let current: number | null;
  export let max: number | null;
  export let temp = 0;
  /** 'lg' = table view scale. */
  export let size: 'sm' | 'lg' = 'sm';

  $: pct = current != null && max ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  $: tone =
    current == null || !max
      ? 'bg-slate-600'
      : current <= 0
        ? 'bg-slate-600'
        : pct <= 25
          ? 'bg-red-500'
          : pct <= 50
            ? 'bg-orange-500'
            : pct < 100
              ? 'bg-yellow-500'
              : 'bg-emerald-500';
</script>

<div class="w-full">
  <div class="flex items-baseline justify-between font-mono {size === 'lg' ? 'text-lg' : 'text-xs'}">
    <span class="text-slate-100">
      {current ?? '—'}<span class="text-slate-500">/{max ?? '—'}</span>
    </span>
    {#if temp > 0}
      <span class="text-sky-300" title="Temporary HP">+{temp} temp</span>
    {/if}
  </div>
  <div
    class="mt-0.5 overflow-hidden rounded bg-slate-800 {size === 'lg' ? 'h-3' : 'h-1.5'}"
    role="meter"
    aria-label="Hit points"
    aria-valuemin={0}
    aria-valuemax={max ?? 0}
    aria-valuenow={current ?? 0}
  >
    <div class="h-full {tone} transition-all" style="width: {pct}%"></div>
  </div>
</div>
