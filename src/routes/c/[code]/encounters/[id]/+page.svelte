<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import {
    connectEncounterDoc,
    setEncounterTurn,
    clearTurnPlan,
    applyDamage as doApplyDamage,
    applyHeal as doApplyHeal,
    type ConnectedEncounter,
    type EncounterSnapshot,
    type ParticipantHp
  } from '$lib/realtime/encounter-doc';

  type HitOutcome = '' | 'hit' | 'miss' | 'crit' | 'fumble' | 'heal';
  import type { PageData } from './$types';

  export let data: PageData;

  let busy = false;

  // M3.3 — realtime encounter state. We connect to room `encounter:<id>` and
  // mirror round + activeParticipantId via a Y.Doc. The DM's "next turn"
  // button writes to the Y.Doc (one shot); every other connected tab
  // observes the update within a tick. We fall back to the SSR snapshot
  // when the sync server is offline.
  let conn: ConnectedEncounter | null = null;
  let liveState: EncounterSnapshot | null = null;
  let connStatus: 'connecting' | 'open' | 'closed' | 'auth-failed' = 'connecting';

  onMount(() => {
    if (!data.syncToken) return;
    conn = connectEncounterDoc({ token: data.syncToken, encounterId: data.encounter.id });
    const unsubState = conn.state.subscribe((v) => (liveState = v));
    const unsubStatus = conn.status.subscribe((s) => {
      connStatus = s;
      // When the server flushed our last update back to the row, the page
      // data may be stale (participants table HP, etc.). Rare event, but
      // refresh on (re)connect so SSR-only fields stay accurate.
      if (s === 'open') invalidateAll().catch(() => {});
    });
    return () => {
      unsubState();
      unsubStatus();
    };
  });

  onDestroy(() => {
    conn?.destroy();
    conn = null;
  });

  // Effective values: prefer Y.Doc snapshot when connected, fall back to SSR.
  $: liveRound = liveState?.round ?? data.encounter.round;
  $: liveActive = liveState?.activeParticipantId ?? data.encounter.activeParticipantId;
  $: livePlans = liveState?.plans ?? {};
  $: liveHpMap = liveState?.participantHp ?? {};

  function clearPlan(participantId: string) {
    if (!conn) return;
    clearTurnPlan(conn.ydoc, participantId);
  }

  /** Return live HP for a participant, falling back to the SSR row when the
   *  Y.Doc hasn't seeded yet (first paint, or sync server offline). */
  function hpFor(p: { id: string; currentHp: number | null; tempHp: number; conditions: string[] }):
    ParticipantHp {
    const live = liveHpMap[p.id];
    if (live) return live;
    return { currentHp: p.currentHp, tempHp: p.tempHp ?? 0, conditions: p.conditions ?? [] };
  }

  /** Map participant.id → SSR HP seed used when the Y.Doc has no entry yet. */
  function seedFor(p: { currentHp: number | null; tempHp: number; conditions: string[] }):
    ParticipantHp {
    return { currentHp: p.currentHp, tempHp: p.tempHp ?? 0, conditions: p.conditions ?? [] };
  }

  let hpInputs: Record<string, number> = {};

  // ---- DM resolve flow (M3.5c) ----
  // The DM can resolve any participant's plan (or no-plan) directly: pick
  // an action label (defaults to the plan's), declare rolls, apply HP. We
  // route through the same /log endpoint as players; submitter_role is set
  // server-side from the caller's membership.
  let resolveForParticipantId: string | null = null;
  let resolveActionId = '';
  let resolveActionLabel = '';
  let resolveTargetId: string | null = null;
  let resolveAttack: number | null = null;
  let resolveDamage: number | null = null;
  let resolveHit: HitOutcome = '';
  let resolveNotes = '';
  let resolveSubmitting = false;
  let resolveError: string | null = null;

  function openResolve(p: { id: string; name: string }) {
    resolveForParticipantId = p.id;
    const plan = livePlans[p.id];
    if (plan) {
      resolveActionId = plan.actionId;
      resolveActionLabel = plan.actionLabel;
      resolveTargetId = plan.targetParticipantId;
      resolveNotes = plan.notes;
    } else {
      resolveActionId = 'dm-adhoc';
      resolveActionLabel = 'Ad-hoc';
      resolveTargetId = null;
      resolveNotes = '';
    }
    resolveAttack = null;
    resolveDamage = null;
    resolveHit = '';
    resolveError = null;
  }

  function closeResolve() {
    resolveForParticipantId = null;
    resolveError = null;
  }

  async function submitDmResolve() {
    if (!conn || !resolveForParticipantId) return;
    const round = liveState?.round ?? data.encounter.round;
    const target = resolveTargetId
      ? data.participants.find((p) => p.id === resolveTargetId) ?? null
      : null;

    let targetHpBefore: number | null = null;
    let targetHpAfter: number | null = null;
    if (
      target &&
      target.kind !== 'pc' &&
      typeof resolveDamage === 'number' &&
      resolveDamage > 0 &&
      (resolveHit === 'hit' || resolveHit === 'crit' || resolveHit === 'heal')
    ) {
      const seed = seedFor(target);
      targetHpBefore = seed.currentHp;
      const next =
        resolveHit === 'heal'
          ? doApplyHeal(conn.ydoc, target.id, resolveDamage, target.maxHp, seed)
          : doApplyDamage(conn.ydoc, target.id, resolveDamage, seed);
      targetHpAfter = next.currentHp;
    }

    resolveSubmitting = true;
    try {
      const res = await fetch(`/api/encounters/${data.encounter.id}/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId: resolveForParticipantId,
          targetParticipantId: resolveTargetId,
          actionId: resolveActionId,
          actionLabel: resolveActionLabel,
          round,
          attackRoll: resolveAttack,
          damageRoll: resolveDamage,
          hit: resolveHit || null,
          targetHpBefore,
          targetHpAfter,
          notes: resolveNotes.slice(0, 500) || null
        })
      });
      if (!res.ok) {
        resolveError = `log: ${res.status} ${(await res.text()).slice(0, 200)}`;
        return;
      }
      // Clear the plan if there was one.
      if (livePlans[resolveForParticipantId]) {
        clearTurnPlan(conn.ydoc, resolveForParticipantId);
      }
      closeResolve();
      await invalidateAll(); // refresh log view
    } finally {
      resolveSubmitting = false;
    }
  }

  // ---- DM amend (M3.5c) ----
  // Amendments are new log rows; we pre-fill the form from the prior entry
  // and POST with amendsLogId set. We optionally revert HP by applying the
  // reverse delta if the original wrote a damage change.
  let amendingLogId: string | null = null;

  function openAmend(entry: (typeof data.actionLog)[number]) {
    amendingLogId = entry.id;
    resolveForParticipantId = entry.participantId;
    resolveActionId = entry.actionId;
    resolveActionLabel = entry.actionLabel;
    resolveTargetId = entry.targetParticipantId;
    resolveAttack = entry.attackRoll;
    resolveDamage = entry.damageRoll;
    resolveHit = (entry.hit ?? '') as typeof resolveHit;
    resolveNotes = entry.notes ?? '';
    resolveError = null;
  }

  /** Group log entries: originals (top-level) and amendments by amendsLogId. */
  $: logOriginals = data.actionLog.filter((e) => !e.isAmendment);
  $: amendsByOriginal = (() => {
    const m = new Map<string, typeof data.actionLog>();
    for (const e of data.actionLog) {
      if (!e.isAmendment || !e.amendsLogId) continue;
      const arr = m.get(e.amendsLogId) ?? [];
      arr.push(e);
      m.set(e.amendsLogId, arr);
    }
    return m;
  })();

  async function submitAmend() {
    if (!conn || !amendingLogId || !resolveForParticipantId) return;
    const round = liveState?.round ?? data.encounter.round;

    // Revert the prior entry's HP change (if any) before applying the new
    // outcome. Revert = apply the inverse delta to the *current* live HP,
    // so amendments don't stack on top of the prior change. Other actions
    // that hit the target between the original and the amend are preserved.
    const prior = data.actionLog.find((e) => e.id === amendingLogId);
    if (
      prior &&
      prior.targetParticipantId &&
      prior.targetHpBefore != null &&
      prior.targetHpAfter != null
    ) {
      const priorTarget = data.participants.find((p) => p.id === prior.targetParticipantId);
      if (priorTarget && priorTarget.kind !== 'pc') {
        const delta = prior.targetHpBefore - prior.targetHpAfter;
        const seed = seedFor(priorTarget);
        if (delta > 0) {
          // Prior entry dealt damage → revert with heal
          doApplyHeal(conn.ydoc, priorTarget.id, delta, priorTarget.maxHp, seed);
        } else if (delta < 0) {
          // Prior entry healed → revert with damage
          doApplyDamage(conn.ydoc, priorTarget.id, -delta, seed);
        }
      }
    }

    // Apply the new outcome (same logic as submitDmResolve).
    const target = resolveTargetId
      ? data.participants.find((p) => p.id === resolveTargetId) ?? null
      : null;
    let targetHpBefore: number | null = null;
    let targetHpAfter: number | null = null;
    if (
      target &&
      target.kind !== 'pc' &&
      typeof resolveDamage === 'number' &&
      resolveDamage > 0 &&
      (resolveHit === 'hit' || resolveHit === 'crit' || resolveHit === 'heal')
    ) {
      // Re-read seed *after* the revert so we capture the corrected starting HP.
      const live = liveState?.participantHp[target.id];
      const seed: ParticipantHp = live ?? seedFor(target);
      targetHpBefore = seed.currentHp;
      const next =
        resolveHit === 'heal'
          ? doApplyHeal(conn.ydoc, target.id, resolveDamage, target.maxHp, seed)
          : doApplyDamage(conn.ydoc, target.id, resolveDamage, seed);
      targetHpAfter = next.currentHp;
    }

    resolveSubmitting = true;
    try {
      const res = await fetch(`/api/encounters/${data.encounter.id}/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId: resolveForParticipantId,
          targetParticipantId: resolveTargetId,
          actionId: resolveActionId,
          actionLabel: resolveActionLabel,
          round,
          attackRoll: resolveAttack,
          damageRoll: resolveDamage,
          hit: resolveHit || null,
          targetHpBefore,
          targetHpAfter,
          notes: resolveNotes.slice(0, 500) || null,
          amendsLogId: amendingLogId
        })
      });
      if (!res.ok) {
        resolveError = `amend: ${res.status} ${(await res.text()).slice(0, 200)}`;
        return;
      }
      amendingLogId = null;
      closeResolve();
      await invalidateAll();
    } finally {
      resolveSubmitting = false;
    }
  }

  async function patchParticipantHp(participantId: string, currentHp: number, tempHp: number) {
    await fetch(`/api/participants/${participantId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentHp, tempHp })
    });
  }

  async function dmDamage(p: { id: string; currentHp: number | null; tempHp: number; conditions: string[] }) {
    const n = Math.max(0, Math.floor(hpInputs[p.id] ?? 0));
    if (n === 0) return;
    const seed = seedFor(p);
    if (conn && connStatus === 'open') {
      doApplyDamage(conn.ydoc, p.id, n, seed);
    } else {
      // REST fallback when sync is offline.
      const tempAbsorbed = Math.min(seed.tempHp, n);
      const nextCurrent = seed.currentHp == null ? null : Math.max(0, seed.currentHp - (n - tempAbsorbed));
      const nextTemp = seed.tempHp - tempAbsorbed;
      await patchParticipantHp(p.id, nextCurrent ?? 0, nextTemp);
      await invalidateAll();
    }
    hpInputs[p.id] = 0;
    hpInputs = hpInputs;
  }

  async function dmHeal(p: {
    id: string;
    currentHp: number | null;
    maxHp: number | null;
    tempHp: number;
    conditions: string[];
  }) {
    const n = Math.max(0, Math.floor(hpInputs[p.id] ?? 0));
    if (n === 0) return;
    const seed = seedFor(p);
    if (conn && connStatus === 'open') {
      doApplyHeal(conn.ydoc, p.id, n, p.maxHp, seed);
    } else {
      const capped =
        seed.currentHp == null
          ? null
          : p.maxHp != null
            ? Math.min(p.maxHp, seed.currentHp + n)
            : seed.currentHp + n;
      await patchParticipantHp(p.id, capped ?? 0, seed.tempHp);
      await invalidateAll();
    }
    hpInputs[p.id] = 0;
    hpInputs = hpInputs;
  }

  // Add-participant draft state
  let newKind: 'pc' | 'npc' | 'monster' = 'monster';
  let newName = '';
  let newCharacterId = data.campaignCharacters[0]?.id ?? '';
  let newMonsterSlug = data.monsterOptions[0]?.slug ?? '';
  let newInitiative: number | null = null;
  let newMaxHp: number | null = null;

  // When the picked monster changes, pre-fill name + HP from the statblock.
  // Use on:change rather than $: to avoid clobbering DM-overridden values.
  function selectMonster(e: Event) {
    const slug = (e.target as HTMLSelectElement).value;
    newMonsterSlug = slug;
    const opt = data.monsterOptions.find((m) => m.slug === slug);
    if (opt) {
      newName = opt.name;
      newMaxHp = opt.maxHp ?? null;
    }
  }

  // Initialize defaults from the first monster on mount so the form is filled.
  $: if (newKind === 'monster' && newMonsterSlug && !newName) {
    const opt = data.monsterOptions.find((m) => m.slug === newMonsterSlug);
    if (opt) {
      newName = opt.name;
      newMaxHp = opt.maxHp ?? null;
    }
  }

  async function addParticipant() {
    if (newKind === 'pc' && !newCharacterId) return;
    busy = true;
    try {
      const body: Record<string, unknown> = {
        name: newKind === 'pc'
          ? (data.campaignCharacters.find((c) => c.id === newCharacterId)?.name ?? newName)
          : newName,
        kind: newKind,
        initiative: newInitiative ?? undefined,
        maxHp: newMaxHp ?? undefined,
        currentHp: newMaxHp ?? undefined
      };
      if (newKind === 'pc') body.characterId = newCharacterId;
      if (newKind === 'monster' && newMonsterSlug) body.statblockSlug = newMonsterSlug;
      const res = await fetch(`/api/encounters/${data.encounter.id}/participants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        newName = '';
        newInitiative = null;
        newMaxHp = null;
        await invalidateAll();
      }
    } finally {
      busy = false;
    }
  }

  async function updateInitiative(id: string, value: number | null) {
    busy = true;
    try {
      await fetch(`/api/participants/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initiative: value })
      });
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function removeParticipant(id: string) {
    if (!confirm('Remove this participant?')) return;
    busy = true;
    try {
      await fetch(`/api/participants/${id}`, { method: 'DELETE' });
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  function inputValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  const KINDS: Array<'pc' | 'npc' | 'monster'> = ['pc', 'npc', 'monster'];

  async function advanceTurn(direction: 1 | -1) {
    if (data.role !== 'dm') return;
    const ordered = [...data.participants];
    if (ordered.length === 0) return;
    const currentActive = liveActive;
    const currentRound = liveRound;
    const idx = ordered.findIndex((p) => p.id === currentActive);
    let nextIdx = idx + direction;
    if (nextIdx < 0) nextIdx = ordered.length - 1;
    if (nextIdx >= ordered.length) nextIdx = 0;
    const wrapped = direction === 1 && idx === ordered.length - 1;
    const baseRound = currentRound === 0 ? 1 : currentRound;
    const newRound = wrapped ? baseRound + 1 : baseRound;
    const nextActive = ordered[nextIdx].id;

    // Preferred path: write via the Y.Doc — propagates to all connected
    // clients (other DM tabs + players) within a tick, and the sync-server
    // flushes the change to the encounters row on the next debounced store.
    if (conn && connStatus === 'open') {
      setEncounterTurn(conn.ydoc, { round: newRound, activeParticipantId: nextActive });
      return;
    }

    // Fallback: REST PATCH when the sync server is offline.
    busy = true;
    try {
      await fetch(`/api/encounters/${data.encounter.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activeParticipantId: nextActive, round: newRound })
      });
      await invalidateAll();
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{data.encounter.name} — {data.campaign.name}</title>
</svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    <h1 class="text-2xl font-semibold">{data.encounter.name}</h1>
    <p class="text-sm text-slate-400">
      <span class="rounded border px-1.5 py-0.5 text-xs uppercase tracking-wide
        {data.encounter.status === 'live'
          ? 'border-emerald-700 text-emerald-300'
          : data.encounter.status === 'staging'
            ? 'border-slate-700 text-slate-300'
            : 'border-slate-800 text-slate-500'}">
        {data.encounter.status}
      </span>
      {#if data.encounter.status === 'live'}
        &middot; round {liveRound}
      {/if}
      {#if conn}
        <span
          class="ml-2 inline-block h-2 w-2 rounded-full {connStatus === 'open'
            ? 'bg-emerald-500'
            : connStatus === 'connecting'
              ? 'bg-amber-500'
              : 'bg-slate-600'}"
          title={connStatus === 'open' ? 'live sync connected' : `sync: ${connStatus}`}
        ></span>
      {/if}
    </p>
  </div>
  <a class="text-xs text-slate-400 hover:text-slate-200" href={`/c/${data.campaign.code}/encounters`}>
    ← all encounters
  </a>
</header>

{#if data.encounter.status === 'live' && data.role === 'dm'}
  <section class="mb-6 flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
    <span class="text-emerald-200">Turn controls:</span>
    <button class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={() => advanceTurn(-1)} disabled={busy}>
      ← Prev
    </button>
    <button class="rounded border border-emerald-700 px-2 py-0.5 hover:bg-emerald-900/40" on:click={() => advanceTurn(1)} disabled={busy}>
      Next turn →
    </button>
    <span class="ml-auto text-xs text-slate-500">
      {#if connStatus === 'open'}
        synced live · others see your turn changes in real time
      {:else}
        offline · falling back to REST
      {/if}
    </span>
  </section>
{/if}

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <h2 class="mb-3 text-sm font-semibold text-slate-200">Participants ({data.participants.length})</h2>

  {#if data.participants.length === 0}
    <p class="mb-3 text-sm text-slate-400">No participants yet.</p>
  {:else}
    <ul class="mb-3 divide-y divide-slate-800">
      {#each data.participants as p (p.id)}
        {@const isActive = p.id === liveActive}
        {@const plan = livePlans[p.id]}
        <li class="flex flex-wrap items-center gap-3 py-2 text-sm {isActive ? 'rounded bg-emerald-950/30 px-2' : ''}">
          <span class="font-mono text-xs text-slate-500 w-8">
            {#if p.initiative != null}
              {p.initiative}
            {:else}
              —
            {/if}
          </span>
          <span class="rounded border border-slate-700 px-1.5 py-0.5 text-xs uppercase tracking-wide text-slate-400 w-16 text-center">
            {p.kind}
          </span>
          <span class="flex-1 font-medium">
            {#if p.characterId}
              <a class="hover:text-emerald-300" href={`/c/${data.campaign.code}/character/${p.characterId}`}>
                {p.name}
              </a>
            {:else}
              {p.name}
            {/if}
          </span>
          {#if p.maxHp != null}
            {@const live = hpFor(p)}
            <span class="font-mono text-xs text-slate-400">
              {live.currentHp ?? '—'} / {p.maxHp}
              {#if live.tempHp > 0}
                <span class="text-emerald-300">+{live.tempHp}</span>
              {/if}
            </span>
          {/if}
          {#if data.role === 'dm'}
            {#if p.maxHp != null && p.kind !== 'pc'}
              <input
                type="number"
                min="0"
                class="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-xs"
                placeholder="±hp"
                bind:value={hpInputs[p.id]}
              />
              <button
                class="rounded bg-red-700/60 px-1.5 py-0.5 text-xs hover:bg-red-700"
                title="Apply damage"
                on:click={() => dmDamage(p)}
              >
                −
              </button>
              <button
                class="rounded bg-emerald-700/60 px-1.5 py-0.5 text-xs hover:bg-emerald-700"
                title="Apply heal"
                on:click={() => dmHeal(p)}
              >
                +
              </button>
            {/if}
            <input
              type="number"
              class="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-xs"
              placeholder="init"
              value={p.initiative ?? ''}
              on:change={(e) => {
                const v = inputValue(e);
                updateInitiative(p.id, v === '' ? null : Number(v));
              }}
            />
            <button class="text-xs text-slate-500 hover:text-red-400" on:click={() => removeParticipant(p.id)} disabled={busy}>
              ×
            </button>
          {/if}
          {#if plan}
            <div class="basis-full pl-12 text-xs text-slate-400">
              <span class="rounded bg-amber-900/30 px-1.5 py-0.5 text-amber-200">plan</span>
              <span class="ml-1 text-slate-200">{plan.actionLabel}</span>
              {#if plan.targetParticipantId}
                {@const tgt = data.participants.find((q) => q.id === plan.targetParticipantId)}
                {#if tgt}
                  <span class="text-slate-500"> → </span>
                  <span class="text-slate-200">{tgt.name}</span>
                {/if}
              {/if}
              {#if plan.notes}
                <span class="text-slate-500"> · </span>
                <span class="italic text-slate-300">{plan.notes}</span>
              {/if}
              {#if data.role === 'dm'}
                <button
                  class="ml-2 rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-900/40"
                  on:click={() => openResolve(p)}
                >
                  resolve
                </button>
                <button
                  class="ml-1 text-[10px] text-slate-500 hover:text-red-400"
                  on:click={() => clearPlan(p.id)}
                >
                  clear
                </button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.role === 'dm'}
    <div class="rounded border border-slate-800 bg-slate-950/30 p-3 text-sm">
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add participant</h3>
      <div class="mb-2 flex gap-3">
        {#each KINDS as k}
          <label class="flex items-center gap-1 text-xs">
            <input type="radio" bind:group={newKind} value={k} />
            <span>{k.toUpperCase()}</span>
          </label>
        {/each}
      </div>
      <div class="flex flex-wrap items-end gap-2">
        {#if newKind === 'pc'}
          {#if data.campaignCharacters.length === 0}
            <p class="text-xs text-amber-300">No characters in this campaign yet.</p>
          {:else}
            <label class="text-xs">
              <span class="block text-slate-400">Character</span>
              <select class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={newCharacterId}>
                {#each data.campaignCharacters as c}
                  <option value={c.id}>{c.name}</option>
                {/each}
              </select>
            </label>
          {/if}
        {:else if newKind === 'monster'}
          <label class="text-xs">
            <span class="block text-slate-400">From pack</span>
            {#if data.monsterOptions.length === 0}
              <p class="text-amber-300">No monsters loaded.</p>
            {:else}
              <select
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                value={newMonsterSlug}
                on:change={selectMonster}
              >
                {#each data.monsterOptions as m}
                  <option value={m.slug}>{m.name} (CR {m.cr})</option>
                {/each}
              </select>
            {/if}
          </label>
          <label class="text-xs">
            <span class="block text-slate-400">Name (override)</span>
            <input class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={newName} />
          </label>
          <label class="text-xs">
            <span class="block text-slate-400">Max HP</span>
            <input
              type="number"
              class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
              bind:value={newMaxHp}
              min="1"
            />
          </label>
        {:else}
          <label class="text-xs">
            <span class="block text-slate-400">Name</span>
            <input class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" placeholder="Captured noble, etc." bind:value={newName} />
          </label>
          <label class="text-xs">
            <span class="block text-slate-400">Max HP</span>
            <input
              type="number"
              class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
              bind:value={newMaxHp}
              min="1"
            />
          </label>
        {/if}
        <label class="text-xs">
          <span class="block text-slate-400">Initiative</span>
          <input
            type="number"
            class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
            bind:value={newInitiative}
          />
        </label>
        <button
          class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
          on:click={addParticipant}
          disabled={busy || (newKind !== 'pc' && !newName) || (newKind === 'pc' && !newCharacterId)}
        >
          Add
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-500">
        Monsters pre-fill HP from the SRD statblock. Override Max HP for
        weakened or empowered variants. Full monster-side action resolution
        (attack rolls, multiattack, etc.) is on the roadmap.
      </p>
    </div>
  {/if}
</section>

{#if resolveForParticipantId && data.role === 'dm'}
  {@const acting = data.participants.find((q) => q.id === resolveForParticipantId)}
  <section
    class="mb-6 rounded-lg border p-4 {amendingLogId
      ? 'border-amber-700 bg-amber-950/30'
      : 'border-emerald-700 bg-emerald-950/30'}"
  >
    <h2 class="mb-3 text-sm font-semibold">
      {amendingLogId ? 'Amend log entry' : 'Resolve turn'}
      {#if acting}
        — <span class="text-slate-200">{acting.name}</span>
      {/if}
    </h2>
    <div class="flex flex-wrap items-end gap-2 text-sm">
      <label class="text-xs">
        <span class="block text-slate-400">Action label</span>
        <input
          class="w-44 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={resolveActionLabel}
        />
      </label>
      <label class="text-xs">
        <span class="block text-slate-400">Target</span>
        <select
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={resolveTargetId}
        >
          <option value={null}>— none —</option>
          {#each data.participants as q}
            {#if q.id !== resolveForParticipantId}
              <option value={q.id}>{q.name} ({q.kind})</option>
            {/if}
          {/each}
        </select>
      </label>
      <label class="text-xs">
        <span class="block text-slate-400">Attack</span>
        <input
          type="number"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
          bind:value={resolveAttack}
        />
      </label>
      <label class="text-xs">
        <span class="block text-slate-400">Damage</span>
        <input
          type="number"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
          bind:value={resolveDamage}
        />
      </label>
      <label class="text-xs">
        <span class="block text-slate-400">Outcome</span>
        <select
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={resolveHit}
        >
          <option value="">—</option>
          <option value="hit">hit</option>
          <option value="crit">crit</option>
          <option value="miss">miss</option>
          <option value="fumble">fumble</option>
          <option value="heal">heal</option>
        </select>
      </label>
      <label class="flex-1 text-xs">
        <span class="block text-slate-400">Notes</span>
        <input
          class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          maxlength="500"
          bind:value={resolveNotes}
        />
      </label>
      <button
        class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
        on:click={amendingLogId ? submitAmend : submitDmResolve}
        disabled={resolveSubmitting}
      >
        {resolveSubmitting ? '…' : amendingLogId ? 'Save amendment' : 'Submit'}
      </button>
      <button
        class="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
        on:click={() => {
          amendingLogId = null;
          closeResolve();
        }}
        disabled={resolveSubmitting}
      >
        Cancel
      </button>
    </div>
    {#if resolveError}
      <p class="mt-2 text-xs text-red-300">{resolveError}</p>
    {/if}
    <p class="mt-2 text-xs text-slate-500">
      Damage auto-applies to non-PC targets on hit/crit. PC HP changes happen
      on the target player's sheet. Amendments don't auto-revert HP yet — adjust
      with the ±buttons separately.
    </p>
  </section>
{/if}

{#if data.actionLog.length > 0}
  <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-sm font-semibold text-slate-200">
      Action log ({data.actionLog.length})
    </h2>
    <ol class="space-y-2 text-xs">
      {#each logOriginals as entry (entry.id)}
        {@const actor = data.participants.find((p) => p.id === entry.participantId)}
        {@const target = data.participants.find((p) => p.id === entry.targetParticipantId)}
        {@const amends = amendsByOriginal.get(entry.id) ?? []}
        <li class="rounded border border-slate-800 bg-slate-950/50 p-2">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="font-mono text-slate-500">R{entry.round}</span>
            <span class="font-semibold text-slate-200">{actor?.name ?? '—'}</span>
            <span class="text-slate-400">{entry.actionLabel}</span>
            {#if target}
              <span class="text-slate-500">→</span>
              <span class="text-slate-200">{target.name}</span>
            {/if}
            {#if entry.hit}
              <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{entry.hit}</span>
            {/if}
            {#if entry.attackRoll != null}
              <span class="text-slate-500">atk {entry.attackRoll}</span>
            {/if}
            {#if entry.damageRoll != null}
              <span class="text-red-300">dmg {entry.damageRoll}</span>
            {/if}
            {#if entry.targetHpBefore != null && entry.targetHpAfter != null}
              <span class="font-mono text-[10px] text-slate-500">
                hp {entry.targetHpBefore}→{entry.targetHpAfter}
              </span>
            {/if}
            <span class="ml-auto text-[10px] text-slate-600">
              {entry.submitterRole}
            </span>
            {#if data.role === 'dm'}
              <button
                class="text-[10px] text-amber-300 hover:text-amber-200"
                on:click={() => openAmend(entry)}
              >
                amend
              </button>
            {/if}
          </div>
          {#if entry.notes}
            <p class="mt-1 text-slate-400 italic">“{entry.notes}”</p>
          {/if}
          {#each amends as amend (amend.id)}
            <div class="ml-4 mt-1 rounded border-l-2 border-amber-700 bg-amber-950/20 p-1.5 pl-2">
              <div class="flex flex-wrap items-baseline gap-2">
                <span class="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">amend</span>
                <span class="text-slate-400">{amend.actionLabel}</span>
                {#if amend.hit}
                  <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{amend.hit}</span>
                {/if}
                {#if amend.attackRoll != null}
                  <span class="text-slate-500">atk {amend.attackRoll}</span>
                {/if}
                {#if amend.damageRoll != null}
                  <span class="text-red-300">dmg {amend.damageRoll}</span>
                {/if}
              </div>
              {#if amend.notes}
                <p class="mt-1 text-slate-400 italic">“{amend.notes}”</p>
              {/if}
            </div>
          {/each}
        </li>
      {/each}
    </ol>
  </section>
{/if}

<p class="text-xs text-slate-500">
  M3.5: HP syncs live across clients; player & DM can resolve plans; the
  action log captures every submission, with DM amendments threaded under
  each original. Heal actions still resolve as damage labels — a future
  pass adds explicit heal-type resolution + auto-revert on amend.
</p>
