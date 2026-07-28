<script lang="ts">
  // Rename + statblock swap + remove for a non-PC participant (DM only — the
  // parent gates on both).
  //
  // The drafts live here and are seeded from `participant`, re-seeding
  // whenever the selection changes. They used to be parent-owned two-way
  // bindings fed by an `openMonsterEdit()` the detail panel never called, so
  // the form opened blank: save stayed disabled until the DM retyped the
  // name, and switching participants kept the previous monster's draft.
  import { createEventDispatcher } from 'svelte';

  export let participant: { id: string; name: string; statblockSlug: string | null };
  export let monsterOptions: Array<{ slug: string; name: string; cr: string | number }> = [];
  export let busy = false;

  const dispatch = createEventDispatcher<{
    save: { name: string; slug: string };
    remove: void;
  }>();

  let nameDraft = '';
  let slugDraft = '';
  /** Which participant the drafts were seeded from. Guards the reactive
   *  re-seed so DM keystrokes aren't overwritten on every parent update. */
  let seededFor: string | null = null;
  $: if (participant.id !== seededFor) {
    seededFor = participant.id;
    nameDraft = participant.name;
    slugDraft = participant.statblockSlug ?? '';
  }
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
      on:click={() => dispatch('save', { name: nameDraft, slug: slugDraft })}
    >save</button>
    <button
      class="ml-auto rounded border border-red-800 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-900/60 disabled:opacity-40"
      disabled={busy}
      on:click={() => dispatch('remove')}
    >Remove from encounter</button>
  </div>
</div>
