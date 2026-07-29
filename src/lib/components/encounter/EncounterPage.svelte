<script lang="ts">
  import { browser } from '$app/environment';
  import { goto, invalidateAll } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { api } from '$lib/client/api';
  import { confirmDialog } from '$lib/components/ui/confirm';
  import ParticipantRowCard from '$lib/components/ParticipantRowCard.svelte';
  import PlanPanel from '$lib/components/PlanPanel.svelte';
  import MonsterStatblockView from '$lib/components/MonsterStatblockView.svelte';
  import ActionLogSection from './ActionLogSection.svelte';
  import AddParticipantModal from './AddParticipantModal.svelte';
  import ConcentrationSavePrompt from './ConcentrationSavePrompt.svelte';
  import EncounterHeader from './EncounterHeader.svelte';
  import EncounterDifficultyPanel, {
    type DifficultyReadout
  } from './EncounterDifficultyPanel.svelte';
  import TurnControls from './TurnControls.svelte';
  import ConcentrationEditor from './ConcentrationEditor.svelte';
  import ConditionChips from './ConditionChips.svelte';
  import HpAdjustRow from './HpAdjustRow.svelte';
  import MonsterEditForm from './MonsterEditForm.svelte';
  import PcStatsCard from './PcStatsCard.svelte';
  import LegendaryActionTracker from './LegendaryActionTracker.svelte';
  import YourTurnBanner from './YourTurnBanner.svelte';
  import NpcSpellSlotTracker from './NpcSpellSlotTracker.svelte';
  import RevealControls from './RevealControls.svelte';
  import ReactionPromptQueue from './ReactionPromptQueue.svelte';
  import ResolvePanel from './ResolvePanel.svelte';
  import { impliedBy } from '$lib/rules/conditions';
  import { costLabel, slotForCost } from '$lib/rules/action-cost';
  import { actionAvailability, resourceSuffix } from '$lib/encounter/action-availability';
  import {
    isViewersTurn,
    notifyState,
    shouldNotifyTurn,
    type NotificationPermissionLike
  } from '$lib/encounter/turn-notify';
  import {
    EMPTY_ECONOMY,
    economyIsClear,
    legendaryUsedForRound,
    resetTurnEconomy,
    type CombatEconomy
  } from '$lib/realtime/economy';
  import { applyDamageDelta, applyHealDelta } from '$lib/rules/hp';
  import {
    conditionsForParticipant,
    toggleArrayValue,
    patchPcWithMirror
  } from '$lib/encounter/conditions';
  import {
    clearTimer,
    expiryPromptsForTurn,
    normalizeTimers,
    promptKey,
    pruneTimers,
    setTimer,
    timersForParticipant,
    type ConditionExpiryPrompt,
    type ConditionTimer
  } from '$lib/encounter/condition-timers';
  import ConditionExpiryPromptCard from './ConditionExpiryPrompt.svelte';
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
    firedEventsForResolution,
    downgradeCritForTarget,
    resolvedActionId,
    ADHOC_ACTION_ID,
    reactionPromptsForResolution,
    concentrationChecksForResolution,
    type ConcentrationCheck,
    type HitOutcome,
    type ResolveTarget,
    type TargetResolution
  } from '$lib/realtime/resolve';
  import type { EncounterPageData } from '$lib/server/encounter-page';

  export let data: EncounterPageData;
  /** Route-specific link targets — the two encounter routes differ only in
   *  URL scheme (/c/[code]/... vs /campaigns/[dmUsername]/[slug]/...). */
  export let encountersHref: string;
  /** Sheet link for a PC participant's character; undefined renders no link. */
  export let sheetHref: (characterId: string) => string | undefined;
  /** Link to a sibling encounter in this campaign — used to land on the clone. */
  export let encounterHref: (encounterId: string) => string;

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
      // Condition timers seed from the character document (PCs) or the
      // participant's plan_json (everyone else) — the same two homes the
      // poll projects from, so first paint agrees with the first poll.
      const conditionTimers =
        p.kind === 'pc'
          ? (data.participantPcConditionTimers?.[p.id] ?? [])
          : normalizeTimers(
              (data.participantPlans?.[p.id] as { conditionTimers?: unknown } | undefined)
                ?.conditionTimers
            );
      seedHp[p.id] = {
        currentHp: stats ? stats.hp.current : p.currentHp,
        tempHp: stats ? stats.hp.temp : (p.tempHp ?? 0),
        conditions,
        conditionTimers: pruneTimers(conditionTimers, conditions),
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
  let resolveActionLabel = '';
  /** What the draft was seeded with. The DM edits the label freely (typing,
   *  or the panel's statblock / common-action buttons); `resolvedActionId`
   *  compares against these so the id the log row carries never claims to be
   *  an action the label no longer names. */
  let resolveSeedActionId = '';
  let resolveSeedActionLabel = '';
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
      resolveSeedActionId = plan.actionId;
      resolveActionLabel = plan.actionLabel;
      resolveTargetId = plan.targetParticipantIds?.[0] ?? null;
      resolveNotes = plan.notes;
    } else {
      resolveSeedActionId = ADHOC_ACTION_ID;
      resolveActionLabel = 'Ad-hoc';
      resolveTargetId = null;
      resolveNotes = '';
    }
    resolveSeedActionLabel = resolveActionLabel;
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

  /** Single-target apply: HP delta via participant API + one log entry. */
  async function dmApplyToTarget(
    targetId: string | null,
    outcome: HitOutcome,
    damage: number | null,
    attack: number | null,
    round: number
  ): Promise<{ ok: boolean; hpBefore: number | null; hpAfter: number | null }> {
    if (!conn || !resolveForParticipantId) return { ok: false, hpBefore: null, hpAfter: null };
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
      actionId: resolvedActionId({
        seededActionId: resolveSeedActionId,
        seededActionLabel: resolveSeedActionLabel,
        label: resolveActionLabel
      }),
      actionLabel: resolveActionLabel,
      notes: resolveNotes
    });
    return {
      ok: result.ok,
      hpBefore: result.targetHpBefore,
      hpAfter: result.targetHpAfter
    };
  }

  /** Was this participant concentrating when the action resolved? PCs mirror
   *  their character document into the poll snapshot, so the live HP map is
   *  the single source for both kinds. */
  function isConcentrating(participantId: string): boolean {
    return !!liveHpMap[participantId]?.concentrating;
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
    // One entry per target the action landed on, carrying the outcome that
    // actually applied there. Everything downstream (concentration checks,
    // reaction triggers) reads this instead of the form's dropdown.
    const resolutions: TargetResolution[] = [];
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
          const { ok, hpBefore, hpAfter } = await dmApplyToTarget(
            tid,
            perTargetOutcome,
            resolveDamage,
            saveRoll ?? null,
            round
          );
          if (!ok) {
            resolveError = `log entry failed for ${t.name}`;
            return;
          }
          resolutions.push({
            participantId: tid,
            participantName: t.name,
            outcome: perTargetOutcome,
            damage: resolveDamage,
            concentrating: isConcentrating(tid),
            hpBefore,
            hpAfter
          });
        }
      } else {
        const { ok, hpBefore, hpAfter } = await dmApplyToTarget(
          resolveTargetId,
          singleOutcome,
          resolveDamage,
          resolveAttack,
          round
        );
        if (!ok) {
          resolveError = 'log entry failed';
          return;
        }
        if (resolveTargetId) {
          resolutions.push({
            participantId: resolveTargetId,
            participantName:
              liveParticipants.find((p) => p.id === resolveTargetId)?.name ?? 'Target',
            outcome: singleOutcome,
            damage: resolveDamage,
            concentrating: isConcentrating(resolveTargetId),
            hpBefore,
            hpAfter
          });
        }
      }
      // Concentrating targets that took damage owe a CON save. Multi-target
      // saves can raise several at once, so they queue and the DM answers
      // them one at a time.
      const checks = concentrationChecksForResolution(resolutions);
      if (checks.length > 0) concSavePrompts = [...concSavePrompts, ...checks];
      // Build the set of events that fired from this resolution, from each
      // target's own outcome. A targetless resolution has no per-target
      // result, so it still keys off the form's outcome.
      // `attack.reduce-to-zero` rides along on the same per-target results:
      // their HP comes from the mutation itself, not the poll snapshot.
      const firedEvents = firedEventsForResolution(
        resolutions.length > 0 ? resolutions : [{ outcome: singleOutcome }]
      );
      const reactionUsedByParticipantId: Record<string, boolean> = {};
      for (const q of liveParticipants) {
        if (economyFor(q.id).reactionUsed) reactionUsedByParticipantId[q.id] = true;
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

  /** Drop concentration for the head-of-queue CON save callout. Either
   *  answer (drop or dismiss) shifts the queue so the next check surfaces. */
  function dropConcentration(participantId: string) {
    const p = liveParticipants.find((q) => q.id === participantId);
    if (p && conn && connStatus === 'open') {
      conn.setConcentration(participantId, null).catch(() => {});
    }
    concSavePrompts = concSavePrompts.slice(1);
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
    resolveActionLabel = entry.actionLabel;
    resolveSeedActionId = entry.actionId;
    resolveSeedActionLabel = entry.actionLabel;
    resolveTargetId = entry.targetParticipantId;
    resolveAttack = entry.attackRoll;
    resolveDamage = entry.damageRoll;
    resolveHit = (entry.hit ?? '') as typeof resolveHit;
    resolveNotes = entry.notes ?? '';
    resolveError = null;
    // Same reset as openResolve/closeResolve: an amendment corrects one
    // existing row, so it must not inherit the multi-target save draft a
    // previous resolution left behind.
    resolveSaveDC = null;
    resolveMultiTargetIds = [];
    resolveTargetSaveRolls = {};
  }

  // ---- difficulty rating (DM only) ---------------------------------------
  // Replaces the old client-side `sum(statblock.xp)` gauge, which had no
  // encounter multiplier and no party thresholds. The real math is server
  // side at GET /api/encounters/[id]/difficulty.
  //
  // DM only, and gated *before* the request rather than by swallowing the
  // error: the endpoint 403s players by design (it sees the full roster,
  // hidden monsters included), so a player fetching it would be a guaranteed
  // failed request — noisy in the log and, without `silent`, a toast in their
  // face for something they never asked for.
  let difficulty: DifficultyReadout | null = null;
  let difficultyLoading = false;
  /** Roster signature the current reading was computed from. */
  let difficultySig: string | null = null;

  async function loadDifficulty() {
    difficultyLoading = true;
    try {
      // silent: an advisory readout must never toast. The panel degrades to
      // "Difficulty unavailable." on its own.
      difficulty = await api.get<DifficultyReadout>(
        `/api/encounters/${data.encounter.id}/difficulty`,
        { silent: true }
      );
    } catch {
      difficulty = null;
    } finally {
      difficultyLoading = false;
    }
  }

  /** Refetch when the roster changes. `liveParticipants` is the same list the
   *  poll reconciliation feeds (for the DM: SSR rows, re-run by invalidateAll
   *  on every local mutation and by the poll-driven refresh above), so this
   *  rides that instead of putting a second endpoint on a timer. The slug is
   *  in the signature too — swapping a monster's statblock changes its CR —
   *  and so is each PC's total level, since the party thresholds move when
   *  someone levels mid-session. `participantPcStats` is SSR data, but the
   *  DM page re-runs invalidateAll off the channel on each successful poll,
   *  so a level-up lands within one interval. */
  $: if (browser && data.role === 'dm') {
    const sig = liveParticipants
      .map(
        (p) =>
          `${p.id}:${p.kind}:${p.statblockSlug ?? ''}:${data.participantPcStats?.[p.id]?.totalLevel ?? ''}`
      )
      .sort()
      .join(',');
    if (sig !== difficultySig) {
      difficultySig = sig;
      void loadDifficulty();
    }
  }

  /** "Run it again": clone the roster into a fresh staging encounter and go
   *  there. Non-destructive, so no confirm — see EncounterHeader. */
  async function cloneEncounter() {
    if (data.role !== 'dm') return;
    busy = true;
    try {
      const created = await api.post<{ id: string }>(
        `/api/encounters/${data.encounter.id}/clone`
      );
      await goto(encounterHref(created.id));
    } catch {
      // api() already toasted
    } finally {
      busy = false;
    }
  }

  async function removeLogEntry(id: string) {
    if (data.role !== 'dm') return;
    const ok = await confirmDialog({
      title: 'Remove this log entry?',
      message: 'HP changes are not reverted.',
      confirmLabel: 'Remove',
      danger: true
    });
    if (!ok) return;
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
        actionId: resolveSeedActionId,
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
  let encounterName = data.encounter.name;

  async function submitRename(draft: string) {
    const trimmed = draft.trim();
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
    if (!(await confirmDialog({ title: 'Remove this participant?', confirmLabel: 'Remove', danger: true })))
      return;
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
    if (status === 'ended') {
      const ok = await confirmDialog({
        title: 'End this encounter?',
        message: 'It becomes read-only history.',
        confirmLabel: 'End encounter',
        danger: true
      });
      if (!ok) return;
    }
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

  // ---- conditions + round-scoped durations --------------------------------
  //
  // The flat `conditions` list stays the source of truth for "is this on";
  // the timer list is a parallel overlay keyed by condition slug. Every
  // write keeps the two consistent: switching a condition off drops its
  // timer, and the poll prunes orphans server-side as a backstop.
  // See $lib/encounter/condition-timers.

  /** Rounds the *next* condition the DM switches on should last. 0 = none. */
  let pendingConditionDuration = 0;

  type ParticipantLite = {
    id: string;
    kind: string;
    characterId: string | null;
    currentHp: number | null;
    tempHp: number;
    conditions: string[];
  };

  function timersFor(p: { id: string; kind: string }): ConditionTimer[] {
    return timersForParticipant(
      p,
      data.participantPcConditionTimers,
      liveHpMap[p.id]?.conditionTimers
    );
  }

  /** Persist a participant's timer overlay. PCs write the character
   *  document; everyone else merges into plan_json. */
  async function writeTimers(p: ParticipantLite, next: ConditionTimer[]) {
    if (p.kind === 'pc') {
      if (!p.characterId) return;
      const prev = data.participantPcConditionTimers?.[p.id] ?? [];
      data.participantPcConditionTimers = {
        ...(data.participantPcConditionTimers ?? {}),
        [p.id]: next
      };
      try {
        await conn?.setConditionTimers(p.id, p.characterId, next);
      } catch {
        data.participantPcConditionTimers = {
          ...(data.participantPcConditionTimers ?? {}),
          [p.id]: prev
        };
      }
      return;
    }
    conn?.setConditionTimers(p.id, null, next).catch(() => {});
  }

  async function toggleCondition(p: ParticipantLite, cond: string) {
    // No template-reactivity concern here — this is called from an event
    // handler, so reading data.participantPcConditions imperatively is fine.
    const current = conditionsForParticipant(
      p,
      data.participantPcConditions,
      liveHpMap[p.id]?.conditions
    );
    const next = toggleArrayValue(current, cond);
    const turningOn = next.includes(cond);
    // Switching on with a duration selected starts its timer; switching off
    // drops it so no orphan can raise an expiry prompt later.
    const timers = turningOn
      ? setTimer(timersFor(p), cond, liveRound, pendingConditionDuration)
      : clearTimer(timersFor(p), cond);
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
      await writeTimers(p, timers);
      return;
    }
    if (conn && connStatus === 'open') {
      conn.setConditions(p.id, next).catch(() => {});
      await writeTimers(p, timers);
    } else {
      try {
        await api.patch(`/api/participants/${p.id}`, { conditions: next });
        await invalidateAll();
      } catch {
        // api() already toasted
      }
    }
  }

  /** Set (or clear, at 0) the duration of an already-applied condition. */
  function setConditionDuration(p: ParticipantLite, cond: string, rounds: number) {
    void writeTimers(p, setTimer(timersFor(p), cond, liveRound, rounds));
  }

  // ---- condition-expiry prompt queue --------------------------------------
  //
  // Raised at the start of the affected participant's turn, one at a time,
  // in the same slot and with the same "+N more" affordance as the reaction
  // and concentration queues. NOTHING is removed until the DM answers — see
  // the module comment in $lib/encounter/condition-timers for why silent
  // expiry would be worse than today's forever-conditions.
  let conditionExpiryPrompts: ConditionExpiryPrompt[] = [];
  /** Prompt keys already raised, so a re-render (or the 2s poll re-confirming
   *  the same turn) can't queue the same lapse twice. */
  let raisedExpiryKeys = new Set<string>();

  $: if (browser && data.role === 'dm' && liveStatus === 'live') {
    const due = expiryPromptsForTurn({
      round: liveRound,
      activeParticipantId: liveActive,
      participants: liveParticipants,
      conditionsFor: (id) => {
        const q = liveParticipants.find((r) => r.id === id);
        return q ? conditionsForParticipant(q, data.participantPcConditions, liveHpMap[id]?.conditions) : [];
      },
      timersFor: (id) => {
        const q = liveParticipants.find((r) => r.id === id);
        return q ? timersFor(q) : [];
      }
    }).filter((prompt) => !raisedExpiryKeys.has(promptKey(prompt)));
    if (due.length > 0) {
      for (const prompt of due) raisedExpiryKeys.add(promptKey(prompt));
      raisedExpiryKeys = raisedExpiryKeys;
      conditionExpiryPrompts = [...conditionExpiryPrompts, ...due];
    }
  }

  /** Answer the head of the expiry queue. `remove` drops the condition (and
   *  its timer); `extend` pushes the timer out; `keep` clears the timer and
   *  leaves the condition on indefinitely. All three shift the queue. */
  function answerExpiry(prompt: ConditionExpiryPrompt, choice: 'remove' | 'keep', extendBy = 0) {
    const p = liveParticipants.find((q) => q.id === prompt.participantId);
    conditionExpiryPrompts = conditionExpiryPrompts.slice(1);
    if (!p) return;
    if (choice === 'remove') {
      void toggleCondition(p, prompt.condition);
      return;
    }
    void writeTimers(
      p,
      extendBy > 0
        ? setTimer(timersFor(p), prompt.condition, liveRound, extendBy)
        : clearTimer(timersFor(p), prompt.condition)
    );
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

  // Concentration save callouts raised by the last resolve. A multi-target
  // save can damage several concentrating PCs at once, so this is a queue
  // rendered one at a time (same slot as the reaction queue below) and each
  // answer shifts the head.
  let concSavePrompts: ConcentrationCheck[] = [];

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

  /** Save the rename + statblock swap. If the slug changed, also reset HP to
   *  the new monster's max so the row reflects the swap. Drafts come from
   *  MonsterEditForm, which seeds them from the selected participant. */
  async function saveMonsterEdit(
    p: { id: string; name: string; statblockSlug: string | null; maxHp: number | null },
    draft: { name: string; slug: string }
  ) {
    const nextName = draft.name.trim();
    const nextSlug = draft.slug.trim();
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

  // ---- Action economy foldout ----
  //
  // Two layers. The *scratch* layer (free-actions text, cast-at-slot pick)
  // is display-only and stays client-side; its presence in `econOpen` also
  // gates whether the foldout renders at all. The *spent* layer (action /
  // bonus / reaction / movement, plus the legendary counter below) is
  // server state — see $lib/realtime/economy — so it survives a reload and
  // a second DM tab agrees.
  interface EconomyScratch {
    freeActions: string;
    slotLevel: number;
  }
  let econOpen: Record<string, EconomyScratch> = {};

  function ensureEconomy(id: string): EconomyScratch {
    if (!econOpen[id]) {
      econOpen[id] = { freeActions: '', slotLevel: 1 };
      econOpen = econOpen;
    }
    return econOpen[id];
  }

  /** Server-projected spent state, poll-fresh. Falls back to the SSR seed
   *  for PCs before the first poll lands, then to all-clear.
   *
   *  `economyByParticipant` is the template-facing form: Svelte only tracks
   *  *variables* named in a markup expression, so a bare `economyFor(id)`
   *  call would never re-render when the poll moved. Handlers use
   *  `economyFor` directly — they run after the fact and read live values. */
  $: liveEconomy = liveState?.participantEconomy ?? {};
  function economyFor(participantId: string): CombatEconomy {
    const live = liveEconomy[participantId];
    if (live) return live;
    const ssr = data.participantPcEconomy?.[participantId];
    if (ssr) return { ...ssr, legendaryUsed: 0 };
    return { ...EMPTY_ECONOMY };
  }
  $: economyByParticipant = ((
    rows: typeof liveParticipants,
    live: typeof liveEconomy,
    ssr: EncounterPageData['participantPcEconomy'] | undefined
  ) => {
    const out: Record<string, CombatEconomy> = {};
    for (const q of rows) {
      const l = live[q.id];
      const seed = ssr?.[q.id];
      out[q.id] = l ?? (seed ? { ...seed, legendaryUsed: 0 } : { ...EMPTY_ECONOMY });
    }
    return out;
  })(liveParticipants, liveEconomy, data.participantPcEconomy);

  /** Persist a participant's spent state. PCs write the character document
   *  (the fields the sheet already owns); everyone else writes
   *  plan_json.combat. Fire-and-forget: the channel rolls back and toasts. */
  function writeEconomy(
    p: { id: string; kind: string; characterId: string | null },
    next: CombatEconomy
  ) {
    if (!conn) return;
    conn.setEconomy(p.id, p.kind === 'pc' ? p.characterId : null, next).catch(() => {});
  }

  function mutateEconomy(
    p: { id: string; kind: string; characterId: string | null },
    fn: (e: CombatEconomy) => CombatEconomy
  ) {
    writeEconomy(p, fn(economyFor(p.id)));
  }

  /** Turn-rise reset: every slot replenishes. Gated to the DM so two open
   *  tabs don't both race a write, and skipped when nothing is spent. */
  function resetEconomy(p: { id: string; kind: string; characterId: string | null }) {
    if (data.role !== 'dm') return;
    const cur = economyFor(p.id);
    if (economyIsClear(cur)) return;
    writeEconomy(p, resetTurnEconomy(cur));
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
    unavailable?: boolean;
    unavailableReason?: string | null;
    resourceNote?: string;
  };

  /** Turn one derived PC action into a picker row, greyed + explained when
   *  the participant can't actually take it. The resource verdict is
   *  precomputed server-side (`affordable`, from the same
   *  `hasResourceBudget` the character sheet uses); the economy half comes
   *  from the live spent flags. */
  function pcChoice(
    economy: CombatEconomy | undefined,
    a: NonNullable<EncounterPageData['participantPcActions']>[string][number]
  ): PlanChoice {
    const avail = actionAvailability(a, economy);
    return {
      id: a.id,
      name: `${a.name}${a.attackCount != null && a.attackCount > 1 ? ` ×${a.attackCount}` : ''} (${costLabel(a.cost)})`,
      unavailable: avail.unavailable,
      unavailableReason: avail.reason,
      resourceNote: resourceSuffix(a)
    };
  }

  function actionChoicesFor(
    p: { id: string; kind: string; statblock: { actions?: Array<{ name: string; attackBonus?: number }> } | null },
    economy?: CombatEconomy
  ): PlanChoice[] {
    if (p.kind === 'pc') {
      return (data.participantPcActions?.[p.id] ?? [])
        .filter((a) => slotForCost(a.cost) === 'action')
        .map((a) => pcChoice(economy, a));
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
    p: { id: string; kind: string },
    economy?: CombatEconomy
  ): PlanChoice[] {
    if (p.kind === 'pc') {
      return (data.participantPcActions?.[p.id] ?? [])
        .filter((a) => slotForCost(a.cost) === 'bonus')
        .map((a) => pcChoice(economy, a));
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
      if (prevActive != null) {
        const leaving = liveParticipants.find((q) => q.id === prevActive);
        if (leaving) resetEconomy(leaving);
      }
      prevActive = current;
    }
  }


  const COMMON_BONUS_ACTIONS = ['Offhand attack', 'Dash', 'Disengage', 'Hide', 'Healing Word', 'Hex'];

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

  // ---- "your turn" callout ------------------------------------------------
  //
  // The active row is highlighted for everyone; this is the signal for the
  // one person whose character is up. `myParticipantIds` comes from the
  // loader (participants linked to a character the viewer owns), so a
  // player watching someone else's turn never sees it.
  $: myTurnParticipantId =
    isViewersTurn(liveActive, data.myParticipantIds) ? liveActive : null;
  $: myTurnName =
    myTurnParticipantId
      ? liveParticipants.find((q) => q.id === myTurnParticipantId)?.name ?? 'Your character'
      : '';

  // Browser notification: opt-in per device, background-tab only, and inert
  // wherever the API isn't available or permission was refused.
  const NOTIFY_PREF_KEY = 'grimoire:encounter-turn-notify';
  let notifySupported = false;
  let notifyPermission: NotificationPermissionLike = 'default';
  let notifyEnabled = false;
  let tabVisible = true;

  onMount(() => {
    notifySupported = typeof Notification !== 'undefined';
    if (notifySupported) notifyPermission = Notification.permission as NotificationPermissionLike;
    try {
      notifyEnabled = localStorage.getItem(NOTIFY_PREF_KEY) === '1';
    } catch {
      // private mode / storage disabled — stay off
    }
    const onVisibility = () => {
      tabVisible = globalThis.document.visibilityState === 'visible';
    };
    onVisibility();
    globalThis.document.addEventListener('visibilitychange', onVisibility);
    globalThis.addEventListener('focus', onVisibility);
    globalThis.addEventListener('blur', onVisibility);
    return () => {
      globalThis.document.removeEventListener('visibilitychange', onVisibility);
      globalThis.removeEventListener('focus', onVisibility);
      globalThis.removeEventListener('blur', onVisibility);
    };
  });

  $: turnNotifyState = notifyState({
    supported: notifySupported,
    permission: notifyPermission,
    enabled: notifyEnabled
  });

  async function toggleTurnNotify() {
    if (!notifySupported || notifyPermission === 'denied') return;
    if (!notifyEnabled && notifyPermission !== 'granted') {
      try {
        notifyPermission = (await Notification.requestPermission()) as NotificationPermissionLike;
      } catch {
        // Older Safari (callback-only) or a blocked prompt: leave it off
        // rather than pretending the toggle worked.
        notifyPermission = 'denied';
      }
      if (notifyPermission !== 'granted') return;
    }
    notifyEnabled = !notifyEnabled;
    try {
      localStorage.setItem(NOTIFY_PREF_KEY, notifyEnabled ? '1' : '0');
    } catch {
      // preference just won't persist
    }
  }

  // Rising edge only — a poll that re-confirms the same turn stays quiet.
  let wasMyTurn = false;
  $: if (browser) {
    const isMine = myTurnParticipantId != null;
    if (
      shouldNotifyTurn({
        enabled: notifyEnabled,
        supported: notifySupported,
        permission: notifyPermission,
        tabVisible,
        wasMyTurn,
        isMyTurn: isMine,
        encounterLive: liveStatus === 'live'
      })
    ) {
      try {
        new Notification(`Your turn — ${myTurnName}`, {
          body: `${data.encounter.name} · round ${liveRound}`,
          tag: `grimoire-turn-${data.encounter.id}`
        });
      } catch {
        // Some browsers throw on constructing a Notification outside a
        // service worker. Degrade silently — the banner still shows.
      }
    }
    wasMyTurn = isMine;
  }

  // Legendary action tracker. Persisted on the monster participant (see
  // $lib/realtime/economy) with the round it was written in, so it survives
  // a reload, agrees across DM tabs, and reads as spent-nothing again on
  // the next round without needing a write to clear it.
  function toggleLegendaryAction(
    p: { id: string; kind: string; characterId: string | null },
    max: number
  ) {
    const used = legendaryUsedForRound(economyFor(p.id), liveRound);
    setLegendaryUsed(p, used >= max ? 0 : used + 1);
  }
  function setLegendaryUsed(
    p: { id: string; kind: string; characterId: string | null },
    used: number
  ) {
    writeEconomy(p, { ...economyFor(p.id), legendaryUsed: used, round: liveRound });
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
  let showSlotEditor: Record<string, boolean> = {};
</script>

<svelte:head>
  <title>{data.encounter.name} — {data.campaign.name}</title>
</svelte:head>

<EncounterHeader
  name={encounterName}
  role={data.role}
  {busy}
  connStatus={conn ? connStatus : null}
  status={liveStatus}
  participantCount={liveParticipants.length}
  {encountersHref}
  bind:renaming={renamingEncounter}
  on:rename={(e) => submitRename(e.detail)}
  on:start={() => setEncounterStatus('live')}
  on:clone={cloneEncounter}
/>

{#if myTurnParticipantId && liveStatus === 'live'}
  <YourTurnBanner
    characterName={myTurnName}
    round={liveRound}
    notify={turnNotifyState}
    on:toggleNotify={toggleTurnNotify}
  />
{/if}

{#if data.role === 'dm'}
  <EncounterDifficultyPanel {difficulty} loading={difficultyLoading} />
{/if}

{#if liveStatus === 'live' && data.role === 'dm'}
  <TurnControls
    round={liveRound}
    {busy}
    on:advance={(e) => advanceTurn(e.detail)}
    on:end={() => setEncounterStatus('ended')}
  />
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
        <HpAdjustRow
          currentHp={liveHpMap[p.id]?.currentHp ?? p.currentHp}
          maxHp={p.maxHp}
          tempHp={liveHpMap[p.id]?.tempHp ?? p.tempHp ?? 0}
          bind:amount={hpInputs[p.id]}
          {busy}
          on:damage={() => dmDamage(p)}
          on:heal={() => dmHeal(p)}
        />
      {/if}

      <ConditionChips
        {activeConds}
        {implied}
        role={data.role}
        {busy}
        timers={timersFor(p)}
        round={liveRound}
        bind:pendingDuration={pendingConditionDuration}
        on:toggle={(e) => toggleCondition(p, e.detail)}
        on:setDuration={(e) => setConditionDuration(p, e.detail.condition, e.detail.rounds)}
      />

      <!-- Concentration (DM only) -->
      {#if data.role === 'dm'}
        <ConcentrationEditor
          label={concLbl}
          participantId={p.id}
          {busy}
          on:start={(e) => startConcentrating(p, e.detail)}
          on:clear={() => clearConcentrating(p)}
        />
      {/if}

      <!-- Legendary actions tracker (DM only, non-PC with legendary actions) -->
      {#if data.role === 'dm' && !isPc && (p.statblock?.legendaryActions?.length ?? 0) > 0}
        {@const legMax = 3}
        <LegendaryActionTracker
          legendaryActions={p.statblock?.legendaryActions ?? []}
          used={legendaryUsedForRound(economyByParticipant[p.id], liveRound)}
          max={legMax}
          on:toggle={() => toggleLegendaryAction(p, legMax)}
          on:reset={() => setLegendaryUsed(p, 0)}
        />
      {/if}

      <!-- NPC spell slot tracker (DM only, non-PC) -->
      {#if data.role === 'dm' && !isPc}
        <NpcSpellSlotTracker
          slots={npcSpellSlots[p.id] ?? {}}
          showEditor={showSlotEditor[p.id]}
          on:toggleEditor={() => { showSlotEditor[p.id] = !showSlotEditor[p.id]; showSlotEditor = showSlotEditor; }}
          on:setMax={(e) => setSlotMax(p.id, e.detail.level, e.detail.max)}
          on:toggleUsed={(e) => toggleSlotUsed(p.id, e.detail.level, e.detail.slotIdx)}
        />
      {/if}

      <!-- Stats -->
      {#if canSeeStats}
        <div class="mb-3">
          <div class="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Stats</div>
          {#if p.statblock}
            <MonsterStatblockView statblock={p.statblock} dense />
          {:else if cs}
            <PcStatsCard {cs} />
          {/if}
        </div>
      {/if}

      <!-- Plan / action economy -->
      {#if econOpen[p.id] && (data.role === 'dm' || isPc)}
        {@const eco = economyByParticipant[p.id] ?? EMPTY_ECONOMY}
        <div class="mb-3">
          <PlanPanel
            participant={p}
            plan={plan ?? null}
            role={data.role}
            participants={liveParticipants}
            actionChoices={actionChoicesFor(p, eco)}
            bonusChoices={bonusChoicesFor(p, eco)}
            {walkSpeed}
            {busy}
            economy={{
              freeActions: econOpen[p.id].freeActions,
              slotLevel: econOpen[p.id].slotLevel,
              movement: eco.movementUsed,
              actionUsed: eco.actionUsed,
              bonusUsed: eco.bonusUsed,
              reactionUsed: eco.reactionUsed
            }}
            showSlotLevel={!isPc && isSpellAction(p.id)}
            on:actionPick={(e) => persistPlan(p, { actionId: e.detail })}
            on:bonusPick={(e) => persistPlan(p, { bonusActionId: e.detail })}
            on:targetPick={(e) => persistPlan(p, { targetParticipantIds: e.detail })}
            on:bonusTargetPick={(e) => persistPlan(p, { bonusTargetParticipantIds: e.detail })}
            on:toggleActionUsed={() => mutateEconomy(p, (c) => ({ ...c, actionUsed: !c.actionUsed }))}
            on:toggleBonusUsed={() => mutateEconomy(p, (c) => ({ ...c, bonusUsed: !c.bonusUsed }))}
            on:toggleReactionUsed={() => mutateEconomy(p, (c) => ({ ...c, reactionUsed: !c.reactionUsed }))}
            on:movementDelta={(e) => mutateEconomy(p, (c) => ({ ...c, movementUsed: Math.max(0, Math.min(walkSpeed, c.movementUsed + e.detail)) }))}
            on:movementReset={() => mutateEconomy(p, (c) => ({ ...c, movementUsed: 0 }))}
            on:slotLevelChange={(e) => { econOpen[p.id].slotLevel = e.detail; econOpen = econOpen; }}
            on:freeActionsChange={(e) => { econOpen[p.id].freeActions = e.detail; econOpen = econOpen; }}
            on:resolve={() => openResolve(p)}
            on:clear={() => clearPlan(p.id)}
          />
        </div>
      {/if}

      <!-- Reveals (DM only, non-PC) -->
      {#if data.role === 'dm' && !isPc && p.reveals}
        <RevealControls
          reveals={p.reveals}
          {busy}
          on:toggle={(e) => patchReveal(p.id, e.detail)}
          on:revealAll={() => revealAll(p.id)}
          on:hideAll={() => hideAll(p.id)}
        />
      {/if}

      <!-- Monster edit (DM only, non-PC) -->
      {#if data.role === 'dm' && !isPc}
        <MonsterEditForm
          participant={p}
          monsterOptions={data.monsterOptions}
          {busy}
          on:save={(e) => saveMonsterEdit(p, e.detail)}
          on:remove={() => removeParticipant(p.id)}
        />
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

{#if conditionExpiryPrompts.length > 0 && data.role === 'dm'}
  {@const expiry = conditionExpiryPrompts[0]}
  <ConditionExpiryPromptCard
    participantName={expiry.participantName}
    condition={expiry.condition}
    overdueBy={Math.max(0, liveRound - expiry.untilRound)}
    remaining={conditionExpiryPrompts.length - 1}
    on:remove={() => answerExpiry(expiry, 'remove')}
    on:extend={(e) => answerExpiry(expiry, 'keep', e.detail)}
    on:keep={() => answerExpiry(expiry, 'keep')}
  />
{/if}

{#if concSavePrompts.length > 0 && data.role === 'dm'}
  {@const check = concSavePrompts[0]}
  <ConcentrationSavePrompt
    participantName={check.participantName}
    dc={check.dc}
    remaining={concSavePrompts.length - 1}
    on:drop={() => dropConcentration(check.participantId)}
    on:dismiss={() => (concSavePrompts = concSavePrompts.slice(1))}
  />
{/if}

{#if data.role === 'dm'}
  <ReactionPromptQueue
    prompts={reactionPrompts}
    on:use={(e) => {
      const actor = liveParticipants.find((q) => q.id === e.detail.participantId);
      if (actor) mutateEconomy(actor, (c) => ({ ...c, reactionUsed: true }));
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

