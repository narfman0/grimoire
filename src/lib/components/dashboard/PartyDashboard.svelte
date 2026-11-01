<!--
  Party dashboard — the shared body of the spectator view (/watch/[token])
  and the table view (/c/[code]/table). One component, two wrappers: the
  wrappers own the data source; this owns the layout.

  Everything rendered here arrives already redacted to the player lens (see
  $lib/server/party-dashboard). This component never decides what a viewer
  may see; it only lays out what it was given. No pack description prose —
  names and numbers only.

  Layout: single column on a phone; party grid + side column (encounter
  strip, log) from `lg` up, which is the tablet-in-landscape table layout.

  `editable` (table view, DM only) adds quick damage/heal controls and
  dispatches `adjust`; the wrapper owns the request. The spectator wrapper
  never sets it, so the spectator view has no controls at all.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import HpBar from './HpBar.svelte';
  import QuickHpControl from './QuickHpControl.svelte';
  import HpBucketBadge from '$lib/components/HpBucketBadge.svelte';
  import type { HpBucket } from '$lib/realtime/reveals';
  import type { AdjustEvent, PartyDashboard } from '$lib/dashboard/types';
  import type { DashboardStatus } from '$lib/realtime/dashboard-channel';

  export let data: PartyDashboard;
  export let status: DashboardStatus = 'open';
  export let editable = false;
  /** Disables the controls while a request is in flight. */
  export let busy = false;

  const dispatch = createEventDispatcher<{ adjust: AdjustEvent }>();

  $: enc = data.encounter;

  function time(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  $: statusLabel =
    status === 'open'
      ? 'live'
      : status === 'gone'
        ? 'link no longer valid'
        : status === 'closed'
          ? 'closed'
          : 'reconnecting…';
</script>

<div class="mx-auto max-w-7xl">
  <header class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
    <h1 class="text-xl font-semibold text-slate-100 lg:text-2xl">{data.campaign.name}</h1>
    <span
      class="rounded-full border px-2 py-0.5 text-xs {status === 'open'
        ? 'border-emerald-700 text-emerald-300'
        : status === 'gone'
          ? 'border-red-700 text-red-300'
          : 'border-slate-700 text-slate-400'}"
      data-testid="dashboard-status"
    >
      {statusLabel}
    </span>
  </header>

  <div class="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <!-- Party -->
    <section aria-label="Party" class="order-2 lg:order-1">
      {#if data.party.length === 0}
        <p class="text-sm text-slate-500">No characters in this campaign yet.</p>
      {/if}
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {#each data.party as m (m.id)}
          <article
            class="rounded-lg border border-slate-800 bg-slate-900/60 p-3"
            data-testid="party-member"
          >
            <div class="mb-2 flex items-start gap-2">
              {#if m.portrait}
                <img src={m.portrait} alt="" class="h-10 w-10 rounded object-cover" />
              {/if}
              <div class="min-w-0 flex-1">
                <div class="truncate font-semibold text-slate-100">{m.name}</div>
                <div class="truncate text-xs text-slate-400">{m.classLine}</div>
              </div>
              {#if m.ac != null}
                <div
                  class="flex h-9 w-9 flex-col items-center justify-center rounded border border-slate-600 text-slate-100"
                  title="Armor Class"
                >
                  <span class="text-[9px] leading-none text-slate-400">AC</span>
                  <span class="font-mono text-sm leading-none">{m.ac}</span>
                </div>
              {/if}
            </div>

            {#if m.hasSheet}
              <HpBar current={m.currentHp} max={m.maxHp} temp={m.tempHp} />
              {#if editable}
                <QuickHpControl
                  label={m.name}
                  {busy}
                  on:apply={(e) =>
                    dispatch('adjust', { target: { kind: 'character', id: m.id }, ...e.detail })}
                />
              {/if}

              {#if m.deathSaves}
                <div class="mt-1 text-xs text-slate-300">
                  Death saves:
                  <span class="text-emerald-300">{'●'.repeat(m.deathSaves.successes)}{'○'.repeat(3 - m.deathSaves.successes)}</span>
                  <span class="text-red-300">{'●'.repeat(m.deathSaves.failures)}{'○'.repeat(3 - m.deathSaves.failures)}</span>
                </div>
              {/if}

              {#if m.conditions.length > 0 || m.concentrating}
                <div class="mt-2 flex flex-wrap gap-1">
                  {#if m.concentrating}
                    <span class="rounded border border-violet-700 bg-violet-900/30 px-1.5 py-0.5 text-[11px] text-violet-200">
                      ◎ {m.concentrating}
                    </span>
                  {/if}
                  {#each m.conditions as c}
                    <span class="rounded border border-amber-700 bg-amber-900/20 px-1.5 py-0.5 text-[11px] capitalize text-amber-200">{c}</span>
                  {/each}
                </div>
              {/if}

              {#if m.spellSlots.length > 0}
                <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300" aria-label="Spell slots">
                  {#each m.spellSlots as s}
                    <span title="Level {s.level} slots: {s.max - s.used} of {s.max} left">
                      <span class="text-slate-500">L{s.level}</span>
                      <span class="tracking-tighter text-sky-300">{'●'.repeat(Math.max(0, s.max - s.used))}</span><span class="tracking-tighter text-slate-600">{'○'.repeat(Math.min(s.max, s.used))}</span>
                    </span>
                  {/each}
                </div>
              {/if}

              {#if m.resources.length > 0}
                <div class="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-300">
                  {#each m.resources as r (r.id)}
                    <span>{r.name} <span class="font-mono text-slate-100">{r.current}/{r.max}</span></span>
                  {/each}
                </div>
              {/if}

              {#if m.inventory.length > 0}
                <details class="mt-2 text-xs">
                  <summary class="cursor-pointer text-slate-400">Inventory ({m.inventory.length})</summary>
                  <ul class="mt-1 space-y-0.5 text-slate-300">
                    {#each m.inventory as item}
                      <li>
                        {item.name}
                        {#if item.equipped}<span class="text-[10px] text-emerald-400">equipped</span>{/if}
                        {#if item.attuned}<span class="text-[10px] text-violet-300">attuned</span>{/if}
                        {#if item.charges != null}<span class="font-mono text-[10px] text-slate-400">{item.charges} ch</span>{/if}
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
            {:else}
              <p class="text-xs text-slate-500">No sheet yet.</p>
            {/if}
          </article>
        {/each}
      </div>
    </section>

    <aside class="order-1 space-y-4 lg:order-2">
      <!-- Encounter strip -->
      {#if enc}
        <section aria-label="Encounter" class="rounded-lg border border-red-900/60 bg-slate-900/60 p-3">
          <div class="mb-2 flex items-baseline justify-between">
            <h2 class="font-semibold text-slate-100">{enc.name}</h2>
            <span class="text-xs text-slate-400">Round {enc.round}</span>
          </div>
          <ol class="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {#each enc.combatants as c (c.id)}
              <li
                class="{editable ? 'min-w-[16rem]' : 'min-w-[9rem]'} rounded border px-2 py-1.5 lg:min-w-0 {c.id === enc.activeParticipantId
                  ? 'border-amber-400 bg-amber-900/20'
                  : 'border-slate-800 bg-slate-950/40'}"
                aria-current={c.id === enc.activeParticipantId ? 'step' : undefined}
                data-testid="combatant"
              >
                <div class="flex items-baseline justify-between gap-2">
                  <span class="truncate text-sm {c.kind === 'pc' ? 'text-sky-200' : 'text-slate-100'}">
                    {#if c.id === enc.activeParticipantId}<span class="text-amber-300">▶ </span>{/if}{c.name}
                  </span>
                  <span class="font-mono text-xs text-slate-500" title="Initiative">{c.initiative ?? '—'}</span>
                </div>
                <div class="mt-1">
                  {#if c.maxHp != null}
                    <HpBar current={c.currentHp} max={c.maxHp} temp={c.tempHp} />
                  {:else}
                    <HpBucketBadge value={c.hpBucket as HpBucket} />
                  {/if}
                </div>
                {#if c.conditions.length > 0 || c.concentrating}
                  <div class="mt-1 flex flex-wrap gap-1">
                    {#if c.concentrating}
                      <span class="text-[10px] text-violet-300">◎ {c.concentrating}</span>
                    {/if}
                    {#each c.conditions as cond}
                      <span class="text-[10px] capitalize text-amber-300">{cond}</span>
                    {/each}
                  </div>
                {/if}
                {#if editable && enc}
                  {@const encounterId = enc.id}
                  <QuickHpControl
                    label={c.name}
                    {busy}
                    on:apply={(e) =>
                      dispatch('adjust', {
                        target: { kind: 'participant', id: c.id, encounterId },
                        ...e.detail
                      })}
                  />
                {/if}
              </li>
            {/each}
          </ol>
        </section>
      {/if}

      <!-- Recent log -->
      <section aria-label="Recent log" class="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Recent</h2>
        {#if data.log.length === 0}
          <p class="text-xs text-slate-500">Nothing logged yet.</p>
        {:else}
          <ul class="max-h-[60vh] space-y-1.5 overflow-y-auto text-xs">
            {#each data.log as e (e.id)}
              <li class="text-slate-300" data-testid="log-entry">
                <span class="font-mono text-slate-500">{time(e.at)}</span>
                <span class={e.redacted ? 'italic text-slate-400' : ''}>{e.summary}</span>
                {#if e.hpBefore != null && e.hpAfter != null}
                  <span class="font-mono text-slate-400">HP {e.hpBefore}→{e.hpAfter}</span>
                {/if}
                {#if e.encounterName}
                  <span class="text-slate-600">· {e.encounterName}{e.round ? ` r${e.round}` : ''}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </aside>
  </div>
</div>
