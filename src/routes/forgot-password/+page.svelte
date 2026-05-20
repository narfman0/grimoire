<script lang="ts">
  let email = '';
  let busy = false;
  let sent = false;
  let error: string | null = null;

  async function submit(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      });
      if (res.status === 429) {
        error = 'too many requests — try again later';
        return;
      }
      sent = true;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Forgot password — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md">
  <h1 class="mb-4 text-2xl font-semibold">Forgot your password?</h1>

  {#if sent}
    <p class="rounded border border-emerald-800 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
      If an account with that email exists, we've sent instructions to reset your password.
      Check your inbox (and spam folder).
    </p>
    <p class="mt-4 text-sm text-slate-400">
      <a href="/login" class="hover:text-slate-200">Back to log in</a>
    </p>
  {:else}
    <form on:submit={submit} class="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
      <label class="block text-sm">
        <span class="mb-1 block text-slate-400">Email address</span>
        <input
          type="email"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          bind:value={email}
          autocomplete="email"
          required
        />
      </label>

      {#if error}
        <p class="rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">{error}</p>
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
