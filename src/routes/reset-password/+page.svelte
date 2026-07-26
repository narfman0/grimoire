<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import type { ActionData } from './$types';

  export let form: ActionData;
  let busy = false;

  $: token = $page.url.searchParams.get('token') ?? '';
</script>

<svelte:head>
  <title>Reset password — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md">
  <h1 class="mb-4 text-2xl font-semibold">Set a new password</h1>

  {#if !token}
    <p class="text-slate-400">This link is invalid. <a class="text-emerald-400 hover:underline" href="/forgot-password">Request a new one.</a></p>
  {:else if form?.done}
    <p class="mb-4 rounded border border-emerald-800 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
      Password updated. You have been logged out of all other devices.
    </p>
    <a href="/login" class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500">
      Log in
    </a>
  {:else}
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
      <input type="hidden" name="token" value={token} />

      <label class="block text-sm">
        <span class="mb-1 block text-slate-400">New password</span>
        <input
          name="password"
          type="password"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          autocomplete="new-password"
          required
          minlength="8"
        />
      </label>

      <label class="block text-sm">
        <span class="mb-1 block text-slate-400">Confirm password</span>
        <input
          name="confirmPassword"
          type="password"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          autocomplete="new-password"
          required
          minlength="8"
        />
      </label>

      {#if form?.error}
        <p class="rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">{form.error}</p>
      {/if}

      <button class="w-full rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
        Set new password
      </button>
    </form>
  {/if}
</section>
