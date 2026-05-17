<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  export let data: PageData;

  let newName = '';
  let busy = false;
  let error: string | null = null;

  async function createCharacter(e: Event) {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campaignCode: data.campaign.code, name: newName })
      });
      if (!res.ok) {
        error = `Could not create character (${res.status}).`;
        return;
      }
      newName = '';
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function deleteCharacter(id: string) {
    if (!confirm('Delete this character?')) return;
    const res = await fetch(`/api/characters/${id}`, { method: 'DELETE' });
    if (res.ok) await invalidateAll();
  }
</script>

<header class="mb-6">
  <h1 class="text-2xl font-semibold">{data.campaign.name}</h1>
  <p class="text-sm text-slate-400">
    Code <span class="font-mono">{data.campaign.code}</span> &middot; signed in as
    <span class="font-medium">{data.displayName}</span>
  </p>
</header>

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
  <h2 class="mb-3 text-lg font-semibold">Characters</h2>

  {#if data.characters.length === 0}
    <p class="mb-4 text-sm text-slate-400">No characters yet. Add the first one below.</p>
  {:else}
    <ul class="mb-4 divide-y divide-slate-800">
      {#each data.characters as character (character.id)}
        <li class="flex items-center justify-between py-2">
          <span class="font-medium">{character.name}</span>
          <button
            class="text-xs text-slate-400 hover:text-red-400"
            on:click={() => deleteCharacter(character.id)}
          >
            Delete
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <form on:submit={createCharacter} class="flex gap-2">
    <input
      class="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2"
      placeholder="Character name"
      bind:value={newName}
      required
    />
    <button class="rounded bg-emerald-600 px-4 py-2 font-medium disabled:opacity-50" disabled={busy}>
      Add
    </button>
  </form>

  {#if error}
    <p class="mt-3 rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">
      {error}
    </p>
  {/if}
</section>

<p class="text-xs text-slate-500">
  M2 wires up real-time sheet edits via Hocuspocus / Y.js.
</p>

<section class="mt-6 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
  <h2 class="mb-2 text-sm font-semibold text-slate-200">Rules-engine sheet previews</h2>
  <p class="mb-2 text-xs text-slate-500">
    Read-only demos that run derive() against the real packs on disk. Wire-up for
    editable per-campaign sheets lands in M2.
  </p>
  <div class="flex flex-wrap gap-2">
    <a class="rounded border border-slate-700 px-3 py-1 hover:border-emerald-600 hover:text-emerald-200" href="/sheet/half-orc-zealot-barbarian">
      Vorm (Half-Orc Zealot Barbarian L3)
    </a>
    <a class="rounded border border-slate-700 px-3 py-1 hover:border-emerald-600 hover:text-emerald-200" href="/sheet/tortle-chronurgy-wizard">
      Shellmar (Tortle Chronurgy Wizard L5)
    </a>
  </div>
</section>
