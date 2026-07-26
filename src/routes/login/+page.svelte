<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';

  export let form: ActionData;
  let busy = false;
</script>

<svelte:head>
  <title>Log in — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md">
  <h1 class="mb-4 text-2xl font-semibold">Log in</h1>

  <form
    method="POST"
    use:enhance={() => {
      busy = true;
      return async ({ update }) => {
        busy = false;
        await update();
      };
    }}
    class="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5"
  >
    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Username</span>
      <input
        name="username"
        class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono"
        value={form?.username ?? ''}
        autocomplete="username"
        required
      />
    </label>

    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Password</span>
      <input
        name="password"
        type="password"
        class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
        autocomplete="current-password"
        required
      />
    </label>

    {#if form?.error}
      <p class="rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">{form.error}</p>
    {/if}

    <div class="flex items-center justify-between">
      <div class="flex flex-col gap-1">
        <a class="text-sm text-slate-400 hover:text-slate-200" href="/signup">Need an account? Sign up</a>
        <a class="text-sm text-slate-400 hover:text-slate-200" href="/forgot-password">Forgot password?</a>
      </div>
      <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
        Log in
      </button>
    </div>
  </form>
</section>
