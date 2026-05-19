<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<svelte:head><title>My homebrew · Grimoire</title></svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <h1 class="text-2xl font-semibold">My homebrew</h1>
  <div class="flex items-center gap-3 text-sm">
    <a class="text-xs hover:text-slate-200 text-slate-400" href="/me/homebrew/subscriptions">{data.subscriptionCount} subscription{data.subscriptionCount === 1 ? '' : 's'}</a>
    <a class="text-xs hover:text-slate-200 text-emerald-300" href="/content/browse">Browse content →</a>
  </div>
</header>

<p class="mb-4 text-sm text-slate-400">
  Author content for any kind the rules engine consumes. The <em>feat</em> editor is structured; every other kind ships a JSON-with-validation editor for v1 (structured editors come in a follow-up).
</p>

<ul class="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
  {#each data.kinds as k}
    <li>
      <a
        href={k.href}
        class="block rounded-lg border border-slate-800 bg-slate-900/30 p-3 hover:border-slate-600 hover:bg-slate-900/60"
      >
        <div class="flex items-baseline justify-between">
          <span class="text-sm font-medium text-slate-200">{k.kind}</span>
          <span class="text-xs text-slate-500">{k.count}</span>
        </div>
      </a>
    </li>
  {/each}
</ul>
