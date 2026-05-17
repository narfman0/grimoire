<script lang="ts">
  let username = '';
  let password = '';
  let confirmPassword = '';
  let busy = false;
  let error: string | null = null;

  async function submit(e: Event) {
    e.preventDefault();
    error = null;

    if (password.length < 8) {
      error = 'password must be at least 8 characters';
      return;
    }
    if (password !== confirmPassword) {
      error = 'passwords do not match';
      return;
    }

    busy = true;
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 409) {
          error = 'that username is already taken';
        } else if (res.status === 400) {
          error = body || 'invalid signup details';
        } else {
          error = `signup failed (${res.status})`;
        }
        return;
      }
      window.location.href = '/';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Sign up — Grimoire</title>
</svelte:head>

<section class="mx-auto max-w-md">
  <h1 class="mb-4 text-2xl font-semibold">Create your account</h1>
  <p class="mb-6 text-sm text-slate-400">
    Pick a username (3–32 chars; letters, digits, <code>_</code>, <code>-</code>) and a password
    (8+ chars). Your username is also how you appear at every campaign table.
  </p>

  <form on:submit={submit} class="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Username</span>
      <input
        class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono"
        bind:value={username}
        placeholder="alice"
        autocomplete="username"
        required
        minlength="3"
        maxlength="32"
        pattern="[a-zA-Z0-9_-]+"
      />
    </label>

    <label class="block text-sm">
      <span class="mb-1 block text-slate-400">Password</span>
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

    <div class="flex items-center justify-between">
      <a class="text-sm text-slate-400 hover:text-slate-200" href="/login">Already have an account? Log in</a>
      <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
        Sign up
      </button>
    </div>
  </form>
</section>
