<script lang="ts">
  // Encounter action log. Owns only its own filter state; the rows and the
  // participant list arrive already redacted from the parent (the server
  // redacts rows whose actor a player may not see — see
  // $lib/realtime/action-log). This component never re-derives visibility
  // from raw data; it reads `entry.redacted` and the resolvability of
  // `entry.participantId` against the list it was handed.
  import { createEventDispatcher } from 'svelte';

  type LogEntry = {
    id: string;
    participantId: string | null;
    targetParticipantId: string | null;
    actionId: string;
    actionLabel: string;
    submitterRole: string;
    attackRoll: number | null;
    damageRoll: number | null;
    hit: string | null;
    targetHpBefore: number | null;
    targetHpAfter: number | null;
    notes: string | null;
    /** Per-die breakdown when the roll was made in-app. Already redacted by
     *  the server for hidden actors — like every other field here, this
     *  component displays, it never decides visibility. */
    rollDetail: string | null;
    redacted?: boolean;
  };
  type LogParticipant = { id: string; name: string };

  export let log: LogEntry[] = [];
  export let participants: LogParticipant[] = [];
  export let role: 'dm' | 'player';
  export let busy = false;

  const dispatch = createEventDispatcher<{ amend: LogEntry; remove: string }>();

  // Combat log filter — by participant only (incl. ad-hoc DM rows w/ null).
  let filterParticipantId: string | 'all' = 'all';
  // Filter rows; legacy isAmendment rows from before the amend-overwrite
  // change still get rendered as normal entries (they're real history).
  $: entries = log.filter((e) => {
    if (filterParticipantId !== 'all' && e.participantId !== filterParticipantId) return false;
    return true;
  });
</script>

{#if log.length > 0}
  <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4" data-testid="action-log">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-200">
        Action log ({entries.length}{#if entries.length !== log.length} of {log.length}{/if})
      </h2>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <label class="flex items-center gap-1">
          <span class="text-slate-500">Who:</span>
          <select
            class="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5"
            bind:value={filterParticipantId}
          >
            <option value="all">all</option>
            {#each participants as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        </label>
        {#if filterParticipantId !== 'all'}
          <button
            class="text-slate-500 hover:text-slate-200"
            on:click={() => (filterParticipantId = 'all')}
          >
            clear
          </button>
        {/if}
      </div>
    </div>
    <ol class="space-y-2 text-xs">
      {#each entries as entry (entry.id)}
        {@const actor = participants.find((p) => p.id === entry.participantId)}
        {@const target = participants.find((p) => p.id === entry.targetParticipantId)}
        <!-- The server redacts rows whose actor a player may not see
             ($lib/realtime/action-log) — `redacted` marks those. The extra
             "actor id we can't resolve" clause is defence in depth only:
             if a future surface ever ships an unredacted row, it still
             renders as a neutral entry instead of leaking the label. -->
        {@const withheld =
          role !== 'dm' && (entry.redacted === true || (!!entry.participantId && !actor))}
        <li class="rounded border border-slate-800 bg-slate-950/50 p-2">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="font-semibold text-slate-200">{actor?.name ?? '—'}</span>
            {#if withheld && !actor}
              <span class="text-slate-500 italic">Something happens…</span>
            {:else}
              <span class="text-slate-400">{entry.actionLabel}</span>
            {/if}
            {#if target}
              <span class="text-slate-500">→</span>
              <span class="text-slate-200">{target.name}</span>
            {/if}
            {#if entry.hit}
              <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{entry.hit}</span>
            {/if}
            {#if entry.attackRoll != null && !withheld}
              <span class="text-slate-500">atk {entry.attackRoll}</span>
            {/if}
            {#if entry.damageRoll != null && !withheld}
              <span class="text-red-300">dmg {entry.damageRoll}</span>
            {/if}
            {#if entry.targetHpBefore != null && entry.targetHpAfter != null && !withheld}
              <span class="font-mono text-[10px] text-slate-500">
                hp {entry.targetHpBefore}→{entry.targetHpAfter}
              </span>
            {/if}
            <span class="ml-auto text-[10px] text-slate-600">
              {entry.submitterRole}
            </span>
            {#if role === 'dm'}
              <button
                class="text-[10px] text-amber-300 hover:text-amber-200"
                on:click={() => dispatch('amend', entry)}
              >
                amend
              </button>
              <button
                class="text-[10px] text-red-300 hover:text-red-200 disabled:opacity-40"
                title="Remove this log entry"
                disabled={busy}
                on:click={() => dispatch('remove', entry.id)}
              >
                remove
              </button>
            {/if}
          </div>
          {#if entry.rollDetail && !withheld}
            <p class="mt-1 font-mono text-[10px] text-slate-500" title="How the roll was made">
              {entry.rollDetail}
            </p>
          {/if}
          {#if entry.notes && !withheld}
            <p class="mt-1 text-slate-400 italic">“{entry.notes}”</p>
          {/if}
        </li>
      {/each}
    </ol>
  </section>
{/if}
