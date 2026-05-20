<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<svelte:head>
  <title>Verify email — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md text-center">
  {#if data.success}
    <h1 class="mb-3 text-2xl font-semibold text-emerald-400">Email verified!</h1>
    <p class="mb-6 text-slate-400">Your email address has been confirmed.</p>
    <a href="/" class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500">
      Continue to Grimoire
    </a>
  {:else}
    <h1 class="mb-3 text-2xl font-semibold text-red-400">Verification failed</h1>
    <p class="mb-6 text-slate-400">{data.error}</p>
    <a href="/" class="text-sm text-slate-400 hover:text-slate-200">Go home</a>
  {/if}
</section>
