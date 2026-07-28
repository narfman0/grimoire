<script lang="ts">
  // Add-participant modal (DM only — the parent gates on role). Owns the
  // draft state and the monster picker; the parent owns the POST loop and
  // calls `resetDraft()` once the adds have landed, so the form keeps showing
  // what was submitted while the requests are in flight.
  import { createEventDispatcher } from 'svelte';
  import MonsterPicker, { type MonsterOption } from '$lib/components/MonsterPicker.svelte';

  export let open = false;
  export let busy = false;
  export let campaignCharacters: Array<{ id: string; name: string }> = [];
  export let monsterOptions: MonsterOption[] = [];

  const dispatch = createEventDispatcher<{
    add: {
      kind: 'pc' | 'npc';
      name: string;
      characterId: string;
      statblockSlug: string;
      defaultMaxHp: number | null;
      quantity: number;
    };
  }>();

  const KINDS: Array<'pc' | 'npc'> = ['pc', 'npc'];

  // Add-participant draft state
  let newKind: 'pc' | 'npc' = 'npc';
  let showMonsterPicker = false;
  let newName = '';
  let newCharacterId = campaignCharacters[0]?.id ?? '';
  let newMonsterSlug = '';
  /** Default HP comes from the statblock; the picker passes it through so
   *  the new participant row has a non-null currentHp/maxHp without the
   *  DM needing an extra input. Plain NPCs without a statblock get nulls. */
  let newDefaultMaxHp: number | null = null;
  /** How many copies of the NPC to add. PCs can't be duplicated.  When > 1
   *  the names are auto-suffixed "#1, #2, …" so they're distinguishable. */
  let newQuantity = 1;

  function onMonsterPicked(e: CustomEvent<MonsterOption>) {
    const m = e.detail;
    newMonsterSlug = m.slug;
    newName = m.name;
    newDefaultMaxHp = m.maxHp ?? null;
    showMonsterPicker = false;
  }

  /** Called by the parent after the adds complete. */
  export function resetDraft() {
    newName = '';
    newMonsterSlug = '';
    newDefaultMaxHp = null;
    newQuantity = 1;
  }
</script>

{#if open}
  <!-- Add-participant modal. Triggered by the "+ Add" button next to the
       Participants header. Backdrop click + Escape both close. -->
  <button
    class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
    aria-label="Close add-participant"
    tabindex="-1"
    on:click={() => (open = false)}
  ></button>
  <div
    class="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
    role="dialog"
    aria-modal="true"
    aria-label="Add participant"
  >
    <div class="mb-3 flex items-baseline justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-200">Add participant</h2>
      <button
        class="text-xs text-slate-500 hover:text-slate-300"
        on:click={() => (open = false)}
      >
        ✕
      </button>
    </div>
    <div class="mb-3 flex gap-3 text-xs">
      {#each KINDS as k}
        <label class="flex items-center gap-1">
          <input type="radio" bind:group={newKind} value={k} />
          <span>{k.toUpperCase()}</span>
        </label>
      {/each}
    </div>
    <div class="flex flex-col gap-2">
      {#if newKind === 'pc'}
        {#if campaignCharacters.length === 0}
          <p class="text-xs text-amber-300">No characters in this campaign yet.</p>
        {:else}
          <label class="text-xs">
            <span class="block text-slate-400">Character</span>
            <select class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={newCharacterId}>
              {#each campaignCharacters as c}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </label>
        {/if}
      {:else}
        <div class="text-xs">
          <span class="block text-slate-400 mb-1">Statblock (optional — leave blank for ad-hoc)</span>
          <button
            class="flex w-full items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100"
            on:click={() => (showMonsterPicker = true)}
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            {newMonsterSlug ? newName : 'Search…'}
          </button>
        </div>
        <label class="text-xs">
          <span class="block text-slate-400">Name{newMonsterSlug ? ' (override)' : ''}</span>
          <input
            class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            placeholder={newMonsterSlug ? '' : 'Captured noble, etc.'}
            bind:value={newName}
          />
        </label>
        <label class="text-xs">
          <span class="block text-slate-400">Quantity</span>
          <input
            type="number"
            min="1"
            max="20"
            class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
            bind:value={newQuantity}
            title="Adding N copies suffixes the names #1, #2, …"
          />
        </label>
      {/if}
    </div>
    <div class="mt-4 flex items-center justify-end gap-2">
      <button
        class="rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
        on:click={() => (open = false)}
        disabled={busy}
      >
        Cancel
      </button>
      <button
        class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
        on:click={() =>
          dispatch('add', {
            kind: newKind,
            name: newName,
            characterId: newCharacterId,
            statblockSlug: newMonsterSlug,
            defaultMaxHp: newDefaultMaxHp,
            quantity: newQuantity
          })}
        disabled={busy || (newKind === 'npc' && !newName) || (newKind === 'pc' && !newCharacterId)}
      >
        {newKind === 'npc' && newQuantity > 1 ? `Add ${newQuantity}` : 'Add'}
      </button>
    </div>
  </div>
{/if}

{#if showMonsterPicker}
  <MonsterPicker
    monsters={monsterOptions}
    disabled={busy}
    on:pick={onMonsterPicked}
    on:close={() => (showMonsterPicker = false)}
  />
{/if}
