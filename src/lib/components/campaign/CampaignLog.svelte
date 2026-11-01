<!--
  Campaign Log tab — the session timeline (HP, conditions, slots, rests,
  inventory, levels, DM notes) folded with the combat log. Everything here
  arrives already filtered for the viewer: players never receive private
  notes, and combat rows are redacted server-side.

  DM extras: add a note (optionally private / about one character), amend a
  note, restore a character's HP to before an HP entry. All three append —
  nothing in the log is ever edited or deleted.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api } from '$lib/client/api';
  import { confirmDialog, promptDialog } from '$lib/components/ui/confirm';
  import type { TimelineEntry } from '$lib/dashboard/types';

  export let code: string;
  export let isDM: boolean;
  export let characters: Array<{ id: string; name: string }>;

  const PAGE = 50;
  const REFRESH_MS = 5000;

  let entries: TimelineEntry[] = [];
  let filter = '';
  let loading = false;
  let exhausted = false;
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  let noteText = '';
  let notePrivate = false;
  let noteCharacter = '';

  function url(before?: number) {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (filter) q.set('characterId', filter);
    if (before !== undefined) q.set('before', String(before));
    return `/api/campaigns/${code}/log?${q}`;
  }

  /** Reload the newest page (keeps any older pages already loaded). */
  async function refresh(silent = true) {
    try {
      const res = await api.get<{ entries: TimelineEntry[] }>(url(), { silent });
      const fresh = res.entries;
      const freshIds = new Set(fresh.map((e) => e.id));
      const oldest = fresh.length ? fresh[fresh.length - 1].at : Infinity;
      // Keep older pages the user scrolled into; replace the newest window.
      entries = [...fresh, ...entries.filter((e) => !freshIds.has(e.id) && e.at < oldest)];
      if (fresh.length < PAGE && entries.length === fresh.length) exhausted = true;
    } catch {
      // silent poll: the next tick retries
    }
  }

  async function reset() {
    entries = [];
    exhausted = false;
    loading = true;
    await refresh(false);
    loading = false;
  }

  async function loadOlder() {
    if (entries.length === 0) return;
    loading = true;
    try {
      const res = await api.get<{ entries: TimelineEntry[] }>(url(entries[entries.length - 1].at));
      entries = [...entries, ...res.entries];
      if (res.entries.length < PAGE) exhausted = true;
    } catch {
      // api() already toasted
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void reset();
    timer = setInterval(() => void refresh(), REFRESH_MS);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  async function addNote() {
    const text = noteText.trim();
    if (!text) return;
    busy = true;
    try {
      await api.post(`/api/campaigns/${code}/log`, {
        text,
        isPrivate: notePrivate,
        characterId: noteCharacter || null
      });
      noteText = '';
      await refresh(false);
    } catch {
      // api() already toasted; keep the draft
    } finally {
      busy = false;
    }
  }

  async function amend(e: TimelineEntry) {
    const text = await promptDialog({
      title: 'Amend note',
      message: 'Adds a correction below the original — the original stays in the log.',
      defaultValue: e.summary,
      confirmLabel: 'Add correction'
    });
    if (!text || !text.trim()) return;
    busy = true;
    try {
      await api.post(`/api/campaigns/${code}/log/${e.id}/amend`, { text: text.trim() });
      await refresh(false);
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function restore(e: TimelineEntry) {
    const who = characters.find((c) => e.characterIds.includes(c.id))?.name ?? 'this character';
    const ok = await confirmDialog({
      title: `Restore ${who}'s HP to ${e.hpBefore}?`,
      message:
        'Sets HP (and temp HP) back to what they were before this entry, overwriting anything since. ' +
        'The restore is logged; nothing is deleted.',
      confirmLabel: 'Restore HP'
    });
    if (!ok) return;
    busy = true;
    try {
      await api.post(`/api/campaigns/${code}/log/${e.id}/restore`);
      await refresh(false);
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  const KIND_ICON: Record<string, string> = {
    combat: '⚔',
    hp: '♥',
    condition: '◆',
    'death-save': '☠',
    concentration: '◎',
    'spell-slot': '✦',
    resource: '⟳',
    rest: '☾',
    inventory: '⚲',
    level: '▲',
    note: '✎'
  };

  function when(ms: number) {
    const d = new Date(ms);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm" data-testid="campaign-log">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-lg font-semibold">Session log</h2>
    <label class="flex items-center gap-2 text-xs text-slate-400">
      Character
      <select
        class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
        bind:value={filter}
        on:change={reset}
      >
        <option value="">Everyone</option>
        {#each characters as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if isDM}
    <form class="mb-4 space-y-2 rounded border border-slate-800 bg-slate-950/40 p-3" on:submit|preventDefault={addNote}>
      <textarea
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        rows="2"
        maxlength="2000"
        placeholder="Add a note to the log…"
        bind:value={noteText}
      ></textarea>
      <div class="flex flex-wrap items-center gap-3 text-xs">
        <label class="flex items-center gap-1 text-slate-300">
          <input type="checkbox" bind:checked={notePrivate} />
          Private (DM only)
        </label>
        <select class="rounded border border-slate-700 bg-slate-950 px-2 py-1" bind:value={noteCharacter}>
          <option value="">About: everyone</option>
          {#each characters as c (c.id)}
            <option value={c.id}>About: {c.name}</option>
          {/each}
        </select>
        <button
          class="ml-auto rounded bg-emerald-700 px-3 py-1 font-semibold hover:bg-emerald-600 disabled:opacity-40"
          disabled={busy || !noteText.trim()}
        >Add note</button>
      </div>
    </form>
  {/if}

  {#if loading && entries.length === 0}
    <p class="text-xs text-slate-500">Loading…</p>
  {:else if entries.length === 0}
    <p class="text-xs text-slate-500">Nothing logged yet. HP, conditions, slots, rests and inventory changes show up here as they happen.</p>
  {:else}
    <ul class="divide-y divide-slate-800/70">
      {#each entries as e (e.id)}
        <li class="flex items-start gap-2 py-1.5" data-testid="log-row">
          <span class="w-4 shrink-0 text-center text-slate-500" title={e.kind}>{KIND_ICON[e.kind] ?? '•'}</span>
          <div class="min-w-0 flex-1">
            <span class="{e.redacted ? 'italic text-slate-400' : 'text-slate-200'} {e.amendedById ? 'line-through decoration-slate-600' : ''}">
              {e.summary}
            </span>
            {#if e.source === 'combat' && e.hpBefore != null && e.hpAfter != null}
              <span class="font-mono text-xs text-slate-400">HP {e.hpBefore}→{e.hpAfter}</span>
            {/if}
            {#if e.isPrivate}
              <span class="ml-1 rounded bg-amber-900/50 px-1 text-[10px] uppercase text-amber-300">private</span>
            {/if}
            {#if e.amendsId}
              <span class="ml-1 rounded bg-sky-900/50 px-1 text-[10px] uppercase text-sky-300">correction</span>
            {/if}
            <div class="text-[11px] text-slate-500">
              {when(e.at)}
              {#if e.actorName}· {e.actorName}{/if}
              {#if e.encounterName}· {e.encounterName}{e.round ? ` r${e.round}` : ''}{/if}
            </div>
          </div>
          {#if isDM}
            <div class="flex shrink-0 gap-1">
              {#if e.restorable}
                <button
                  class="rounded border border-slate-700 px-2 py-0.5 text-[11px] hover:border-amber-600 hover:text-amber-200 disabled:opacity-40"
                  title="Set HP back to {e.hpBefore}"
                  disabled={busy}
                  on:click={() => restore(e)}
                >↶ Restore HP</button>
              {/if}
              {#if e.kind === 'note' && e.source === 'session'}
                <button
                  class="rounded border border-slate-700 px-2 py-0.5 text-[11px] hover:border-sky-600 hover:text-sky-200 disabled:opacity-40"
                  disabled={busy}
                  on:click={() => amend(e)}
                >Amend</button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !exhausted}
      <button
        class="mt-3 w-full rounded border border-slate-800 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
        disabled={loading}
        on:click={loadOlder}
      >Load older</button>
    {/if}
  {/if}
</section>
