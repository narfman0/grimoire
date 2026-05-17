<script lang="ts">
  import '../app.css';
  import type { LayoutData } from './$types';
  export let data: LayoutData;

  let loggingOut = false;
  async function logout() {
    loggingOut = true;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } finally {
      loggingOut = false;
    }
  }
</script>

<div class="flex min-h-screen flex-col">
  <header class="border-b border-slate-800 bg-slate-900/50">
    <nav class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 text-sm">
      <a href="/" class="text-lg font-semibold tracking-wide">Grimoire</a>
      <div class="flex items-center gap-3 text-slate-400">
        {#if data.user}
          <span class="font-mono text-xs">{data.user.username}</span>
          <button
            class="rounded border border-slate-700 px-2 py-0.5 text-xs hover:text-slate-200 disabled:opacity-40"
            on:click={logout}
            disabled={loggingOut}
          >
            Log out
          </button>
        {:else}
          <a class="text-xs hover:text-slate-200" href="/login">Log in</a>
          <a class="text-xs hover:text-slate-200" href="/signup">Sign up</a>
        {/if}
      </div>
    </nav>
  </header>
  <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
    <slot />
  </main>
</div>
