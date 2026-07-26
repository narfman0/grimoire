<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';

  export let form: ActionData;
  let busy = false;
</script>

<svelte:head>
  <title>Sign up — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md">
  <h1 class="mb-4 text-2xl font-semibold">Create your account</h1>
  <p class="mb-6 text-sm text-slate-400">
    Pick a username (3–32 chars; letters, digits, <code>_</code>, <code>-</code>) and a password
    (8+ chars). Your email is used for verification and account recovery.
  </p>

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
        placeholder="alice"
        autocomplete="username"
        required
        minlength="3"
        maxlength="32"
        pattern="[a-zA-Z0-9_-]+"
      />
    </label>

    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Email</span>
      <input
        name="email"
        type="email"
        class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
        value={form?.email ?? ''}
        autocomplete="email"
        required
      />
    </label>

    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Password</span>
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

    <div class="flex items-center justify-between">
      <a class="text-sm text-slate-400 hover:text-slate-200" href="/login">Already have an account? Log in</a>
      <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
        Sign up
      </button>
    </div>
  </form>
</section>
