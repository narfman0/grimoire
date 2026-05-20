<script lang="ts">
  let currentPassword = '';
  let newPassword = '';
  let confirmPassword = '';
  let busy = false;
  let done = false;
  let error: string | null = null;

  async function submit(e: Event) {
    e.preventDefault();
    error = null;

    if (newPassword !== confirmPassword) {
      error = 'new passwords do not match';
      return;
    }

    busy = true;
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (!res.ok) {
        error =
          res.status === 401
            ? 'current password is incorrect'
            : `error (${res.status})`;
        return;
      }
      done = true;
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Change password — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md">
  <h1 class="mb-4 text-2xl font-semibold">Change password</h1>

  {#if done}
    <p class="rounded border border-emerald-800 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
      Password updated. All other devices have been signed out.
    </p>
  {/if}

  <form on:submit={submit} class="mt-4 space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Current password</span>
      <input
        type="password"
        class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
        bind:value={currentPassword}
        autocomplete="current-password"
        required
      />
    </label>

    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">New password</span>
      <input
        type="password"
        class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
        bind:value={newPassword}
        autocomplete="new-password"
        required
        minlength="8"
      />
    </label>

    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Confirm new password</span>
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

    <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
      Update password
    </button>
  </form>
</section>
