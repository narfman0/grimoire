<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { toasts } from '$lib/client/errors';
  import { api } from '$lib/client/api';
  import ConfirmHost from '$lib/components/ui/ConfirmHost.svelte';
  import type { LayoutData } from './$types';
  export let data: LayoutData;

  let loggingOut = false;
  let homebrewOpen = false;

  async function logout() {
    loggingOut = true;
    try {
      await api.post('/api/auth/logout');
      window.location.href = '/login';
    } catch {
      // api() already toasted
    } finally {
      loggingOut = false;
    }
  }

  $: campaign = $page.data.campaign as { code: string; name: string } | undefined;

  let resendBusy = false;
  let resendDone = false;

  async function resendVerify() {
    resendBusy = true;
    try {
      await api.post('/api/auth/resend-verify');
      resendDone = true;
    } catch {
      // api() already toasted
    } finally {
      resendBusy = false;
    }
  }
</script>

<div class="flex min-h-screen flex-col">
  <header class="border-b border-slate-800 bg-slate-900/50">
    <nav class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 text-sm">
      <div class="flex min-w-0 items-center gap-2">
        <a href="/" class="flex shrink-0 items-center gap-2 text-lg font-semibold tracking-wide">
          <img src="/grimoire-icon-32.png" alt="" class="h-7 w-7 rounded" aria-hidden="true" />
          Grimoire
        </a>
        {#if campaign}
          <span class="shrink-0 text-slate-600">·</span>
          <a
            class="truncate text-sm text-slate-300 hover:text-emerald-300"
            href={`/c/${campaign.code}`}
            title={campaign.name}
          >
            {campaign.name}
          </a>
        {/if}
      </div>
      <div class="flex items-center gap-3 text-slate-400">
        {#if data.user}
          <!-- Homebrew menu: admin-only until feature is opened up. -->
          {#if data.user?.isAdmin}
          <div class="relative">
            <button
              class="text-xs hover:text-slate-200"
              on:click={() => (homebrewOpen = !homebrewOpen)}
              on:blur={() => setTimeout(() => (homebrewOpen = false), 200)}
              aria-haspopup="true"
              aria-expanded={homebrewOpen}
            >Homebrew</button>
            {#if homebrewOpen}
              <div class="absolute right-0 z-30 mt-1 w-44 rounded border border-slate-700 bg-slate-900 py-1 text-xs shadow-lg">
                <a class="block px-3 py-1 hover:bg-slate-800 hover:text-slate-100" href="/content/browse" on:mousedown|preventDefault={() => { homebrewOpen = false; goto('/content/browse'); }}>Browse content</a>
                <a class="block px-3 py-1 hover:bg-slate-800 hover:text-slate-100" href="/me/homebrew" on:mousedown|preventDefault={() => { homebrewOpen = false; goto('/me/homebrew'); }}>My library</a>
                <a class="block px-3 py-1 hover:bg-slate-800 hover:text-slate-100" href="/me/homebrew/subscriptions" on:mousedown|preventDefault={() => { homebrewOpen = false; goto('/me/homebrew/subscriptions'); }}>My subscriptions</a>
                <a class="block border-t border-slate-800 px-3 py-1 text-amber-300 hover:bg-slate-800" href="/admin/reports" on:mousedown|preventDefault={() => { homebrewOpen = false; goto('/admin/reports'); }}>Admin · reports</a>
              </div>
            {/if}
          </div>
          {/if}
          <a href="/me/change-password" class="font-mono text-xs hover:text-slate-200">{data.user.username}</a>
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
  {#if data.user && data.user.email && !data.user.emailVerified}
    <div class="border-b border-amber-800/60 bg-amber-950/40 px-4 py-2 text-center text-xs text-amber-300">
      Please verify your email address ({data.user.email}).
      <button
        class="ml-2 underline hover:text-amber-200"
        on:click={resendVerify}
        disabled={resendBusy || resendDone}
      >
        {resendDone ? 'Email sent!' : resendBusy ? 'Sending…' : 'Resend email'}
      </button>
    </div>
  {/if}
  <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
    <slot />
  </main>
  <ConfirmHost />
  {#if $toasts.length > 0}
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {#each $toasts as t (t.id)}
        <div class="flex items-start gap-2 rounded-lg border border-red-700 bg-red-950/90 px-4 py-3 text-sm text-red-200 shadow-lg">
          <span class="flex-1">{t.message}{#if t.requestId}<span class="ml-1 font-mono text-[10px] text-red-400">({t.requestId.slice(0, 8)})</span>{/if}</span>
          <button class="text-red-400 hover:text-red-200" on:click={() => toasts.dismiss(t.id)}>✕</button>
        </div>
      {/each}
    </div>
  {/if}
</div>
