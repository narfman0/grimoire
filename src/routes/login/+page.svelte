<script lang="ts">
  let username = '';
  let password = '';
  let busy = false;
  let error: string | null = null;

  async function submit(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      if (!res.ok) {
        error =
          res.status === 401
            ? 'invalid username or password'
            : res.status === 423
              ? 'account temporarily locked — try again later or reset your password'
              : res.status === 429
                ? 'too many requests — try again later'
                : `login failed (${res.status})`;
        return;
      }
      window.location.href = '/';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Log in — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md">
  <h1 class="mb-4 text-2xl font-semibold">Log in</h1>

  <form on:submit={submit} class="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Username</span>
      <input
        class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono"
        bind:value={username}
        autocomplete="username"
        required
      />
    </label>

    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Password</span>
      <input
        type="password"
        class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
        bind:value={password}
        autocomplete="current-password"
        required
      />
    </label>

    {#if error}
      <p class="rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">{error}</p>
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
