<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';

  export let form: ActionData;
  let busy = false;
</script>

<svelte:head>
  <title>Forgot password — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md">
  <h1 class="mb-4 text-2xl font-semibold">Forgot your password?</h1>

  {#if form?.sent}
    <p class="rounded border border-emerald-800 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
      If an account with that email exists, we've sent instructions to reset your password.
      Check your inbox (and spam folder).
    </p>
    <p class="mt-4 text-sm text-slate-400">
      <a href="/login" class="hover:text-slate-200">Back to log in</a>
    </p>
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
      <label class="block text-sm">
        <span class="mb-1 block text-slate-400">Email address</span>
        <input
          name="email"
          type="email"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          value={form?.email ?? ''}
          autocomplete="email"
          required
        />
      </label>

      {#if form?.error}
        <p class="rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">{form.error}</p>
      {/if}

      <div class="flex items-center justify-between">
        <a class="text-sm text-slate-400 hover:text-slate-200" href="/login">Back to log in</a>
        <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
          Send reset link
        </button>
      </div>
    </form>
  {/if}
</section>
