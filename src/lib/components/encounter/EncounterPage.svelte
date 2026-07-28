<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { api } from '$lib/client/api';
  import RevealChip from '$lib/components/RevealChip.svelte';
  import HpBucketBadge from '$lib/components/HpBucketBadge.svelte';
  import ParticipantRowCard from '$lib/components/ParticipantRowCard.svelte';
  import PlanPanel from '$lib/components/PlanPanel.svelte';
  import MonsterStatblockView from '$lib/components/MonsterStatblockView.svelte';
  import ActionLogSection from './ActionLogSection.svelte';
  import AddParticipantModal from './AddParticipantModal.svelte';
  import ConcentrationSavePrompt from './ConcentrationSavePrompt.svelte';
  import ReactionPromptQueue from './ReactionPromptQueue.svelte';
  import ResolvePanel from './ResolvePanel.svelte';
  import { COMMON_CONDITIONS, impliedBy, CONDITION_DESCRIPTIONS } from '$lib/rules/conditions';
  import { costLabel, slotForCost } from '$lib/rules/action-cost';
  import { applyDamageDelta, applyHealDelta } from '$lib/rules/hp';
  import {
    conditionsForParticipant,
    toggleArrayValue,
    patchPcWithMirror
  } from '$lib/encounter/conditions';
  import { hpBucket as computeHpBucket } from '$lib/realtime/reveals';
  import type { LiveParticipant } from '$lib/realtime/participants';
  import {
    connectEncounter,
    type ConnectedEncounter,
    type EncounterSnapshot,
    type ParticipantHp,
    type TurnPlan
  } from '$lib/realtime/encounter-channel';
  import {
    applyHpAndLog,
    revertPriorHpChange,
    firedEventsFor,
    effectiveDamage,
    downgradeCritForTarget,
    reactionPromptsForResolution,
    type HitOutcome,
    type ResolveTarget
  } from '$lib/realtime/resolve';
  import type { EncounterPageData } from '$lib/server/encounter-page';

  export let data: EncounterPageData;
  /** Route-specific link targets — the two encounter routes differ only in
   *  URL scheme (/c/[code]/... vs /campaigns/[dmUsername]/[slug]/...). */
  export let encountersHref: string;
  /** Sheet link for a PC participant's character; undefined renders no link. */
  export let sheetHref: (characterId: string) => string | undefined;

  let busy = false;

  // Live encounter state — SSE channel layered on top of the SSR seed so
  // the chooser, HP widgets, and plan badges render correctly on first
  // paint without waiting for the stream to catch up.
  let conn: ConnectedEncounter | null = null;
  let liveState: EncounterSnapshot | null = null;
  let connStatus: 'connecting' | 'open' | 'closed' = 'connecting';

  onMount(() => {
    const seedPlans: Record<string, TurnPlan> = {};
    for (const [pid, plan] of Object.entries(data.participantPlans ?? {})) {
      if (plan && typeof plan === 'object') seedPlans[pid] = plan as TurnPlan;
    }
    const seedHp: Record<string, ParticipantHp> = {};
    for (const p of data.participants) {
      const stats = data.participantPcStats?.[p.id];
      const conditions = (p.conditions ?? []) as string[];
      const concentrating =
        p.kind === 'pc'
          ? data.participantPcConcentrating?.[p.id] ?? null
          : data.participantNonPcConcentrating?.[p.id] ?? null;
      seedHp[p.id] = {
        currentHp: stats ? stats.hp.current : p.currentHp,
        tempHp: stats ? stats.hp.temp : (p.tempHp ?? 0),
        conditions,
        concentrating
      };
    }
    conn = connectEncounter({
      encounterId: data.encounter.id,
      seed: {
        round: data.encounter.round,
        status: data.encounter.status as EncounterSnapshot['status'],
        activeParticipantId: data.encounter.activeParticipantId,
        plans: seedPlans,
        participantHp: seedHp
      }
    });
    const unsubState = conn.state.subscribe((v) => (liveState = v));
    const unsubStatus = conn.status.subscribe((s) => {
      connStatus = s;
      // Refresh SSR-only fields (party makeup, monster picker options) on
      // reconnect so they don't drift from server truth.
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

  // Effective values: SSE snapshot when available, fall back to SSR seed.
  $: liveRound = liveState?.round ?? data.encounter.round;
  $: liveActive = liveState?.activeParticipantId ?? data.encounter.activeParticipantId;
  $: liveStatus = liveState?.status ?? data.encounter.status;
  $: livePlans = liveState?.plans ?? {};
  $: liveHpMap = liveState?.participantHp ?? {};

  // --- live participant list ----------------------------------------------
  // For players, the poll snapshot is authoritative for membership, order,
  // names, and reveal flags; the SSR rows are authoritative for heavy
  // per-participant data (statblocks, derived PC stats). Merge: walk the
  // poll list in its (server-sorted) order, graft each entry's lightweight
  // fields onto its SSR row. A poll entry with no SSR row (a monster added
  // or unhidden since page load) renders as a minimal row until the
  // invalidate below refreshes page data. Rows the poll dropped (removed or
  // freshly hidden) disappear immediately.
  //
  // The DM keeps rendering straight SSR data: every list mutation a DM can
  // make flows through api() + invalidateAll on this page, and overlaying a
  // ≤2s-stale poll list would briefly snap their own reveal/initiative
  // edits back. Cross-tab DM freshness rides the invalidate trigger below.
  type SsrParticipant = EncounterPageData['participants'][number];

  function synthParticipant(e: LiveParticipant): SsrParticipant {
    return {
      id: e.id,
      encounterId: data.encounter.id,
      characterId: e.characterId,
      name: e.name,
      kind: e.kind,
      statblockSlug: null,
      statblockJson: null,
      statblockActions: [],
      statblock: null,
      initiative: e.initiative,
      dexScore: 10,
      currentHp: null,
      maxHp: null,
      tempHp: 0,
      conditions: [],
      sortOrder: e.sortOrder,
      reveals: e.reveals,
      hpBucket: 'unknown',
      placeholderName: e.placeholderName
    } as SsrParticipant;
  }

  function mergeParticipants(
    ssrRows: EncounterPageData['participants'],
    live: LiveParticipant[] | null
  ): EncounterPageData['participants'] {
    if (!live) return ssrRows;
    const ssrById = new Map(ssrRows.map((p) => [p.id, p]));
    return live.map((e) => {
      const ssr = ssrById.get(e.id);
      return ssr
        ? {
            ...ssr,
            name: e.name,
            placeholderName: e.placeholderName,
            initiative: e.initiative,
            sortOrder: e.sortOrder,
            reveals: e.reveals
          }
        : synthParticipant(e);
    });
  }

  $: liveParticipants =
    data.role === 'dm'
      ? data.participants
      : mergeParticipants(data.participants, liveState?.participants ?? null);

  // Poll-driven page-data refresh: when the poll surfaces a row we have no
  // heavy data for — a brand-new participant, an unhidden ambush, or (for
  // players) a combat/vitals reveal flip that unlocks statblock data the
  // SSR pass redacted away — re-run the load functions once. Signature-
  // guarded so a transiently inconsistent server can't loop invalidateAll.
  let lastRefreshSig = '';
  $: if (liveState?.participants) {
    const needsHeavyData = liveState.participants.filter((e) => {
      const ssr = data.participants.find((p) => p.id === e.id);
      if (!ssr) return true;
      return (
        data.role !== 'dm' &&
        e.kind !== 'pc' &&
        ((e.reveals.combat && !ssr.reveals.combat) || (e.reveals.vitals && !ssr.reveals.vitals))
      );
    });
    const sig = needsHeavyData
      .map((e) => `${e.id}:${e.reveals.combat ? 1 : 0}${e.reveals.vitals ? 1 : 0}`)
      .join(',');
    if (needsHeavyData.length > 0 && sig !== lastRefreshSig) {
      lastRefreshSig = sig;
      invalidateAll().catch(() => {});
    }
  }

  function clearPlan(participantId: string) {
    if (!conn) return;
    conn.clearPlan(participantId).catch(() => {});
  }

  /** Map participant.id → SSR HP seed used when the SSE stream has no entry yet. */
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
  /** DM multi-target save state. DM types a save DC (no statblock saveDC plumbing
   *  yet for monster actions), picks AOE targets, enters per-target save rolls.
   *  Submit fires one log entry per target. */
  let resolveSaveDC: number | null = null;
  let resolveMultiTargetIds: string[] = [];
  let resolveTargetSaveRolls: Record<string, number | null> = {};
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
      resolveTargetId = plan.targetParticipantIds?.[0] ?? null;
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
    resolveSaveDC = null;
    resolveMultiTargetIds = [];
    resolveTargetSaveRolls = {};
  }

  function closeResolve() {
    resolveForParticipantId = null;
    resolveError = null;
    resolveSaveDC = null;
    resolveMultiTargetIds = [];
    resolveTargetSaveRolls = {};
  }

  /** Single-target apply: HP delta via participant API + one log entry. Returns ok. */
  async function dmApplyToTarget(
    targetId: string | null,
    outcome: HitOutcome,
    damage: number | null,
    attack: number | null,
    round: number
  ): Promise<boolean> {
    if (!conn || !resolveForParticipantId) return false;
    const target = (targetId
      ? liveParticipants.find((p) => p.id === targetId) ?? null
      : null) as ResolveTarget | null;
    const result = await applyHpAndLog({
      conn,
      encounterId: data.encounter.id,
      actingParticipantId: resolveForParticipantId,
      target,
      outcome,
      damage,
      attack,
      round,
      actionId: resolveActionId,
      actionLabel: resolveActionLabel,
      notes: resolveNotes
    });
    return result.ok;
  }

  /** True when the participant is a PC whose derived stats carry
   *  incomingCritImmune (adamantine armor) — a 'crit' outcome against
   *  them resolves as a normal hit. */
  function pcCritImmune(participantId: string | null): boolean {
    return !!participantId && data.participantPcStats?.[participantId]?.incomingCritImmune === true;
  }

  async function submitDmResolve() {
    if (!conn || !resolveForParticipantId) return;
    const round = liveState?.round ?? data.encounter.round;
    // Crit-immune targets take a normal hit instead: log reads 'hit',
    // attack.crit reactions don't fire. The form shows the downgrade note
    // while 'crit' is selected against such a target.
    const singleOutcome = downgradeCritForTarget(resolveHit, pcCritImmune(resolveTargetId));
    resolveSubmitting = true;
    try {
      if (resolveMultiTargetIds.length > 0 && resolveSaveDC != null) {
        // Multi-target save: per-target pass/fail from save roll vs DC.
        for (const tid of resolveMultiTargetIds) {
          const t = liveParticipants.find((p) => p.id === tid);
          if (!t) continue;
          const saveRoll = resolveTargetSaveRolls[tid];
          const perTargetOutcome: HitOutcome =
            typeof saveRoll === 'number'
              ? saveRoll >= resolveSaveDC
                ? 'saved'
                : 'failed-save'
              : resolveHit || 'failed-save';
          const ok = await dmApplyToTarget(tid, perTargetOutcome, resolveDamage, saveRoll ?? null, round);
          if (!ok) {
            resolveError = `log entry failed for ${t.name}`;
            return;
          }
        }
      } else {
        const ok = await dmApplyToTarget(resolveTargetId, singleOutcome, resolveDamage, resolveAttack, round);
        if (!ok) {
          resolveError = 'log entry failed';
          return;
        }
        // Check if single target is concentrating and took real damage.
        if (
          resolveTargetId &&
          (singleOutcome === 'hit' || singleOutcome === 'crit' || singleOutcome === 'failed-save' || singleOutcome === 'saved') &&
          typeof resolveDamage === 'number' &&
          resolveDamage > 0
        ) {
          const targetHpEntry = liveHpMap[resolveTargetId];
          if (targetHpEntry?.concentrating) {
            const targetParticipant = liveParticipants.find((p) => p.id === resolveTargetId);
            const effective = effectiveDamage(singleOutcome, resolveDamage);
            concSavePrompt = {
              participantName: targetParticipant?.name ?? 'Target',
              dc: Math.max(10, Math.floor(effective / 2)),
              participantId: resolveTargetId
            };
          }
        }
      }
      // Build the set of events that fired from this resolution.
      const firedEvents = firedEventsFor(
        resolveMultiTargetIds.length > 0 ? resolveHit : singleOutcome
      );
      // Add 'attack.reduce-to-zero' if any target hit 0 HP.
      const checkTargets = resolveMultiTargetIds.length > 0 ? resolveMultiTargetIds : (resolveTargetId ? [resolveTargetId] : []);
      for (const tid of checkTargets) {
        const hpEntry = liveHpMap[tid];
        if (hpEntry && hpEntry.currentHp != null && hpEntry.currentHp <= 0) {
          firedEvents.push('attack.reduce-to-zero');
          break;
        }
      }
      const reactionUsedByParticipantId: Record<string, boolean> = {};
      for (const [pid, econ] of Object.entries(roundEconomy)) {
        if (econ?.reactionUsed) reactionUsedByParticipantId[pid] = true;
      }
      const newPrompts = reactionPromptsForResolution({
        firedEvents,
        participants: liveParticipants,
        triggersByParticipantId: data.participantPcTriggers ?? {},
        reactionUsedByParticipantId
      });
      if (newPrompts.length > 0) reactionPrompts = [...reactionPrompts, ...newPrompts];
      // Clear the plan if there was one.
      if (livePlans[resolveForParticipantId]) {
        conn.clearPlan(resolveForParticipantId).catch(() => {});
      }
      closeResolve();
      await invalidateAll();
    } finally {
      resolveSubmitting = false;
    }
  }

  /** Drop concentration for a participant (called from the CON save callout). */
  function dropConcentration(participantId: string) {
    const p = liveParticipants.find((q) => q.id === participantId);
    if (!p || !conn || connStatus !== 'open') return;
    conn.setConcentration(participantId, null).catch(() => {});
    concSavePrompt = null;
  }

  // ---- DM amend / delete ----
  // Amendments PATCH the original log entry in place (no new "amendment"
  // row appended). HP changes from the original are reverted before the new
  // outcome is applied, so the encounter HP stays consistent with whatever
  // the corrected entry says.
  let amendingLogId: string | null = null;

  function openAmend(entry: {
    id: string;
    participantId: string | null;
    actionId: string;
    actionLabel: string;
    targetParticipantId: string | null;
    attackRoll: number | null;
    damageRoll: number | null;
    hit: string | null;
    notes: string | null;
  }) {
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

  /** Sum XP across all non-PC participants whose monster statblock carries
   *  an xp value. Surfaced in the encounter header as a rough budget gauge. */
  $: encounterTotalXp = liveParticipants
    .filter((p) => p.kind !== 'pc' && p.statblock?.xp != null)
    .reduce((s, p) => s + (p.statblock?.xp ?? 0), 0);
  $: xpPerChar =
    data.party.size > 0 ? Math.round(encounterTotalXp / data.party.size) : encounterTotalXp;
  async function removeLogEntry(id: string) {
    if (data.role !== 'dm') return;
    if (!confirm('Remove this log entry? HP changes are not reverted.')) return;
    busy = true;
    try {
      await api.del(`/api/encounters/${data.encounter.id}/log/${id}`);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function submitAmend() {
    if (!conn || !amendingLogId || !resolveForParticipantId) return;
    const round = liveState?.round ?? data.encounter.round;

    // Revert the prior entry's HP change before applying the new outcome,
    // so amendments don't stack on top of unrelated damage that landed in
    // between.
    const prior = data.actionLog.find((e) => e.id === amendingLogId);
    if (prior) {
      const priorTarget = (liveParticipants.find((p) => p.id === prior.targetParticipantId) ?? null) as ResolveTarget | null;
      revertPriorHpChange(conn, prior, priorTarget);
    }

    const target = (resolveTargetId
      ? liveParticipants.find((p) => p.id === resolveTargetId) ?? null
      : null) as ResolveTarget | null;
    // Re-read live HP *after* the revert so the new damage starts from the
    // corrected baseline.
    const liveSeed = target ? liveState?.participantHp[target.id] ?? null : null;

    resolveSubmitting = true;
    try {
      const result = await applyHpAndLog({
        conn,
        encounterId: data.encounter.id,
        actingParticipantId: resolveForParticipantId,
        target,
        outcome: resolveHit,
        damage: resolveDamage,
        attack: resolveAttack,
        round,
        actionId: resolveActionId,
        actionLabel: resolveActionLabel,
        notes: resolveNotes,
        liveSeed,
        amendsLogId: amendingLogId
      });
      if (!result.ok) {
        resolveError = `amend: ${result.status} ${result.errorText ?? ''}`;
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
    try {
      await api.patch(`/api/participants/${participantId}`, { currentHp, tempHp });
    } catch {
      // api() already toasted; next invalidate/poll re-syncs
    }
  }

  // DM reveal toggles. Flips one flag at a time on the server and re-runs
  // the page load so the redacted player projection is consistent.
  async function patchReveal(participantId: string, patch: Record<string, boolean>) {
    busy = true;
    try {
      await api.patch(`/api/participants/${participantId}/reveals`, patch);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }
  async function revealAll(participantId: string) {
    await patchReveal(participantId, { identity: true, vitals: true, combat: true, hidden: false });
  }
  async function hideAll(participantId: string) {
    await patchReveal(participantId, { identity: false, vitals: false, combat: false, hidden: false });
  }

  /** Apply a delta to a PC's HP by round-tripping the character document
   *  via REST. Mirrors the conditions/concentration paths so the player's
   *  open sheet picks up the change on next reload / reconcile. Returns the
   *  new current HP for caller-side state mirroring. */
  async function patchPcHp(
    characterId: string,
    nextCurrent: number,
    nextTemp: number
  ): Promise<boolean> {
    try {
      const char = await api.get<{ document: Record<string, unknown> | null }>(
        `/api/characters/${characterId}`
      );
      const doc = { ...(char.document ?? {}), currentHp: nextCurrent, tempHp: nextTemp };
      await api.patch(`/api/characters/${characterId}`, { document: doc });
      return true;
    } catch {
      // api() already toasted
      return false;
    }
  }

  async function dmDamage(p: { id: string; kind: string; characterId: string | null; currentHp: number | null; tempHp: number; conditions: string[] }) {
    const n = Math.max(0, Math.floor(hpInputs[p.id] ?? 0));
    if (n === 0) return;
    const seed = seedFor(p);
    const next = applyDamageDelta(seed, n);
    if (p.kind === 'pc' && p.characterId) {
      const ok = await patchPcHp(p.characterId, next.currentHp ?? 0, next.tempHp);
      if (ok) await invalidateAll();
    } else if (conn && connStatus === 'open') {
      conn.applyDamage(p.id, n, seed);
    } else {
      await patchParticipantHp(p.id, next.currentHp ?? 0, next.tempHp);
      await invalidateAll();
    }
    hpInputs[p.id] = 0;
    hpInputs = hpInputs;
  }

  async function dmHeal(p: {
    id: string;
    kind: string;
    characterId: string | null;
    currentHp: number | null;
    maxHp: number | null;
    tempHp: number;
    conditions: string[];
  }) {
    const n = Math.max(0, Math.floor(hpInputs[p.id] ?? 0));
    if (n === 0) return;
    const seed = seedFor(p);
    const next = applyHealDelta(seed, n, p.maxHp);
    if (p.kind === 'pc' && p.characterId) {
      const ok = await patchPcHp(p.characterId, next.currentHp ?? 0, next.tempHp);
      if (ok) await invalidateAll();
    } else if (conn && connStatus === 'open') {
      conn.applyHeal(p.id, n, p.maxHp, seed);
    } else {
      await patchParticipantHp(p.id, next.currentHp ?? 0, next.tempHp);
      await invalidateAll();
    }
    hpInputs[p.id] = 0;
    hpInputs = hpInputs;
  }

  let showAddParticipantModal = false;
  let addParticipantModal: AddParticipantModal | null = null;
  // ---- encounter rename ----
  let renamingEncounter = false;
  let renameValue = data.encounter.name;
  let encounterName = data.encounter.name;

  async function submitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === encounterName) { renamingEncounter = false; return; }
    busy = true;
    try {
      await api.patch(`/api/encounters/${data.encounter.id}`, { name: trimmed });
      encounterName = trimmed;
    } catch {
      // api() already toasted; keep the old name
    } finally {
      busy = false;
      renamingEncounter = false;
    }
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') submitRename();
    else if (e.key === 'Escape') renamingEncounter = false;
  }

  async function addParticipant(draft: {
    kind: 'pc' | 'npc';
    name: string;
    characterId: string;
    statblockSlug: string;
    defaultMaxHp: number | null;
    quantity: number;
  }) {
    const { kind, name, characterId, statblockSlug, defaultMaxHp } = draft;
    if (kind === 'pc' && !characterId) return;
    const qty = kind === 'pc' ? 1 : Math.max(1, Math.min(20, Math.floor(draft.quantity || 1)));
    const baseName =
      kind === 'pc'
        ? (data.campaignCharacters.find((c) => c.id === characterId)?.name ?? name)
        : name;
    busy = true;
    try {
      for (let i = 0; i < qty; i++) {
        const body: Record<string, unknown> = {
          name: qty > 1 ? `${baseName} #${i + 1}` : baseName,
          kind,
          maxHp: defaultMaxHp ?? undefined,
          currentHp: defaultMaxHp ?? undefined
        };
        if (kind === 'pc') body.characterId = characterId;
        if (kind === 'npc' && statblockSlug) body.statblockSlug = statblockSlug;
        try {
          await api.post(`/api/encounters/${data.encounter.id}/participants`, body);
        } catch {
          // api() already toasted; stop adding further copies
          break;
        }
      }
      addParticipantModal?.resetDraft();
      showAddParticipantModal = false;
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function updateInitiative(id: string, value: number | null) {
    busy = true;
    try {
      await api.patch(`/api/participants/${id}`, { initiative: value });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  /** Auto-roll initiative for every non-PC participant that doesn't already
   *  have one. PCs are left to roll themselves on their character sheet.
   *  Formula: d20 + (dex - 10) >> 1 (Math.floor mod). */
  async function rollInitiativeAll() {
    if (data.role !== 'dm') return;
    busy = true;
    try {
      for (const p of liveParticipants) {
        if (p.kind === 'pc') continue;
        if (p.initiative != null) continue;
        const dexMod = Math.floor(((p.dexScore ?? 10) - 10) / 2);
        const roll = 1 + Math.floor(Math.random() * 20) + dexMod;
        try {
          await api.patch(`/api/participants/${p.id}`, { initiative: roll });
        } catch {
          // api() already toasted; keep rolling the rest
        }
      }
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function removeParticipant(id: string) {
    if (!confirm('Remove this participant?')) return;
    busy = true;
    try {
      await api.del(`/api/participants/${id}`);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  /** Flip the encounter through its staging → live → ended state machine. */
  async function setEncounterStatus(status: 'staging' | 'live' | 'ended') {
    if (data.role !== 'dm') return;
    if (status === 'ended' && !confirm('End this encounter? It becomes read-only history.')) return;
    busy = true;
    try {
      // Through the channel when connected: optimistic + stale-poll-guarded,
      // so the header flips instantly and a racing poll can't revert it.
      if (conn) await conn.setTurn({ status });
      else await api.patch(`/api/encounters/${data.encounter.id}`, { status });
      await invalidateAll();
    } catch {
      // api()/channel already toasted
    } finally {
      busy = false;
    }
  }

  function inputValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  async function toggleCondition(
    p: { id: string; kind: string; characterId: string | null; currentHp: number | null; tempHp: number; conditions: string[] },
    cond: string
  ) {
    // No template-reactivity concern here — this is called from an event
    // handler, so reading data.participantPcConditions imperatively is fine.
    const current = conditionsForParticipant(
      p,
      data.participantPcConditions,
      liveHpMap[p.id]?.conditions
    );
    const next = toggleArrayValue(current, cond);
    if (p.kind === 'pc') {
      if (!p.characterId) return;
      await patchPcWithMirror({
        characterId: p.characterId,
        field: 'conditions',
        next,
        prev: current,
        setLocal: (v) => {
          data.participantPcConditions = { ...(data.participantPcConditions ?? {}), [p.id]: v };
        }
      });
      return;
    }
    if (conn && connStatus === 'open') {
      conn.setConditions(p.id, next).catch(() => {});
    } else {
      try {
        await api.patch(`/api/participants/${p.id}`, { conditions: next });
        await invalidateAll();
      } catch {
        // api() already toasted
      }
    }
  }

  async function startConcentrating(
    p: { id: string; kind: string; characterId: string | null; currentHp: number | null; tempHp: number; conditions: string[] },
    label: string
  ) {
    const clean = label.trim();
    if (!clean) return;
    const round = liveState?.round;
    const next = { label: clean, ...(round != null ? { sinceRound: round } : {}) };
    if (p.kind === 'pc') {
      if (!p.characterId) return;
      const prev = data.participantPcConcentrating?.[p.id] ?? null;
      await patchPcWithMirror({
        characterId: p.characterId,
        field: 'concentrating',
        next,
        prev,
        setLocal: (v) => {
          data.participantPcConcentrating = { ...(data.participantPcConcentrating ?? {}), [p.id]: v };
        }
      });
      return;
    }
    if (conn && connStatus === 'open') {
      conn.setConcentration(p.id, next).catch(() => {});
    }
  }

  async function clearConcentrating(
    p: { id: string; kind: string; characterId: string | null; currentHp: number | null; tempHp: number; conditions: string[] }
  ) {
    if (p.kind === 'pc') {
      if (!p.characterId) return;
      const prev = data.participantPcConcentrating?.[p.id] ?? null;
      await patchPcWithMirror<{ label: string; sinceRound?: number } | null>({
        characterId: p.characterId,
        field: 'concentrating',
        next: null,
        prev,
        setLocal: (v) => {
          data.participantPcConcentrating = { ...(data.participantPcConcentrating ?? {}), [p.id]: v };
        }
      });
      return;
    }
    if (conn && connStatus === 'open') {
      conn.setConcentration(p.id, null).catch(() => {});
    }
  }

  // Concentration save callout state: set after a resolve completes, cleared when dismissed.
  let concSavePrompt: { participantName: string; dc: number; participantId: string } | null = null;

  // Reaction queue: one entry per PC trigger that fires from the resolved action.
  // Shown one at a time (same position as concSavePrompt) so DM can confirm or skip.
  let reactionPrompts: Array<{
    participantId: string;
    participantName: string;
    triggerId: string;
    triggerName: string;
    grants?: { type: string; [k: string]: unknown };
  }> = [];

  /** Which participant is selected (detail panel shown below). Auto-advances
   *  with the active turn; DM/players can also click any row to inspect. */
  let selectedId: string | null = null;
  $: if (liveActive && liveActive !== selectedId) { selectedId = liveActive; ensureEconomy(liveActive); }

  /** Initiative cell edit mode. */
  let initiativeEditFor: string | null = null;
  /** Draft for the concentration input in the detail panel. Reset when selection changes. */
  let concDraft = '';
  $: if (selectedId) concDraft = '';
  /** Monster edit drafts for the detail panel. */
  let editMonsterNameDraft = '';
  let editMonsterSlugDraft = '';

  function openMonsterEdit(p: { id: string; name: string; statblockSlug: string | null }) {
    editMonsterNameDraft = p.name;
    editMonsterSlugDraft = p.statblockSlug ?? '';
    selectedId = p.id;
  }

  /** Save the rename + statblock swap. If the slug changed, also reset HP to
   *  the new monster's max so the row reflects the swap. */
  async function saveMonsterEdit(
    p: { id: string; name: string; statblockSlug: string | null; maxHp: number | null }
  ) {
    const nextName = editMonsterNameDraft.trim();
    const nextSlug = editMonsterSlugDraft.trim();
    if (!nextName) return;
    const slugChanged = nextSlug !== (p.statblockSlug ?? '');
    const body: Record<string, unknown> = { name: nextName };
    if (slugChanged) {
      body.statblockSlug = nextSlug || null;
      const newMon = data.monsterOptions.find((m) => m.slug === nextSlug);
      if (newMon?.maxHp != null) {
        body.maxHp = newMon.maxHp;
        body.currentHp = newMon.maxHp;
      }
    }
    busy = true;
    try {
      await api.patch(`/api/participants/${p.id}`, body);
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  // ---- Action economy foldout (client-side display state only) ----
  interface RoundEconomyEntry {
    action: string;
    bonusAction: string;
    movement: number;
    reaction: string;
    freeActions: string;
    slotLevel: number;
    /** Per-turn used flags surfaced by the ActionEconomyPanel. Client-only
     *  for v1 — not persisted across reloads. */
    actionUsed: boolean;
    bonusUsed: boolean;
    reactionUsed: boolean;
  }
  let roundEconomy: Record<string, RoundEconomyEntry> = {};

  function blankEconomy(): RoundEconomyEntry {
    return {
      action: '',
      bonusAction: '',
      movement: 0,
      reaction: '',
      freeActions: '',
      slotLevel: 1,
      actionUsed: false,
      bonusUsed: false,
      reactionUsed: false
    };
  }

  function ensureEconomy(id: string): RoundEconomyEntry {
    if (!roundEconomy[id]) {
      roundEconomy[id] = blankEconomy();
    }
    return roundEconomy[id];
  }

  function resetEconomy(id: string) {
    roundEconomy[id] = blankEconomy();
    roundEconomy = roundEconomy;
  }

  type SpellEntry = { slug: string; name: string; level: number };
  function groupByLevel(spells: SpellEntry[]) {
    const groups = new Map<number, SpellEntry[]>();
    for (const s of spells) {
      if (!groups.has(s.level)) groups.set(s.level, []);
      groups.get(s.level)!.push(s);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b).map(([level, spells]) => ({ level, spells }));
  }

  function isSpellAction(participantId: string): boolean {
    const spells = data.participantSpells?.[participantId] ?? [];
    const action = livePlans[participantId]?.actionId ?? '';
    return action !== '' && spells.some(s => s.name === action);
  }

  /** DM picks an action/bonus/targets for any participant (PC or non-PC).
   *  Persists as a TurnPlan so it survives refresh and broadcasts to every
   *  connected viewer (including the PC's own character sheet). Changing the
   *  action clears its targets so a leftover pick doesn't bleed into the
   *  next action. */
  function persistPlan(
    p: { id: string; kind: string; statblock: { actions?: Array<{ name: string; attackBonus?: number }> } | null },
    next: {
      actionId?: string;
      bonusActionId?: string;
      targetParticipantIds?: string[];
      bonusTargetParticipantIds?: string[];
    }
  ) {
    if (!conn) return;
    const cur = livePlans[p.id];
    const actionId = next.actionId !== undefined ? next.actionId : (cur?.actionId ?? '');
    const bonusActionId =
      next.bonusActionId !== undefined ? next.bonusActionId : (cur?.bonusActionId ?? '');
    if (!actionId && !bonusActionId) {
      conn.clearPlan(p.id).catch(() => {});
      return;
    }
    // Look up display labels from the live choice lists so PC plans store
    // the friendly name ("Longsword (action)") instead of the raw id.
    const actionLabel =
      next.actionId !== undefined
        ? (actionChoicesFor(p).find((c) => c.id === actionId)?.name ?? actionId)
        : (cur?.actionLabel ?? actionId);
    const bonusActionLabel =
      next.bonusActionId !== undefined
        ? (bonusChoicesFor(p).find((c) => c.id === bonusActionId)?.name ?? bonusActionId)
        : (cur?.bonusActionLabel ?? bonusActionId);
    const actionChanged = next.actionId !== undefined && next.actionId !== (cur?.actionId ?? '');
    const bonusChanged =
      next.bonusActionId !== undefined && next.bonusActionId !== (cur?.bonusActionId ?? '');
    const targetParticipantIds =
      next.targetParticipantIds !== undefined
        ? next.targetParticipantIds
        : actionChanged
          ? []
          : (cur?.targetParticipantIds ?? []);
    const bonusTargetParticipantIds =
      next.bonusTargetParticipantIds !== undefined
        ? next.bonusTargetParticipantIds
        : bonusChanged
          ? []
          : cur?.bonusTargetParticipantIds;
    conn
      .setPlan(p.id, {
        actionId,
        actionLabel: actionLabel || actionId,
        bonusActionId: bonusActionId || undefined,
        bonusActionLabel: bonusActionId ? (bonusActionLabel || bonusActionId) : undefined,
        targetParticipantIds,
        bonusTargetParticipantIds,
        notes: cur?.notes ?? '',
        updatedAt: Date.now()
      })
      .catch(() => {});
  }

  /** Build the chooser list the ActionEconomyPanel renders for the Action
   *  slot of one participant. For PCs we enumerate the character's derived
   *  actions (so custom/homebrew abilities surface here too, matching the
   *  character sheet); for non-PCs we enumerate statblock actions plus any
   *  prepared spells we know about. */
  type PlanChoice = {
    id: string;
    name: string;
    targetMode?: 'self' | 'single' | 'multi';
  };

  function actionChoicesFor(
    p: { id: string; kind: string; statblock: { actions?: Array<{ name: string; attackBonus?: number }> } | null }
  ): PlanChoice[] {
    if (p.kind === 'pc') {
      return (data.participantPcActions?.[p.id] ?? [])
        .filter((a) => slotForCost(a.cost) === 'action')
        .map((a) => ({
          id: a.id,
          name: `${a.name}${a.attackCount != null && a.attackCount > 1 ? ` ×${a.attackCount}` : ''} (${costLabel(a.cost)})`
        }));
    }
    const choices: PlanChoice[] = [];
    for (const a of p.statblock?.actions ?? []) {
      // Attack actions have a single target; everything else (saves, AoEs,
      // utility) gets the multi picker so the DM can mark every affected
      // creature.
      const targetMode: 'single' | 'multi' = a.attackBonus != null ? 'single' : 'multi';
      choices.push({ id: a.name, name: a.name, targetMode });
    }
    for (const s of data.participantSpells?.[p.id] ?? []) {
      // Spells are heterogeneous (single attacks, AoE saves, buffs) and we
      // don't have target metadata at this layer, so default to multi —
      // the picker still works for single-target picks.
      choices.push({
        id: s.name,
        name: `${s.name} (${s.level === 0 ? 'C' : 'L' + s.level})`,
        targetMode: 'multi'
      });
    }
    return choices;
  }

  function bonusChoicesFor(
    p: { id: string; kind: string }
  ): PlanChoice[] {
    if (p.kind === 'pc') {
      return (data.participantPcActions?.[p.id] ?? [])
        .filter((a) => slotForCost(a.cost) === 'bonus')
        .map((a) => ({ id: a.id, name: `${a.name} (${costLabel(a.cost)})` }));
    }
    return COMMON_BONUS_ACTIONS.map((b) => ({ id: b, name: b, targetMode: 'single' as const }));
  }

  // Track previous active to reset economy on turn change. We deliberately
  // do NOT auto-expand/collapse the action-economy panel on turn change —
  // the toggle flickered when initiative cycled fast. The DM clicks `+ econ`
  // manually for now.
  let prevActive: string | null = null;
  $: {
    const current = liveActive;
    if (current !== prevActive) {
      if (prevActive != null) resetEconomy(prevActive);
      prevActive = current;
    }
  }


  const COMMON_BONUS_ACTIONS = ['Offhand attack', 'Dash', 'Disengage', 'Hide', 'Healing Word', 'Hex'];
  function abilityMod(score: number): string {
    const m = Math.floor((score - 10) / 2);
    return (m >= 0 ? '+' : '') + m;
  }

  /** Tap on a participant row: jump active turn to that participant (no
   *  round bump). Server allows any member to set activeParticipantId; the
   *  reactive `selectedId = liveActive` block keeps the detail panel in
   *  sync. Tapping the already-active row toggles the detail panel. */
  function selectParticipant(p: { id: string }, isCurrentlySelected: boolean) {
    if (conn && p.id !== liveActive) {
      ensureEconomy(p.id);
      void conn.setTurn({ activeParticipantId: p.id });
      return;
    }
    selectedId = isCurrentlySelected ? null : p.id;
    if (!isCurrentlySelected) ensureEconomy(p.id);
  }

  async function advanceTurn(direction: 1 | -1) {
    if (data.role !== 'dm') return;
    const ordered = [...liveParticipants];
    if (ordered.length === 0) return;
    const idx = ordered.findIndex((p) => p.id === liveActive);
    let nextIdx = idx + direction;
    let roundDelta = 0;
    if (nextIdx < 0) { nextIdx = ordered.length - 1; roundDelta = -1; }
    if (nextIdx >= ordered.length) { nextIdx = 0; roundDelta = 1; }
    const nextActive = ordered[nextIdx].id;
    const nextRound = roundDelta !== 0 ? Math.max(1, liveRound + roundDelta) : undefined;

    if (conn) {
      await conn.setTurn({ activeParticipantId: nextActive, ...(nextRound !== undefined ? { round: nextRound } : {}) });
      return;
    }

    // Fallback when the channel hasn't initialized (SSR-only mode).
    busy = true;
    try {
      await api.patch(`/api/encounters/${data.encounter.id}`, {
        activeParticipantId: nextActive,
        ...(nextRound !== undefined ? { round: nextRound } : {})
      });
      await invalidateAll();
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  // Dice roller state (client-only, no persistence)
  const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
  let diceResult: { die: number; roll: number } | null = null;
  function rollDie(sides: number) {
    diceResult = { die: sides, roll: Math.floor(Math.random() * sides) + 1 };
  }

  // Encounter notes (DM only, persisted to encounters.notesJson)
  let encounterNotesDraft = data.encounter.notesJson ?? '';
  let notesSaveTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleNotesSave() {
    if (notesSaveTimer) clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      // api() toasts on failure; nothing to roll back for a notes autosave
      api
        .patch(`/api/encounters/${data.encounter.id}`, { notesJson: encounterNotesDraft || null })
        .catch(() => {});
    }, 800);
  }

  // Legendary action tracker (client-only, per participant per round)
  // Map<participantId, usedCount>. Resets when liveRound changes.
  let legendaryUsed: Record<string, number> = {};
  let trackedRound = -1;
  $: if (liveRound !== trackedRound) {
    legendaryUsed = {};
    trackedRound = liveRound;
  }
  function toggleLegendaryAction(pid: string, max: number) {
    const used = legendaryUsed[pid] ?? 0;
    legendaryUsed[pid] = used >= max ? 0 : used + 1;
    legendaryUsed = legendaryUsed;
  }

  // NPC spell slot tracker (client-only, per participant)
  // Map<participantId, Record<level, { max: number; used: number }>>
  let npcSpellSlots: Record<string, Record<number, { max: number; used: number }>> = {};
  function initSlots(pid: string) {
    if (!npcSpellSlots[pid]) {
      npcSpellSlots[pid] = {};
      npcSpellSlots = npcSpellSlots;
    }
  }
  function setSlotMax(pid: string, level: number, max: number) {
    initSlots(pid);
    const cur = npcSpellSlots[pid][level] ?? { max: 0, used: 0 };
    npcSpellSlots[pid][level] = { max, used: Math.min(cur.used, max) };
    npcSpellSlots = npcSpellSlots;
  }
  function toggleSlotUsed(pid: string, level: number, slotIdx: number) {
    initSlots(pid);
    const cur = npcSpellSlots[pid][level] ?? { max: 0, used: 0 };
    const used = slotIdx < cur.used ? slotIdx : slotIdx + 1;
    npcSpellSlots[pid][level] = { ...cur, used: Math.max(0, Math.min(cur.max, used)) };
    npcSpellSlots = npcSpellSlots;
  }
  const SPELL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
  let showSlotEditor: Record<string, boolean> = {};
</script>

<svelte:head>
  <title>{data.encounter.name} — {data.campaign.name}</title>
</svelte:head>

<header class="mb-6 flex items-baseline justify-between">
  <div>
    {#if renamingEncounter}
      <div class="flex items-center gap-2">
        <!-- svelte-ignore a11y-autofocus (rename input appears on demand; it must own focus or the blur-to-save flow never engages) -->
        <input
          class="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-2xl font-semibold text-slate-100 outline-none focus:border-slate-400"
          bind:value={renameValue}
          on:keydown={onRenameKeydown}
          on:blur={submitRename}
          autofocus
        />
        <button class="text-xs text-slate-500 hover:text-slate-300" on:click={submitRename}>save</button>
        <button class="text-xs text-slate-500 hover:text-slate-300" on:click={() => renamingEncounter = false}>cancel</button>
      </div>
    {:else}
      <h1 class="group flex items-center gap-2 text-2xl font-semibold">
        {encounterName}
        {#if data.role === 'dm'}
          <button
            class="opacity-0 group-hover:opacity-100 text-sm text-slate-500 hover:text-slate-300 transition-opacity"
            on:click={() => { renameValue = encounterName; renamingEncounter = true; }}
            aria-label="Rename encounter"
          >✎</button>
        {/if}
      </h1>
    {/if}
    <p class="text-sm text-slate-400">
      {#if conn}
        <span
          class="inline-block h-2 w-2 rounded-full {connStatus === 'open'
            ? 'bg-emerald-500'
            : connStatus === 'connecting'
              ? 'bg-amber-500'
              : 'bg-slate-600'}"
          title={connStatus === 'open'
            ? `${liveStatus} · live sync connected`
            : `${liveStatus} · sync: ${connStatus}`}
        ></span>
      {/if}
      {#if encounterTotalXp > 0}
        &middot; <span class="text-slate-300">{encounterTotalXp} XP</span>
        {#if data.party.size > 0}
          <span class="text-slate-500">
            (vs {data.party.size} PC{data.party.size === 1 ? '' : 's'},
            avg L{data.party.avgLevel.toFixed(1)} —
            <span class="text-slate-300">{xpPerChar}/char</span>)
          </span>
        {/if}
      {/if}
    </p>
  </div>
  <div class="flex items-center gap-3">
    {#if data.role === 'dm'}
      {#if liveStatus === 'staging'}
        <button
          class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
          disabled={busy || liveParticipants.length === 0}
          title={liveParticipants.length === 0
            ? 'Add at least one participant first'
            : 'Flip to live combat'}
          on:click={() => setEncounterStatus('live')}
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

{#if liveStatus === 'live' && data.role === 'dm'}
  <section class="mb-4 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
    <div class="flex items-center gap-2">
      <span class="text-emerald-200">Turn controls:</span>
      <button class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={() => advanceTurn(-1)} disabled={busy} title="Previous turn">
        ←
      </button>
      <span class="min-w-[5rem] text-center font-mono text-slate-300">Round {liveRound}</span>
      <button class="rounded border border-emerald-700 px-2 py-0.5 hover:bg-emerald-900/40" on:click={() => advanceTurn(1)} disabled={busy}>
        Next turn →
      </button>
      <button
        class="ml-auto rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800 disabled:opacity-40"
        disabled={busy}
        on:click={() => setEncounterStatus('ended')}
      >
        End
      </button>
    </div>
  </section>
  <!-- Dice roller -->
  <section class="mb-4 rounded-lg border border-slate-700 bg-slate-900/30 p-3 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-slate-400">Dice:</span>
      {#each DICE as sides}
        <button
          class="rounded border border-slate-600 px-2 py-0.5 font-mono text-xs hover:border-slate-400 hover:bg-slate-800"
          on:click={() => rollDie(sides)}
        >d{sides}</button>
      {/each}
      {#if diceResult}
        <span class="ml-2 font-mono text-slate-200">
          d{diceResult.die} → <span class="text-lg font-bold {diceResult.roll === diceResult.die ? 'text-emerald-300' : diceResult.roll === 1 ? 'text-red-400' : 'text-white'}">{diceResult.roll}</span>
        </span>
      {/if}
    </div>
  </section>
{/if}

{#if data.role === 'dm'}
  <!-- Encounter notes -->
  <section class="mb-6 rounded-lg border border-slate-700 bg-slate-900/30 p-3">
    <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">DM Notes</div>
    <textarea
      class="w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-slate-500 focus:outline-none"
      rows="3"
      maxlength="4000"
      placeholder="Encounter notes, lore, secret triggers…"
      bind:value={encounterNotesDraft}
      on:input={scheduleNotesSave}
    ></textarea>
  </section>
{/if}

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <div class="mb-3 flex items-baseline justify-between gap-2">
    <div class="flex items-baseline gap-2">
      <h2 class="text-sm font-semibold text-slate-200">Participants ({liveParticipants.length})</h2>
      {#if data.role === 'dm'}
        <button
          class="rounded border border-emerald-700 bg-emerald-950/30 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-40"
          disabled={busy}
          on:click={() => (showAddParticipantModal = true)}
        >
          + Add
        </button>
      {/if}
    </div>
    {#if data.role === 'dm' && liveParticipants.some((p) => p.kind !== 'pc' && p.initiative == null)}
      <button
        class="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
        disabled={busy}
        title="Roll d20+Dex for every non-PC participant without an initiative"
        on:click={rollInitiativeAll}
      >
        🎲 Roll initiative (NPCs)
      </button>
    {/if}
  </div>

  {#if liveParticipants.length === 0}
    <p class="mb-3 text-sm text-slate-400">No participants yet.</p>
  {:else}
    <ul class="mb-3 divide-y divide-slate-800">
      {#each liveParticipants as p (p.id)}
        {@const isSelected = p.id === selectedId}
        {@const concRaw = liveHpMap[p.id]?.concentrating}
        {@const concPcDoc = data.participantPcConcentrating?.[p.id]}
        {@const concLbl = p.kind === 'pc'
          ? (concPcDoc?.label ?? null)
          : (concRaw
              ? (typeof concRaw === 'object' ? (concRaw.label ?? '') : '')
              : null)}
        <ParticipantRowCard
          {p}
          role={data.role}
          isActive={p.id === liveActive}
          {isSelected}
          activeConds={conditionsForParticipant(p, data.participantPcConditions, liveHpMap[p.id]?.conditions)}
          concLabel={concLbl}
          receivedBuffLabels={(data.participantPcReceivedBuffs?.[p.id] ?? []).map(
            (b) => (b.sourceLabel ? `${b.spellSlug} (${b.sourceLabel})` : b.spellSlug)
          )}
          liveCurrentHp={liveHpMap[p.id]?.currentHp}
          liveTempHp={liveHpMap[p.id]?.tempHp}
          editingInitiative={initiativeEditFor === p.id}
          {busy}
          on:select={() => selectParticipant(p, isSelected)}
          on:startEditInitiative={() => (initiativeEditFor = p.id)}
          on:cancelEditInitiative={() => (initiativeEditFor = null)}
          on:commitInitiative={(e) => {
            updateInitiative(p.id, e.detail);
            if (initiativeEditFor === p.id) initiativeEditFor = null;
          }}
          on:remove={() => removeParticipant(p.id)}
        />
      {/each}
    </ul>
  {/if}

</section>

<!-- Detail panel: shown when a participant is selected -->
{#if selectedId}
  {@const p = liveParticipants.find((x) => x.id === selectedId)}
  {#if p}
    {@const plan = livePlans[p.id]}
    {@const activeConds = conditionsForParticipant(p, data.participantPcConditions, liveHpMap[p.id]?.conditions)}
    {@const implied = impliedBy(activeConds)}
    {@const concRaw = liveHpMap[p.id]?.concentrating}
    {@const concPcDoc = data.participantPcConcentrating?.[p.id]}
    {@const concLbl = p.kind === 'pc'
      ? (concPcDoc?.label ?? null)
      : (concRaw ? (typeof concRaw === 'object' ? (concRaw.label ?? '') : '') : null)}
    {@const cs = data.participantPcStats?.[p.id] ?? null}
    {@const canSeeStats = data.role === 'dm' || p.reveals?.combat === true || (p.kind === 'pc' && !!cs)}
    {@const isPc = p.kind === 'pc'}
    {@const speeds = isPc ? (cs?.speeds ?? { walk: 30 }) : (p.statblock?.speeds ?? { walk: 30 })}
    {@const walkSpeed = speeds.walk ?? speeds.fly ?? speeds.swim ?? 30}
    <section class="mb-6 rounded-lg border border-slate-700 bg-slate-900/50 p-4 text-sm">
      <!-- Header -->
      <div class="mb-1 flex items-center gap-2">
        <span class="font-semibold text-slate-100">{p.placeholderName ?? p.name}</span>
        {#if p.characterId && isPc && sheetHref(p.characterId)}
          <a class="text-[10px] text-slate-400 hover:text-emerald-300" href={sheetHref(p.characterId)}>↗ sheet</a>
        {/if}
        <button
          class="ml-auto text-xs text-slate-500 hover:text-slate-300"
          title="Close detail panel"
          on:click={() => (selectedId = null)}
        >✕</button>
      </div>
      {#if canSeeStats}
        {#if isPc && cs?.species}
          <div class="mb-3 text-[11px] text-slate-400">
            {cs.species}{#if cs.subspecies} ({cs.subspecies}){/if}
          </div>
        {:else if !isPc && (p.statblock?.size || p.statblock?.type)}
          <div class="mb-3 text-[11px] text-slate-400">
            {[p.statblock?.size, p.statblock?.type].filter(Boolean).join(' ')}
          </div>
        {/if}
      {/if}

      <!-- HP edit (DM only, when target has a maxHp) -->
      {#if data.role === 'dm' && p.maxHp != null}
        {@const liveCur = liveHpMap[p.id]?.currentHp ?? p.currentHp}
        {@const liveTemp = liveHpMap[p.id]?.tempHp ?? p.tempHp ?? 0}
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <div class="text-[10px] uppercase tracking-wide text-slate-500">HP</div>
          <span class="font-mono text-sm text-slate-200">
            {liveCur ?? '—'} / {p.maxHp}{#if liveTemp > 0}<span class="text-emerald-300"> +{liveTemp}</span>{/if}
          </span>
          <input
            type="number"
            min="0"
            class="ml-2 w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-xs"
            placeholder="±hp"
            bind:value={hpInputs[p.id]}
          />
          <button
            class="rounded bg-red-700/60 px-2 py-0.5 text-xs hover:bg-red-700 disabled:opacity-40"
            title="Apply damage"
            disabled={busy}
            on:click={() => dmDamage(p)}
          >− dmg</button>
          <button
            class="rounded bg-emerald-700/60 px-2 py-0.5 text-xs hover:bg-emerald-700 disabled:opacity-40"
            title="Apply heal"
            disabled={busy}
            on:click={() => dmHeal(p)}
          >+ heal</button>
        </div>
      {/if}

      <!-- Conditions: fixed COMMON_CONDITIONS order regardless of active
           state. DMs see every condition (active/implied/inactive). Players
           only see active + implied — clutter-reducing, no toggle. Hover/focus
           on any chip surfaces the SRD description. -->
      <div class="mb-3">
        <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Conditions</div>
        <div class="flex flex-wrap gap-1 text-[11px]">
          {#each COMMON_CONDITIONS as c}
            {@const isActive = activeConds.includes(c)}
            {@const isImplied = implied.has(c)}
            {@const impSrc = implied.get(c)}
            {#if isActive || isImplied || data.role === 'dm'}
              <span class="group relative inline-flex">
                {#if isImplied && !isActive}
                  <span class="cursor-help rounded border border-slate-700 bg-slate-800/40 px-1.5 py-0.5 text-slate-500 italic">{c}</span>
                {:else if isActive}
                  <button
                    class="cursor-help rounded border border-amber-700 bg-amber-950/30 px-1.5 py-0.5 text-amber-200 hover:bg-amber-900/40 disabled:opacity-40 disabled:cursor-help"
                    disabled={busy || data.role !== 'dm'}
                    on:click={() => toggleCondition(p, c)}
                  >{c}{#if data.role === 'dm'} ×{/if}</button>
                {:else}
                  <button
                    class="cursor-help rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:bg-slate-800 disabled:opacity-40"
                    disabled={busy}
                    on:click={() => toggleCondition(p, c)}
                  >{c}</button>
                {/if}
                <span class="invisible absolute z-50 top-full left-0 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-950/95 p-2 text-xs text-slate-300 shadow-lg shadow-slate-900/80 opacity-0 transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 pointer-events-none">
                  <div class="font-semibold uppercase tracking-wide text-slate-200">{c}</div>
                  {#if isImplied}<div class="mb-1 text-[10px] text-slate-500">implied by {impSrc}</div>{/if}
                  <div class="mt-1 whitespace-pre-line">{CONDITION_DESCRIPTIONS[c] ?? '(no description)'}</div>
                </span>
              </span>
            {/if}
          {/each}
          {#if data.role !== 'dm' && activeConds.length === 0 && implied.size === 0}
            <span class="text-slate-600">none</span>
          {/if}
        </div>
      </div>

      <!-- Concentration (DM only) -->
      {#if data.role === 'dm'}
        <div class="mb-3">
          <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Concentration</div>
          {#if concLbl !== null}
            <span class="inline-flex items-center gap-1 rounded border border-violet-600 bg-violet-900/40 px-2 py-0.5 text-[11px] text-violet-200">
              🌀 {concLbl || 'concentrating'}
              <button class="text-violet-300 hover:text-violet-100" on:click={() => clearConcentrating(p)}>×</button>
            </span>
          {:else}
            <div class="flex items-center gap-1">
              <input
                class="w-44 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                placeholder="bless, hex, hold person…"
                maxlength="80"
                bind:value={concDraft}
                on:keydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const label = concDraft.trim();
                    if (label) { startConcentrating(p, label); concDraft = ''; }
                  }
                }}
              />
              <button
                class="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                disabled={busy || !concDraft.trim()}
                on:click={() => { const label = concDraft.trim(); if (label) { startConcentrating(p, label); concDraft = ''; } }}
              >start</button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Legendary actions tracker (DM only, non-PC with legendary actions) -->
      {#if data.role === 'dm' && !isPc && (p.statblock?.legendaryActions?.length ?? 0) > 0}
        {@const legMax = 3}
        {@const legUsed = legendaryUsed[p.id] ?? 0}
        <div class="mb-3">
          <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Legendary Actions</div>
          <div class="flex items-center gap-2 text-xs">
            <div class="flex gap-1">
              {#each Array(legMax) as _, i}
                <button
                  class="h-5 w-5 rounded border text-center text-[11px] {i < legUsed ? 'border-amber-500 bg-amber-900/50 text-amber-300' : 'border-slate-600 text-slate-600 hover:border-slate-400'}"
                  title={i < legUsed ? 'Mark unused' : 'Mark used'}
                  on:click={() => toggleLegendaryAction(p.id, legMax)}
                >★</button>
              {/each}
            </div>
            <span class="text-slate-400">{legUsed}/{legMax} used</span>
            {#if legUsed > 0}
              <button class="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline" on:click={() => { legendaryUsed[p.id] = 0; legendaryUsed = legendaryUsed; }}>reset</button>
            {/if}
          </div>
          {#if p.statblock?.legendaryActions && p.statblock.legendaryActions.length > 0}
            <ul class="mt-1 space-y-0.5 text-[11px] text-slate-400">
              {#each p.statblock.legendaryActions as la}
                <li><span class="text-slate-300">{la.name}</span>{#if la.description} — {la.description.slice(0, 80)}{la.description.length > 80 ? '…' : ''}{/if}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <!-- NPC spell slot tracker (DM only, non-PC) -->
      {#if data.role === 'dm' && !isPc}
        {@const slots = npcSpellSlots[p.id] ?? {}}
        {@const usedLevels = SPELL_LEVELS.filter((l) => (slots[l]?.max ?? 0) > 0)}
        <div class="mb-3">
          <div class="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-500">
            <span>Spell Slots</span>
            <button
              class="normal-case text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
              on:click={() => { showSlotEditor[p.id] = !showSlotEditor[p.id]; showSlotEditor = showSlotEditor; }}
            >{showSlotEditor[p.id] ? 'done' : 'edit'}</button>
          </div>
          {#if showSlotEditor[p.id]}
            <div class="flex flex-wrap gap-2 text-xs">
              {#each SPELL_LEVELS as level}
                <label class="flex items-center gap-1">
                  <span class="text-slate-500">L{level}</span>
                  <input
                    type="number"
                    min="0"
                    max="9"
                    class="w-10 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-[11px]"
                    value={slots[level]?.max ?? 0}
                    on:change={(e) => setSlotMax(p.id, level, Math.max(0, Math.min(9, +(e.currentTarget.value) || 0)))}
                  />
                </label>
              {/each}
            </div>
          {:else if usedLevels.length > 0}
            <div class="flex flex-wrap gap-3 text-xs">
              {#each usedLevels as level}
                {@const s = slots[level]}
                <div class="flex items-center gap-1">
                  <span class="text-slate-500">L{level}</span>
                  {#each Array(s.max) as _, i}
                    <button
                      class="h-4 w-4 rounded border text-center text-[9px] {i < s.used ? 'border-violet-500 bg-violet-900/50 text-violet-300' : 'border-slate-600 text-slate-600 hover:border-slate-400'}"
                      title={i < s.used ? 'Restore slot' : 'Expend slot'}
                      on:click={() => toggleSlotUsed(p.id, level, i)}
                    >◆</button>
                  {/each}
                </div>
              {/each}
            </div>
          {:else}
            <span class="text-[11px] text-slate-600">None set — click edit to add</span>
          {/if}
        </div>
      {/if}

      <!-- Stats -->
      {#if canSeeStats}
        <div class="mb-3">
          <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Stats</div>
          {#if p.statblock}
            <MonsterStatblockView statblock={p.statblock} dense />
          {:else if cs}
            <div class="rounded border border-slate-800 bg-slate-950/60 p-2 text-xs">
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                <span><span class="text-slate-500">AC</span> {cs.ac}</span>
                <span><span class="text-slate-500">HP</span> {cs.hp.current}/{cs.hp.max}{#if cs.hp.temp > 0}<span class="text-emerald-300"> +{cs.hp.temp}</span>{/if}</span>
                <span><span class="text-slate-500">prof</span> +{cs.proficiencyBonus}</span>
                <span><span class="text-slate-500">lvl</span> {cs.totalLevel}</span>
                <span><span class="text-slate-500">pp</span> {cs.passivePerception}</span>
                {#each Object.entries(cs.speeds) as [mode, ft]}
                  <span><span class="text-slate-500">{mode}</span> {ft}ft</span>
                {/each}
              </div>
              <div class="grid grid-cols-6 gap-1 text-center font-mono mb-2">
                {#each ['str','dex','con','int','wis','cha'] as ab}
                  {@const cell = cs.abilities[ab]}
                  {#if cell}
                    <div class="rounded border border-slate-800 bg-slate-900/40 px-1 py-0.5">
                      <div class="text-[10px] uppercase tracking-wide text-slate-500">{ab}</div>
                      <div class="text-sm">{cell.score}</div>
                      <div class="text-[10px] text-slate-400">{cell.mod >= 0 ? '+' : ''}{cell.mod}</div>
                    </div>
                  {/if}
                {/each}
              </div>
              <div class="grid grid-cols-2 gap-x-3">
                <div>
                  <div class="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Saves</div>
                  <ul class="text-slate-400">
                    {#each ['str','dex','con','int','wis','cha'] as ab}
                      {@const s = cs.saves[ab]}
                      {#if s}
                        <li><span class={s.proficient ? 'text-emerald-300' : 'text-slate-400'}>{s.proficient ? '●' : '○'} {ab.toUpperCase()}</span> <span class="font-mono text-slate-300">{s.bonus >= 0 ? '+' : ''}{s.bonus}</span></li>
                      {/if}
                    {/each}
                  </ul>
                </div>
                <div>
                  <div class="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Proficient skills</div>
                  <ul class="text-slate-400">
                    {#each Object.entries(cs.skills).filter(([, sk]) => sk.proficient).sort(([a],[b]) => a.localeCompare(b)) as [name, sk]}
                      <li><span class={sk.expertise ? 'text-emerald-300' : 'text-slate-300'}>{sk.expertise ? '◆' : '●'} {name.replace(/-/g, ' ')}</span> <span class="font-mono text-slate-300">{sk.bonus >= 0 ? '+' : ''}{sk.bonus}</span></li>
                    {/each}
                  </ul>
                </div>
              </div>
              {#if cs.spellcastingAbility}
                <div class="mt-2 flex flex-wrap gap-x-3 text-[11px]">
                  <span class="text-slate-500">Spellcasting</span>
                  <span class="uppercase font-semibold">{cs.spellcastingAbility}</span>
                  <span><span class="text-slate-500">DC</span> {cs.spellSaveDC}</span>
                  <span><span class="text-slate-500">atk</span> {(cs.spellAttackBonus ?? 0) >= 0 ? '+' : ''}{cs.spellAttackBonus ?? 0}</span>
                </div>
              {/if}
              {#if cs.resistances.length > 0 || cs.immunities.length > 0 || cs.vulnerabilities.length > 0 || cs.incomingCritImmune}
                <div class="mt-1 text-[11px]">
                  {#if cs.resistances.length > 0}<div><span class="text-slate-500">Resist:</span> {cs.resistances.join(', ')}</div>{/if}
                  {#if cs.immunities.length > 0}<div><span class="text-slate-500">Immune:</span> {cs.immunities.join(', ')}</div>{/if}
                  {#if cs.vulnerabilities.length > 0}<div><span class="text-slate-500">Vulnerable:</span> {cs.vulnerabilities.join(', ')}</div>{/if}
                  {#if cs.incomingCritImmune}<div><span class="text-slate-500">Crit immune:</span> critical hits become normal hits</div>{/if}
                </div>
              {/if}
              {#if Object.keys(cs.senses).length > 0}
                <div class="mt-1 text-[11px]">
                  <span class="text-slate-500">Senses:</span>
                  {#each Object.entries(cs.senses) as [sense, ft]}
                    <span class="ml-1">{sense} {ft}ft</span>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Plan / action economy -->
      {#if roundEconomy[p.id] && (data.role === 'dm' || isPc)}
        <div class="mb-3">
          <PlanPanel
            participant={p}
            plan={plan ?? null}
            role={data.role}
            participants={liveParticipants}
            actionChoices={actionChoicesFor(p)}
            bonusChoices={bonusChoicesFor(p)}
            {walkSpeed}
            {busy}
            economy={roundEconomy[p.id]}
            showSlotLevel={!isPc && isSpellAction(p.id)}
            on:actionPick={(e) => persistPlan(p, { actionId: e.detail })}
            on:bonusPick={(e) => persistPlan(p, { bonusActionId: e.detail })}
            on:targetPick={(e) => persistPlan(p, { targetParticipantIds: e.detail })}
            on:bonusTargetPick={(e) => persistPlan(p, { bonusTargetParticipantIds: e.detail })}
            on:toggleActionUsed={() => { roundEconomy[p.id].actionUsed = !roundEconomy[p.id].actionUsed; roundEconomy = roundEconomy; }}
            on:toggleBonusUsed={() => { roundEconomy[p.id].bonusUsed = !roundEconomy[p.id].bonusUsed; roundEconomy = roundEconomy; }}
            on:toggleReactionUsed={() => { roundEconomy[p.id].reactionUsed = !roundEconomy[p.id].reactionUsed; roundEconomy = roundEconomy; }}
            on:movementDelta={(e) => { roundEconomy[p.id].movement = Math.max(0, Math.min(walkSpeed, roundEconomy[p.id].movement + e.detail)); roundEconomy = roundEconomy; }}
            on:movementReset={() => { roundEconomy[p.id].movement = 0; roundEconomy = roundEconomy; }}
            on:slotLevelChange={(e) => { roundEconomy[p.id].slotLevel = e.detail; roundEconomy = roundEconomy; }}
            on:freeActionsChange={(e) => { roundEconomy[p.id].freeActions = e.detail; roundEconomy = roundEconomy; }}
            on:resolve={() => openResolve(p)}
            on:clear={() => clearPlan(p.id)}
          />
        </div>
      {/if}

      <!-- Reveals (DM only, non-PC) -->
      {#if data.role === 'dm' && !isPc && p.reveals}
        <div class="mb-3">
          <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Reveals</div>
          <div class="flex flex-wrap items-center gap-1 text-[11px]">
            <RevealChip label="identity" on={p.reveals.identity} on:toggle={(e) => patchReveal(p.id, { identity: e.detail })} disabled={busy} />
            <RevealChip label="vitals" on={p.reveals.vitals} on:toggle={(e) => patchReveal(p.id, { vitals: e.detail })} disabled={busy} />
            <RevealChip label="combat" on={p.reveals.combat} on:toggle={(e) => patchReveal(p.id, { combat: e.detail })} disabled={busy} />
            <RevealChip label="hidden" tone="danger" on={p.reveals.hidden} on:toggle={(e) => patchReveal(p.id, { hidden: e.detail })} disabled={busy} />
            <button class="ml-2 text-slate-500 hover:text-emerald-300 underline-offset-2 hover:underline text-[11px]" on:click={() => revealAll(p.id)} disabled={busy}>reveal all</button>
            <button class="text-slate-500 hover:text-slate-300 underline-offset-2 hover:underline text-[11px]" on:click={() => hideAll(p.id)} disabled={busy}>hide all</button>
          </div>
        </div>
      {/if}

      <!-- Monster edit (DM only, non-PC) -->
      {#if data.role === 'dm' && !isPc}
        <div>
          <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Edit</div>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <label class="flex items-center gap-1">
              <span class="text-slate-500">Name</span>
              <input
                class="w-40 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                bind:value={editMonsterNameDraft}
                maxlength="120"
              />
            </label>
            <label class="flex items-center gap-1">
              <span class="text-slate-500">Type</span>
              <select
                class="w-48 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                bind:value={editMonsterSlugDraft}
              >
                <option value="">— ad-hoc —</option>
                {#each data.monsterOptions as m}
                  <option value={m.slug}>{m.name} (CR {m.cr})</option>
                {/each}
              </select>
            </label>
            <button
              class="rounded bg-emerald-700/70 px-2 py-0.5 text-[11px] hover:bg-emerald-700 disabled:opacity-40"
              disabled={busy || !editMonsterNameDraft.trim()}
              on:click={() => saveMonsterEdit(p)}
            >save</button>
            <button
              class="ml-auto rounded border border-red-800 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-900/60 disabled:opacity-40"
              disabled={busy}
              on:click={() => removeParticipant(p.id)}
            >Remove from encounter</button>
          </div>
        </div>
      {/if}
    </section>
  {/if}
{/if}

{#if data.role === 'dm'}
  <AddParticipantModal
    bind:this={addParticipantModal}
    bind:open={showAddParticipantModal}
    {busy}
    campaignCharacters={data.campaignCharacters}
    monsterOptions={data.monsterOptions}
    on:add={(e) => addParticipant(e.detail)}
  />
{/if}

{#if resolveForParticipantId && data.role === 'dm'}
  <ResolvePanel
    participants={liveParticipants}
    actingParticipantId={resolveForParticipantId}
    amending={amendingLogId !== null}
    submitting={resolveSubmitting}
    error={resolveError}
    targetCritImmune={pcCritImmune(resolveTargetId)}
    bind:actionLabel={resolveActionLabel}
    bind:targetId={resolveTargetId}
    bind:attack={resolveAttack}
    bind:damage={resolveDamage}
    bind:hit={resolveHit}
    bind:notes={resolveNotes}
    bind:saveDC={resolveSaveDC}
    bind:multiTargetIds={resolveMultiTargetIds}
    bind:targetSaveRolls={resolveTargetSaveRolls}
    on:submit={() => (amendingLogId ? submitAmend() : submitDmResolve())}
    on:cancel={() => {
      amendingLogId = null;
      closeResolve();
    }}
  />
{/if}

{#if concSavePrompt && data.role === 'dm'}
  <ConcentrationSavePrompt
    participantName={concSavePrompt.participantName}
    dc={concSavePrompt.dc}
    on:drop={() => dropConcentration(concSavePrompt?.participantId ?? '')}
    on:dismiss={() => (concSavePrompt = null)}
  />
{/if}

{#if data.role === 'dm'}
  <ReactionPromptQueue
    prompts={reactionPrompts}
    on:use={(e) => {
      ensureEconomy(e.detail.participantId).reactionUsed = true;
      roundEconomy = roundEconomy;
      reactionPrompts = reactionPrompts.slice(1);
    }}
    on:skip={() => (reactionPrompts = reactionPrompts.slice(1))}
  />
{/if}

<ActionLogSection
  log={data.actionLog}
  participants={liveParticipants}
  role={data.role}
  {busy}
  on:amend={(e) => openAmend(e.detail)}
  on:remove={(e) => removeLogEntry(e.detail)}
/>

