<script lang="ts">
  // Encounter page header: title (with the DM's inline rename), the live-sync
  // dot, the XP budget gauge, and the staging → live "Start encounter"
  // button. Stateless apart from the rename draft; the parent owns the name,
  // the connection status and the status transition.
  import { createEventDispatcher } from 'svelte';

  export let name: string;
  export let role: 'dm' | 'player';
  export let busy = false;
  /** Null when the realtime channel hasn't initialized (SSR-only mode). */
  export let connStatus: 'connecting' | 'open' | 'closed' | null = null;
  export let status: string;
  export let totalXp = 0;
  export let xpPerChar = 0;
  export let party: { size: number; avgLevel: number };
  export let participantCount = 0;
  export let encountersHref: string;

  /** Two-way: the parent clears it once its PATCH settles, matching the
   *  previous inline ordering (the input stays up while the save is in
   *  flight). */
  export let renaming = false;

  const dispatch = createEventDispatcher<{ rename: string; start: void }>();

  let renameValue = name;

  /** One user action must send exactly one PATCH. Enter submits and then
   *  the input blurs as it unmounts, which used to submit a second time —
   *  the parent's `trimmed === name` guard can't dedupe them because the
   *  name only updates after the first PATCH resolves. Latched for the
   *  lifetime of one rename; opening the editor again clears it.
   *
   *  The buttons additionally preventDefault their mousedown so clicking
   *  them never blurs the input in the first place: that's what makes
   *  `cancel` discard rather than save-then-close. */
  let dispatched = false;

  function submitRename() {
    if (dispatched) return;
    dispatched = true;
    dispatch('rename', renameValue);
  }

  function startRename() {
    renameValue = name;
    dispatched = false;
    renaming = true;
  }

  function cancelRename() {
    dispatched = true;
    renaming = false;
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') submitRename();
    else if (e.key === 'Escape') cancelRename();
  }
</script>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    {#if renaming}
      <div class="flex items-center gap-2">
        <!-- svelte-ignore a11y-autofocus (rename input appears on demand; it must own focus or the blur-to-save flow never engages) -->
        <input
          class="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-2xl font-semibold text-slate-100 outline-none focus:border-slate-400"
          bind:value={renameValue}
          on:keydown={onRenameKeydown}
          on:blur={submitRename}
          autofocus
        />
        <button
          class="text-xs text-slate-500 hover:text-slate-300"
          on:mousedown|preventDefault
          on:click={submitRename}>save</button>
        <button
          class="text-xs text-slate-500 hover:text-slate-300"
          on:mousedown|preventDefault
          on:click={cancelRename}>cancel</button>
      </div>
    {:else}
      <h1 class="group flex items-center gap-2 text-2xl font-semibold">
        {name}
        {#if role === 'dm'}
          <button
            class="opacity-0 group-hover:opacity-100 text-sm text-slate-500 hover:text-slate-300 transition-opacity"
            on:click={startRename}
            aria-label="Rename encounter"
          >✎</button>
        {/if}
      </h1>
    {/if}
    <p class="text-sm text-slate-400">
      {#if connStatus}
        <span
          class="inline-block h-2 w-2 rounded-full {connStatus === 'open'
            ? 'bg-emerald-500'
            : connStatus === 'connecting'
              ? 'bg-amber-500'
              : 'bg-slate-600'}"
          title={connStatus === 'open'
            ? `${status} · live sync connected`
            : `${status} · sync: ${connStatus}`}
        ></span>
      {/if}
      {#if totalXp > 0}
        &middot; <span class="text-slate-300">{totalXp} XP</span>
        {#if party.size > 0}
          <span class="text-slate-500">
            (vs {party.size} PC{party.size === 1 ? '' : 's'},
            avg L{party.avgLevel.toFixed(1)} —
            <span class="text-slate-300">{xpPerChar}/char</span>)
          </span>
        {/if}
      {/if}
    </p>
  </div>
  <div class="flex items-center gap-3">
    {#if role === 'dm'}
      {#if status === 'staging'}
        <button
          class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
          disabled={busy || participantCount === 0}
          title={participantCount === 0
            ? 'Add at least one participant first'
            : 'Flip to live combat'}
          on:click={() => dispatch('start')}
        >
          ▶ Start encounter
        </button>
      {/if}
    {/if}
    <a class="text-xs text-slate-400 hover:text-slate-200" href={encountersHref}>
      ← all encounters
    </a>
  </div>
</header>
