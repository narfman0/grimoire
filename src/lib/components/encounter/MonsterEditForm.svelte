<script lang="ts">
  // Rename + statblock swap + remove for a non-PC participant (DM only — the
  // parent gates on both). Drafts are two-way bound so the parent keeps
  // owning them (they're seeded from the participant, and the parent's save
  // handler compares the slug draft against the current statblockSlug).
  import { createEventDispatcher } from 'svelte';

  export let monsterOptions: Array<{ slug: string; name: string; cr: string | number }> = [];
  export let nameDraft = '';
  export let slugDraft = '';
  export let busy = false;

  const dispatch = createEventDispatcher<{ save: void; remove: void }>();
</script>

<div>
  <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Edit</div>
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <label class="flex items-center gap-1">
      <span class="text-slate-500">Name</span>
      <input
        class="w-40 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
        bind:value={nameDraft}
        maxlength="120"
      />
    </label>
    <label class="flex items-center gap-1">
      <span class="text-slate-500">Type</span>
      <select
        class="w-48 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
        bind:value={slugDraft}
      >
        <option value="">— ad-hoc —</option>
        {#each monsterOptions as m}
          <option value={m.slug}>{m.name} (CR {m.cr})</option>
        {/each}
      </select>
    </label>
    <button
      class="rounded bg-emerald-700/70 px-2 py-0.5 text-[11px] hover:bg-emerald-700 disabled:opacity-40"
      disabled={busy || !nameDraft.trim()}
      on:click={() => dispatch('save')}
    >save</button>
    <button
      class="ml-auto rounded border border-red-800 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-900/60 disabled:opacity-40"
      disabled={busy}
      on:click={() => dispatch('remove')}
    >Remove from encounter</button>
  </div>
</div>
