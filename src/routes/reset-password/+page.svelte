<script lang="ts">
  import { page } from '$app/stores';

  let password = '';
  let confirmPassword = '';
  let busy = false;
  let done = false;
  let error: string | null = null;

  $: token = $page.url.searchParams.get('token') ?? '';

  async function submit(e: Event) {
    e.preventDefault();
    error = null;

    if (password !== confirmPassword) {
      error = 'passwords do not match';
      return;
    }

    busy = true;
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      if (!res.ok) {
        const body = await res.text();
        error = res.status === 400 ? (body || 'invalid or expired link') : `error (${res.status})`;
        return;
      }
      done = true;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Reset password — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md">
  <h1 class="mb-4 text-2xl font-semibold">Set a new password</h1>

  {#if !token}
    <p class="text-slate-400">This link is invalid. <a class="text-emerald-400 hover:underline" href="/forgot-password">Request a new one.</a></p>
  {:else if done}
    <p class="mb-4 rounded border border-emerald-800 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
      Password updated. You have been logged out of all other devices.
    </p>
    <a href="/login" class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500">
      Log in
    </a>
  {:else}
    <form on:submit={submit} class="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <label class="block text-sm">
        <span class="mb-1 block text-slate-400">New password</span>
        <input
          type="password"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          bind:value={password}
          autocomplete="new-password"
          required
          minlength="8"
        />
      </label>

      <label class="block text-sm">
        <span class="mb-1 block text-slate-400">Confirm password</span>
        <input
          type="password"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          bind:value={confirmPassword}
          autocomplete="new-password"
          required
          minlength="8"
        />
      </label>

      {#if error}
        <p class="rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">{error}</p>
      {/if}

      <button class="w-full rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
        Set new password
      </button>
    </form>
  {/if}
</section>
