<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<header class="mb-6">
  <h1 class="text-2xl font-semibold">{data.campaign.name}</h1>
  <p class="text-sm text-slate-400">
    Code <span class="font-mono">{data.campaign.code}</span> &middot; signed in as
    <span class="font-medium">{data.displayName}</span>
  </p>
</header>

<section class="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center text-slate-400">
  <p class="text-lg">Character list coming soon.</p>
  <p class="mt-2 text-sm">M1 wires up character creation; M2 brings real-time edits via Hocuspocus.</p>
</section>
