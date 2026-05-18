<script lang="ts">
  // Coarse HP indicator shown to players whose `vitals` reveal flag is off.
  // Bucket maps to a colour pill; DM-side rendering uses this for a quick
  // glance too (alongside the exact numbers).
  import { HP_BUCKET_LABELS, type HpBucket } from '$lib/realtime/reveals';

  export let value: HpBucket = 'unknown';

  $: tone = (() => {
    switch (value) {
      case 'healthy':
        return 'border-emerald-700 bg-emerald-900/30 text-emerald-200';
      case 'wounded':
        return 'border-yellow-700 bg-yellow-900/20 text-yellow-200';
      case 'bloodied':
        return 'border-orange-700 bg-orange-900/30 text-orange-200';
      case 'critical':
        return 'border-red-700 bg-red-950/40 text-red-200';
      case 'defeated':
        return 'border-slate-700 bg-slate-800/60 text-slate-400 line-through';
      default:
        return 'border-slate-700 text-slate-400';
    }
  })();
</script>

<span class="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide {tone}" title="{HP_BUCKET_LABELS[value]}">
  {HP_BUCKET_LABELS[value]}
</span>
