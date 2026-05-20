<script lang="ts">
  import { page } from '$app/stores';
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100">
  <div class="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-8 text-center">
    <p class="mb-2 text-5xl font-bold text-slate-500">{$page.status}</p>
    <h1 class="mb-3 text-xl font-semibold">
      {#if $page.status === 404}
        Page not found
      {:else if $page.status === 403}
        Access denied
      {:else}
        Something went wrong
      {/if}
    </h1>
    <p class="mb-6 text-sm text-slate-400">
      {$page.error?.message ?? 'An unexpected error occurred.'}
    </p>
    <a
      href="/"
      class="inline-block rounded bg-amber-700 px-4 py-2 text-sm font-medium hover:bg-amber-600"
    >
      Back to home
    </a>
  </div>
</div>
