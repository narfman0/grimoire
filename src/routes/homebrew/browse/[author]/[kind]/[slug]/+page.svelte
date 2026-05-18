<script lang="ts">
  import { invalidateAll, goto } from '$app/navigation';
  import type { PageData } from './$types';
  export let data: PageData;

  let busy = '';
  let showReportModal = false;
  let reportReason = '';

  async function subscribe() {
    busy = 'sub';
    try {
      await fetch('/api/homebrew/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: data.item.kind,
          slug: data.item.slug,
          authorUserId: data.item.authorUserId
        })
      });
      await invalidateAll();
    } finally {
      busy = '';
    }
  }
  async function unsubscribe() {
    busy = 'unsub';
    try {
      await fetch(
        `/api/homebrew/subscriptions/${encodeURIComponent(data.item.kind)}/${encodeURIComponent(data.item.slug)}/${encodeURIComponent(data.item.authorUserId)}`,
        { method: 'DELETE' }
      );
      await invalidateAll();
    } finally {
      busy = '';
    }
  }
  async function fork() {
    const newSlug = prompt(
      `Fork "${data.item.name}" into your library. New slug:`,
      `${data.item.authorUsername}-${data.item.slug}`
    );
    if (!newSlug) return;
    busy = 'fork';
    try {
      const res = await fetch(`/api/homebrew/${encodeURIComponent(data.item.kind)}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: data.item.slug,
          authorUserId: data.item.authorUserId,
          newSlug
        })
      });
      if (!res.ok) {
        alert((await res.text()) || `fork failed: HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { slug: string; kind: string };
      // Redirect to the editor for the forked copy (feats land in their
      // editor; other kinds will once phase E builds them).
      if (body.kind === 'feat') {
        await goto(`/me/homebrew/feats/${body.slug}`);
      } else {
        await goto('/me/homebrew/feats'); // fallback until other indexes exist
      }
    } finally {
      busy = '';
    }
  }
  async function submitReport() {
    if (!reportReason.trim()) return;
    busy = 'report';
    try {
      const res = await fetch('/api/homebrew/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentId: data.item.id, reason: reportReason })
      });
      if (res.ok) {
        showReportModal = false;
        reportReason = '';
        alert('Thanks — reported. An admin will review.');
      } else {
        alert((await res.text()) || `HTTP ${res.status}`);
      }
    } finally {
      busy = '';
    }
  }

  $: choices = (data.item.data?.choices ?? {}) as Record<string, unknown>;
  $: modifiers = (data.item.data?.modifiers ?? []) as Array<{ target: string; mode?: string; value: unknown }>;
</script>

<svelte:head><title>{data.item.name} · Homebrew · Grimoire</title></svelte:head>

<header class="mb-4 flex items-baseline justify-between">
  <div>
    <a class="text-xs text-slate-400 hover:text-slate-200" href="/homebrew/browse">← Marketplace</a>
    <h1 class="text-2xl font-semibold">{data.item.name}</h1>
    <p class="text-sm text-slate-400">
      <a href={`/homebrew/author/${encodeURIComponent(data.item.authorUsername)}`} class="hover:text-slate-200">by {data.item.authorUsername}</a>
      · <span class="rounded border border-slate-700 px-1 text-[10px] uppercase tracking-wide">{data.item.kind}</span>
      {#if data.item.data?.category}· {data.item.data.category}{/if}
      · {data.item.subscriberCount} subscriber{data.item.subscriberCount === 1 ? '' : 's'}
      {#if data.item.visibility === 'unlisted'}
        · <span class="rounded border border-slate-700 px-1 text-[10px] text-slate-300">unlisted</span>
      {:else if data.item.visibility === 'private'}
        · <span class="rounded border border-amber-700 px-1 text-[10px] text-amber-300">private (owner view)</span>
      {/if}
    </p>
  </div>
  <div class="flex items-center gap-2 text-sm">
    {#if data.isOwner}
      <a class="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800" href={`/me/homebrew/${data.item.kind === 'feat' ? 'feats' : data.item.kind}/${data.item.slug}`}>Edit</a>
    {:else}
      {#if data.item.viewerSubscribed}
        <button class="rounded border border-emerald-700 bg-emerald-950/50 px-3 py-1 text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-40" on:click={unsubscribe} disabled={busy === 'unsub'}>✓ Subscribed</button>
      {:else}
        <button class="rounded bg-emerald-600 px-3 py-1 hover:bg-emerald-500 disabled:opacity-40" on:click={subscribe} disabled={busy === 'sub'}>+ Subscribe</button>
      {/if}
      <button class="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800 disabled:opacity-40" on:click={fork} disabled={busy === 'fork'}>Fork</button>
      <button class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-red-300" on:click={() => (showReportModal = true)}>Report</button>
    {/if}
  </div>
</header>

{#if data.item.data?.prerequisite}
  <p class="mb-2 text-xs text-amber-400/80">Prerequisite: {data.item.data.prerequisite}</p>
{/if}

{#if data.item.data?.description}
  <p class="mb-4 text-sm leading-relaxed text-slate-300">{data.item.data.description}</p>
{/if}

{#if modifiers.length > 0}
  <section class="mb-4 rounded border border-slate-800 bg-slate-900/30 p-3">
    <h2 class="mb-2 text-xs uppercase tracking-wide text-slate-400">Modifiers</h2>
    <ul class="space-y-1 text-xs font-mono text-slate-300">
      {#each modifiers as m}
        <li>{m.target} <span class="text-slate-500">{m.mode ?? 'ADD'}</span> {String(m.value)}</li>
      {/each}
    </ul>
  </section>
{/if}

{#if Object.keys(choices).length > 0}
  <section class="mb-4 rounded border border-slate-800 bg-slate-900/30 p-3">
    <h2 class="mb-2 text-xs uppercase tracking-wide text-slate-400">Player choices</h2>
    <ul class="space-y-1 text-xs text-slate-300">
      {#each Object.entries(choices) as [k, v]}
        <li><span class="font-mono">{k}</span> · <span class="text-slate-500">{JSON.stringify(v)}</span></li>
      {/each}
    </ul>
  </section>
{/if}

{#if showReportModal}
  <!-- Lightweight modal; no popover lib needed. Backdrop is a button so the
       a11y linter is happy with click-to-dismiss; the inner panel stops
       propagation. -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label="Close dialog"
      on:click={() => (showReportModal = false)}
    ></button>
    <div role="dialog" aria-modal="true" aria-label="Report content" class="relative w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4">
      <h2 class="mb-2 text-lg font-semibold">Report "{data.item.name}"</h2>
      <p class="mb-2 text-xs text-slate-400">Tell us what's wrong. Admins review reports and can hide the content.</p>
      <textarea
        class="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        rows="4"
        maxlength="1000"
        bind:value={reportReason}
        placeholder="Why are you reporting this?"
      />
      <div class="flex items-center justify-end gap-2 text-sm">
        <button class="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800" on:click={() => (showReportModal = false)}>Cancel</button>
        <button class="rounded bg-red-700 px-3 py-1 text-red-100 hover:bg-red-600 disabled:opacity-40" on:click={submitReport} disabled={busy === 'report' || !reportReason.trim()}>Submit report</button>
      </div>
    </div>
  </div>
{/if}
