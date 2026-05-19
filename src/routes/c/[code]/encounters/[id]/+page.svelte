<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import MonsterPicker from '$lib/components/MonsterPicker.svelte';
  import RevealChip from '$lib/components/RevealChip.svelte';
  import HpBucketBadge from '$lib/components/HpBucketBadge.svelte';
  import ActionEconomyPanel from '$lib/components/ActionEconomyPanel.svelte';
  import MonsterStatblockView from '$lib/components/MonsterStatblockView.svelte';
  import { COMMON_CONDITIONS } from '$lib/rules/conditions';
  import { costLabel, slotForCost } from '$lib/rules/action-cost';
  import { hpBucket as computeHpBucket } from '$lib/realtime/reveals';
  import {
    connectEncounter,
    type ConnectedEncounter,
    type EncounterSnapshot,
    type ParticipantHp,
    type TurnPlan
  } from '$lib/realtime/encounter-channel';

  type HitOutcome = '' | 'hit' | 'miss' | 'crit' | 'fumble' | 'heal' | 'saved' | 'failed-save';
  import type { PageData } from './$types';

  export let data: PageData;

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
  $: livePlans = liveState?.plans ?? {};
  $: liveHpMap = liveState?.participantHp ?? {};

  function clearPlan(participantId: string) {
    if (!conn) return;
    conn.clearPlan(participantId).catch(() => {});
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

  /** Pre-fill the resolve form from a statblock action button. DM still
   *  rolls the dice — we just cache the label and surface the "+X / dXd…"
   *  reminder so they don't have to scroll back to the statblock. */
  function pickStatblockAction(a: {
    name: string;
    attackBonus?: number;
    damage?: Array<{ dice: string; type: string }>;
  }) {
    const acting = data.participants.find((q) => q.id === resolveForParticipantId);
    resolveActionLabel = acting ? `${acting.name} — ${a.name}` : a.name;
    // Leave roll inputs blank so DM types what they actually rolled.
    resolveAttack = null;
    resolveDamage = null;
  }

  /** Standard non-attack action options every creature has. Picking one
   *  pre-fills the label; no rolls or HP changes. */
  const COMMON_ACTIONS = ['Dodge', 'Dash', 'Disengage', 'Hide', 'Help', 'Ready', 'Use Object'];
  function pickCommonAction(label: string) {
    const acting = data.participants.find((q) => q.id === resolveForParticipantId);
    resolveActionLabel = acting ? `${acting.name} — ${label}` : label;
    resolveAttack = null;
    resolveDamage = null;
    resolveHit = '';
  }

  /** Single-target apply: HP delta via Y.Doc + one log entry. Returns ok. */
  async function dmApplyToTarget(
    targetId: string | null,
    outcome: HitOutcome,
    damage: number | null,
    attack: number | null,
    round: number
  ): Promise<boolean> {
    if (!conn || !resolveForParticipantId) return false;
    const target = targetId
      ? data.participants.find((p) => p.id === targetId) ?? null
      : null;
    let targetHpBefore: number | null = null;
    let targetHpAfter: number | null = null;
    if (
      target &&
      target.kind !== 'pc' &&
      typeof damage === 'number' &&
      damage > 0 &&
      (outcome === 'hit' ||
        outcome === 'crit' ||
        outcome === 'heal' ||
        outcome === 'saved' ||
        outcome === 'failed-save')
    ) {
      const seed = seedFor(target);
      targetHpBefore = seed.currentHp;
      const effective = outcome === 'saved' ? Math.floor(damage / 2) : damage;
      let next = seed;
      if (effective > 0 || outcome === 'heal') {
        next =
          outcome === 'heal'
            ? conn.applyHeal(target.id, damage, target.maxHp, seed)
            : conn.applyDamage(target.id, effective, seed);
      }
      targetHpAfter = next.currentHp;
    }
    const res = await fetch(`/api/encounters/${data.encounter.id}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participantId: resolveForParticipantId,
        targetParticipantId: targetId,
        actionId: resolveActionId,
        actionLabel: resolveActionLabel,
        round,
        attackRoll: attack,
        damageRoll: damage,
        hit: outcome || null,
        targetHpBefore,
        targetHpAfter,
        notes: resolveNotes.slice(0, 500) || null
      })
    });
    return res.ok;
  }

  async function submitDmResolve() {
    if (!conn || !resolveForParticipantId) return;
    const round = liveState?.round ?? data.encounter.round;
    resolveSubmitting = true;
    try {
      if (resolveMultiTargetIds.length > 0 && resolveSaveDC != null) {
        // Multi-target save: per-target pass/fail from save roll vs DC.
        for (const tid of resolveMultiTargetIds) {
          const t = data.participants.find((p) => p.id === tid);
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
        const ok = await dmApplyToTarget(resolveTargetId, resolveHit, resolveDamage, resolveAttack, round);
        if (!ok) {
          resolveError = 'log entry failed';
          return;
        }
        // Check if single target is concentrating and took real damage.
        if (
          resolveTargetId &&
          (resolveHit === 'hit' || resolveHit === 'crit' || resolveHit === 'failed-save' || resolveHit === 'saved') &&
          typeof resolveDamage === 'number' &&
          resolveDamage > 0
        ) {
          const targetHpEntry = liveHpMap[resolveTargetId];
          if (targetHpEntry?.concentrating) {
            const targetParticipant = data.participants.find((p) => p.id === resolveTargetId);
            const effectiveDamage =
              resolveHit === 'saved' ? Math.floor(resolveDamage / 2) : resolveDamage;
            concSavePrompt = {
              participantName: targetParticipant?.name ?? 'Target',
              dc: Math.max(10, Math.floor(effectiveDamage / 2)),
              participantId: resolveTargetId
            };
          }
        }
      }
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
    const p = data.participants.find((q) => q.id === participantId);
    if (!p || !conn || connStatus !== 'open') return;
    conn.setConcentration(participantId, null).catch(() => {});
    concSavePrompt = null;
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
  // Combat log filters: by participant (incl. ad-hoc DM rows w/ null) and
  // by round. Defaults to "all" so existing behaviour stays intact.
  let logFilterParticipantId: string | 'all' = 'all';
  let logFilterRound: number | 'all' = 'all';
  $: logRounds = Array.from(new Set(data.actionLog.map((e) => e.round))).sort((a, b) => b - a);
  /** Sum XP across all non-PC participants whose monster statblock carries
   *  an xp value. Surfaced in the encounter header as a rough budget gauge. */
  $: encounterTotalXp = data.participants
    .filter((p) => p.kind !== 'pc' && p.statblock?.xp != null)
    .reduce((s, p) => s + (p.statblock?.xp ?? 0), 0);
  $: xpPerChar =
    data.party.size > 0 ? Math.round(encounterTotalXp / data.party.size) : encounterTotalXp;
  $: logOriginals = data.actionLog.filter((e) => {
    if (e.isAmendment) return false;
    if (logFilterParticipantId !== 'all' && e.participantId !== logFilterParticipantId) return false;
    if (logFilterRound !== 'all' && e.round !== logFilterRound) return false;
    return true;
  });
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
          conn.applyHeal(priorTarget.id, delta, priorTarget.maxHp, seed);
        } else if (delta < 0) {
          // Prior entry healed → revert with damage
          conn.applyDamage(priorTarget.id, -delta, seed);
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
      (resolveHit === 'hit' ||
        resolveHit === 'crit' ||
        resolveHit === 'heal' ||
        resolveHit === 'saved' ||
        resolveHit === 'failed-save')
    ) {
      // Re-read seed *after* the revert so we capture the corrected starting HP.
      const live = liveState?.participantHp[target.id];
      const seed: ParticipantHp = live ?? seedFor(target);
      targetHpBefore = seed.currentHp;
      const effective = resolveHit === 'saved' ? Math.floor(resolveDamage / 2) : resolveDamage;
      let next = seed;
      if (effective > 0 || resolveHit === 'heal') {
        next =
          resolveHit === 'heal'
            ? conn.applyHeal(target.id, resolveDamage, target.maxHp, seed)
            : conn.applyDamage(target.id, effective, seed);
      }
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

  // DM reveal toggles. Flips one flag at a time on the server and re-runs
  // the page load so the redacted player projection is consistent.
  async function patchReveal(participantId: string, patch: Record<string, boolean>) {
    busy = true;
    try {
      await fetch(`/api/participants/${participantId}/reveals`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch)
      });
      await invalidateAll();
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
      const res = await fetch(`/api/characters/${characterId}`);
      if (!res.ok) return false;
      const char = await res.json() as { document: Record<string, unknown> | null };
      const doc = { ...(char.document ?? {}), currentHp: nextCurrent, tempHp: nextTemp };
      const patch = await fetch(`/api/characters/${characterId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: doc })
      });
      return patch.ok;
    } catch {
      return false;
    }
  }

  async function dmDamage(p: { id: string; kind: string; characterId: string | null; currentHp: number | null; tempHp: number; conditions: string[] }) {
    const n = Math.max(0, Math.floor(hpInputs[p.id] ?? 0));
    if (n === 0) return;
    const seed = seedFor(p);
    const tempAbsorbed = Math.min(seed.tempHp, n);
    const nextCurrent = seed.currentHp == null ? null : Math.max(0, seed.currentHp - (n - tempAbsorbed));
    const nextTemp = seed.tempHp - tempAbsorbed;
    if (p.kind === 'pc' && p.characterId) {
      const ok = await patchPcHp(p.characterId, nextCurrent ?? 0, nextTemp);
      if (ok) await invalidateAll();
    } else if (conn && connStatus === 'open') {
      conn.applyDamage(p.id, n, seed);
    } else {
      await patchParticipantHp(p.id, nextCurrent ?? 0, nextTemp);
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
    const capped =
      seed.currentHp == null
        ? null
        : p.maxHp != null
          ? Math.min(p.maxHp, seed.currentHp + n)
          : seed.currentHp + n;
    if (p.kind === 'pc' && p.characterId) {
      const ok = await patchPcHp(p.characterId, capped ?? 0, seed.tempHp);
      if (ok) await invalidateAll();
    } else if (conn && connStatus === 'open') {
      conn.applyHeal(p.id, n, p.maxHp, seed);
    } else {
      await patchParticipantHp(p.id, capped ?? 0, seed.tempHp);
      await invalidateAll();
    }
    hpInputs[p.id] = 0;
    hpInputs = hpInputs;
  }

  // Add-participant draft state
  let newKind: 'pc' | 'npc' | 'monster' = 'monster';
  // ---- encounter rename ----
  let renamingEncounter = false;
  let renameValue = data.encounter.name;
  let encounterName = data.encounter.name;

  async function submitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === encounterName) { renamingEncounter = false; return; }
    busy = true;
    try {
      const res = await fetch(`/api/encounters/${data.encounter.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      if (res.ok) encounterName = trimmed;
    } finally {
      busy = false;
      renamingEncounter = false;
    }
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') submitRename();
    else if (e.key === 'Escape') renamingEncounter = false;
  }

  // ---- monster picker ----
  let showMonsterPicker = false;

  let newName = '';
  let newCharacterId = data.campaignCharacters[0]?.id ?? '';
  let newMonsterSlug = data.monsterOptions[0]?.slug ?? '';
  let newInitiative: number | null = null;
  let newMaxHp: number | null = null;
  /** How many copies of the monster/NPC to add. PCs can't be duplicated.
   *  When > 1 the names are auto-suffixed "#1, #2, …" so they're distinguishable. */
  let newQuantity = 1;

  function onMonsterPicked(e: CustomEvent<typeof data.monsterOptions[0]>) {
    const m = e.detail;
    newMonsterSlug = m.slug;
    newName = m.name;
    newMaxHp = m.maxHp ?? null;
    showMonsterPicker = false;
  }

  async function addParticipant() {
    if (newKind === 'pc' && !newCharacterId) return;
    const qty = newKind === 'pc' ? 1 : Math.max(1, Math.min(20, Math.floor(newQuantity || 1)));
    const baseName =
      newKind === 'pc'
        ? (data.campaignCharacters.find((c) => c.id === newCharacterId)?.name ?? newName)
        : newName;
    busy = true;
    try {
      for (let i = 0; i < qty; i++) {
        const body: Record<string, unknown> = {
          name: qty > 1 ? `${baseName} #${i + 1}` : baseName,
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
        if (!res.ok) break;
      }
      newName = '';
      newInitiative = null;
      newMaxHp = null;
      newQuantity = 1;
      await invalidateAll();
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

  /** Auto-roll initiative for every non-PC participant that doesn't already
   *  have one. PCs are left to roll themselves on their character sheet.
   *  Formula: d20 + (dex - 10) >> 1 (Math.floor mod). */
  async function rollInitiativeAll() {
    if (data.role !== 'dm') return;
    busy = true;
    try {
      for (const p of data.participants) {
        if (p.kind === 'pc') continue;
        if (p.initiative != null) continue;
        const dexMod = Math.floor(((p.dexScore ?? 10) - 10) / 2);
        const roll = 1 + Math.floor(Math.random() * 20) + dexMod;
        await fetch(`/api/participants/${p.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ initiative: roll })
        });
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
      await fetch(`/api/participants/${id}`, { method: 'DELETE' });
      await invalidateAll();
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
      await fetch(`/api/encounters/${data.encounter.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status })
      });
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  function checkboxChecked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  function inputValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  const KINDS: Array<'pc' | 'npc' | 'monster'> = ['pc', 'npc', 'monster'];
  /** Live condition list for a participant. PCs source from the SSR-loaded
   *  character document (mirrored in `data.participantPcConditions`); non-PCs
   *  source from the live Y.Doc participantHp blob, falling back to the SSR
   *  conditions array. */
  function condsFor(p: { id: string; kind: string; conditions: string[] }): string[] {
    if (p.kind === 'pc') return data.participantPcConditions?.[p.id] ?? [];
    return liveHpMap[p.id]?.conditions ?? p.conditions;
  }

  /** Toggle a condition on a participant. Non-PCs go through participantHp
   *  (Y.Doc when open, REST fallback). PCs round-trip the character document
   *  via PATCH /api/characters/{id} — the player's open sheet picks up the
   *  change on next Y.Doc reconciliation / page reload. Optimistic UI for
   *  PCs updates the local participantPcConditions map immediately. */
  async function toggleCondition(
    p: { id: string; kind: string; characterId: string | null; currentHp: number | null; tempHp: number; conditions: string[] },
    cond: string
  ) {
    if (p.kind === 'pc') {
      if (!p.characterId) return;
      const current = data.participantPcConditions?.[p.id] ?? [];
      const next = current.includes(cond)
        ? current.filter((c) => c !== cond)
        : [...current, cond];
      // Optimistic update so the chip flips immediately.
      data.participantPcConditions = {
        ...(data.participantPcConditions ?? {}),
        [p.id]: next
      };
      try {
        const res = await fetch(`/api/characters/${p.characterId}`);
        if (!res.ok) throw new Error('fetch failed');
        const char = await res.json() as { document: Record<string, unknown> | null };
        const doc = { ...(char.document ?? {}), conditions: next };
        const patch = await fetch(`/api/characters/${p.characterId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ document: doc })
        });
        if (!patch.ok) throw new Error('patch failed');
      } catch {
        // Revert optimistic update on failure.
        data.participantPcConditions = {
          ...(data.participantPcConditions ?? {}),
          [p.id]: current
        };
      }
      return;
    }
    const seed = seedFor(p);
    const current = liveHpMap[p.id]?.conditions ?? seed.conditions;
    const next = current.includes(cond)
      ? current.filter((c) => c !== cond)
      : [...current, cond];
    if (conn && connStatus === 'open') {
      conn.setConditions(p.id, next).catch(() => {});
    } else {
      await fetch(`/api/participants/${p.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conditions: next })
      });
      await invalidateAll();
    }
  }

  /** Start concentration on a participant with a free-text label. Non-PCs
   *  go through participantHp on the encounter Y.Doc; PCs round-trip the
   *  character document via PATCH /api/characters/{id} so the player's
   *  sheet eventually picks up the change. Optimistic UI on the PC path
   *  flips the local mirror map immediately. */
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
      data.participantPcConcentrating = {
        ...(data.participantPcConcentrating ?? {}),
        [p.id]: next
      };
      try {
        const res = await fetch(`/api/characters/${p.characterId}`);
        if (!res.ok) throw new Error('fetch failed');
        const char = await res.json() as { document: Record<string, unknown> | null };
        const doc = { ...(char.document ?? {}), concentrating: next };
        const patch = await fetch(`/api/characters/${p.characterId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ document: doc })
        });
        if (!patch.ok) throw new Error('patch failed');
      } catch {
        data.participantPcConcentrating = {
          ...(data.participantPcConcentrating ?? {}),
          [p.id]: prev
        };
      }
      return;
    }
    if (conn && connStatus === 'open') {
      conn.setConcentration(p.id, next).catch(() => {});
    }
  }

  /** Clear concentration on a participant. Same PC vs non-PC routing as
   *  startConcentrating. */
  async function clearConcentrating(
    p: { id: string; kind: string; characterId: string | null; currentHp: number | null; tempHp: number; conditions: string[] }
  ) {
    if (p.kind === 'pc') {
      if (!p.characterId) return;
      const prev = data.participantPcConcentrating?.[p.id] ?? null;
      data.participantPcConcentrating = {
        ...(data.participantPcConcentrating ?? {}),
        [p.id]: null
      };
      try {
        const res = await fetch(`/api/characters/${p.characterId}`);
        if (!res.ok) throw new Error('fetch failed');
        const char = await res.json() as { document: Record<string, unknown> | null };
        const doc = { ...(char.document ?? {}), concentrating: null };
        const patch = await fetch(`/api/characters/${p.characterId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ document: doc })
        });
        if (!patch.ok) throw new Error('patch failed');
      } catch {
        data.participantPcConcentrating = {
          ...(data.participantPcConcentrating ?? {}),
          [p.id]: prev
        };
      }
      return;
    }
    if (conn && connStatus === 'open') {
      conn.setConcentration(p.id, null).catch(() => {});
    }
  }

  /** Per-participant draft label for the inline concentration input. */
  let concDrafts: Record<string, string> = {};
  /** Which participant currently has the start-concentration input open. */
  let concentrationOpenFor: string | null = null;

  // Concentration save callout state: set after a resolve completes, cleared when dismissed.
  let concSavePrompt: { participantName: string; dc: number; participantId: string } | null = null;

  let conditionsOpenFor: string | null = null;
  /** Per-participant flag: which one currently has its inline statblock panel
   *  expanded. Only one open at a time keeps the encounter list tidy. */
  let statblockOpenFor: string | null = null;
  /** Per-participant flag for the +reveal disclosure (DM, non-PC only). */
  let revealOpenFor: string | null = null;
  /** Per-participant flag for the +econ disclosure (action economy panel). */
  let economyOpenFor: string | null = null;
  /** Participant whose initiative cell is currently in edit mode. Null when
   *  no one is editing; rolled initiatives display as a number plus a tiny
   *  pencil affordance until clicked. */
  let initiativeEditFor: string | null = null;
  /** Monster participant whose rename / type-swap widget is open. */
  let editMonsterOpenFor: string | null = null;
  let editMonsterNameDraft = '';
  let editMonsterSlugDraft = '';

  function openMonsterEdit(p: { id: string; name: string; statblockSlug: string | null }) {
    editMonsterNameDraft = p.name;
    editMonsterSlugDraft = p.statblockSlug ?? '';
    editMonsterOpenFor = p.id;
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
      const res = await fetch(`/api/participants/${p.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        editMonsterOpenFor = null;
        await invalidateAll();
      }
    } finally {
      busy = false;
    }
  }

  // ---- Action economy foldout (client-side display state only) ----
  function toggleEconomy(id: string) {
    if (economyOpenFor === id) {
      economyOpenFor = null;
    } else {
      ensureEconomy(id);
      economyOpenFor = id;
    }
  }

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

  /** DM picks an action/bonus/targets for a non-PC. Persist as a TurnPlan so
   *  it survives refresh. PCs broadcast their own plans through the character
   *  sheet, so this path is non-PC-only. Changing the action clears its
   *  targets so a leftover pick doesn't bleed into the next action. */
  function persistNonPcPlan(
    p: { id: string; kind: string },
    next: {
      actionId?: string;
      bonusActionId?: string;
      targetParticipantIds?: string[];
      bonusTargetParticipantIds?: string[];
    }
  ) {
    if (!conn || p.kind === 'pc') return;
    const cur = livePlans[p.id];
    const actionId = next.actionId !== undefined ? next.actionId : (cur?.actionId ?? '');
    const bonusActionId =
      next.bonusActionId !== undefined ? next.bonusActionId : (cur?.bonusActionId ?? '');
    if (!actionId && !bonusActionId) {
      conn.clearPlan(p.id).catch(() => {});
      return;
    }
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
        // Non-PC choice ids round-trip as the action's display name.
        actionLabel: actionId,
        bonusActionId: bonusActionId || undefined,
        bonusActionLabel: bonusActionId || undefined,
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
        .map((a) => ({ id: a.id, name: `${a.name} (${costLabel(a.cost)})` }));
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

    if (conn) {
      await conn.setTurn({ round: newRound, activeParticipantId: nextActive });
      return;
    }

    // Fallback when the channel hasn't initialized (SSR-only mode).
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
    {#if renamingEncounter}
      <div class="flex items-center gap-2">
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
            ? `${data.encounter.status} · live sync connected`
            : `${data.encounter.status} · sync: ${connStatus}`}
        ></span>
      {/if}
      {#if data.encounter.status === 'live'}
        &middot; round {liveRound}
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
      {#if data.encounter.status === 'staging'}
        <button
          class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
          disabled={busy || data.participants.length === 0}
          title={data.participants.length === 0
            ? 'Add at least one participant first'
            : 'Flip to live combat'}
          on:click={() => setEncounterStatus('live')}
        >
          ▶ Start encounter
        </button>
      {:else}
        <button
          class="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-40"
          disabled={busy}
          title="Reopen to staging"
          on:click={() => setEncounterStatus('staging')}
        >
          ↺ Reopen
        </button>
      {/if}
    {/if}
    <a class="text-xs text-slate-400 hover:text-slate-200" href={`/c/${data.campaign.code}/encounters`}>
      ← all encounters
    </a>
  </div>
</header>

{#if data.encounter.status === 'live' && data.role === 'dm'}
  <section class="mb-6 flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
    <span class="text-emerald-200">Turn controls:</span>
    <button class="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800" on:click={() => advanceTurn(-1)} disabled={busy} title="Previous turn">
      ←
    </button>
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
  </section>
{/if}

<section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
  <div class="mb-3 flex items-baseline justify-between">
    <h2 class="text-sm font-semibold text-slate-200">Participants ({data.participants.length})</h2>
    {#if data.role === 'dm' && data.participants.some((p) => p.kind !== 'pc' && p.initiative == null)}
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

  {#if data.participants.length === 0}
    <p class="mb-3 text-sm text-slate-400">No participants yet.</p>
  {:else}
    <ul class="mb-3 divide-y divide-slate-800">
      {#each data.participants as p (p.id)}
        {@const isActive = p.id === liveActive}
        {@const plan = livePlans[p.id]}
        {@const concRaw = liveHpMap[p.id]?.concentrating}
        {@const concPcDoc = data.participantPcConcentrating?.[p.id]}
        {@const concLbl = p.kind === 'pc'
          ? (concPcDoc?.label ?? null)
          : (concRaw
              ? (typeof concRaw === 'object' ? (concRaw.label ?? '') : '')
              : null)}
        <li class="flex flex-wrap items-center gap-3 py-2 text-sm {isActive ? 'rounded bg-emerald-950/30 px-2' : ''}">
          {#if data.role === 'dm'}
            {#if initiativeEditFor === p.id || p.initiative == null}
              <input
                type="number"
                class="w-12 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-xs"
                placeholder="init"
                value={p.initiative ?? ''}
                autofocus={initiativeEditFor === p.id}
                on:blur={(e) => {
                  const v = inputValue(e);
                  updateInitiative(p.id, v === '' ? null : Number(v));
                  if (initiativeEditFor === p.id) initiativeEditFor = null;
                }}
                on:keydown={(e) => {
                  if (e.key === 'Enter') {
                    const v = inputValue(e);
                    updateInitiative(p.id, v === '' ? null : Number(v));
                    initiativeEditFor = null;
                  } else if (e.key === 'Escape') {
                    initiativeEditFor = null;
                  }
                }}
              />
            {:else}
              <span class="inline-flex items-center gap-0.5 w-12 font-mono text-xs text-slate-400">
                <span>{p.initiative}</span>
                <button
                  class="text-[10px] text-slate-600 hover:text-slate-300"
                  title="Edit initiative"
                  on:click={() => (initiativeEditFor = p.id)}
                >✎</button>
              </span>
            {/if}
          {:else}
            <span class="font-mono text-xs text-slate-500 w-8">
              {#if p.initiative != null}
                {p.initiative}
              {:else}
                —
              {/if}
            </span>
          {/if}
          {#if p.kind === 'npc'}
            <span class="rounded border border-slate-700 px-1.5 py-0.5 text-xs uppercase tracking-wide text-slate-400 w-16 text-center">
              {p.kind}
            </span>
          {/if}
          <span class="flex-1 font-medium">
            {#if p.characterId}
              <a class="hover:text-emerald-300" href={`/c/${data.campaign.code}/character/${p.characterId}`}>
                {p.placeholderName ?? p.name}
              </a>
            {:else}
              {p.placeholderName ?? p.name}
            {/if}
            {#if data.role === 'dm' && p.kind !== 'pc'}
              <button
                class="ml-1 text-[10px] text-slate-600 hover:text-slate-300"
                title="Rename / change type"
                on:click={() => openMonsterEdit(p)}
              >✎</button>
            {/if}
          </span>
          {#if data.role === 'dm' || p.reveals?.vitals || p.kind === 'pc'}
            {#if p.maxHp != null}
              {@const liveCur = liveHpMap[p.id]?.currentHp ?? p.currentHp}
              {@const liveTemp = liveHpMap[p.id]?.tempHp ?? p.tempHp ?? 0}
              <span class="font-mono text-xs text-slate-400">
                {liveCur ?? '—'} / {p.maxHp}
                {#if liveTemp > 0}
                  <span class="text-emerald-300">+{liveTemp}</span>
                {/if}
              </span>
            {/if}
          {:else}
            <!-- Player view + vitals hidden: show coarse bucket only. Bucket is
                 computed live from Y.Doc HP when present, else SSR snapshot. -->
            {@const live = liveHpMap[p.id]}
            <HpBucketBadge value={computeHpBucket(live?.currentHp ?? null, p.maxHp ?? null) === 'unknown' ? (p.hpBucket ?? 'unknown') : computeHpBucket(live?.currentHp ?? null, p.maxHp ?? null)} />
          {/if}
          {#if data.role === 'dm'}
            {#if p.maxHp != null}
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
          {/if}
          {#if data.role === 'dm'}
            <button
              class="text-[10px] {p.kind === 'pc' || !p.reveals
                ? 'text-slate-700 cursor-not-allowed'
                : 'text-slate-500 hover:text-slate-300'}"
              title={p.kind === 'pc' ? 'Reveals are PC-only — party always sees PCs' : 'Show / hide reveal toggles'}
              disabled={p.kind === 'pc' || !p.reveals}
              on:click={() => (revealOpenFor = revealOpenFor === p.id ? null : p.id)}
            >
              {revealOpenFor === p.id ? '− reveal' : '+ reveal'}
            </button>
          {/if}
          {#if data.role === 'dm'}
            <button
              class="text-[10px] text-slate-500 hover:text-slate-300"
              title="Show / hide condition picker"
              on:click={() => (conditionsOpenFor = conditionsOpenFor === p.id ? null : p.id)}
            >
              {conditionsOpenFor === p.id ? '− cond' : '+ cond'}
            </button>
          {/if}
          {#if data.role === 'dm'}
            {#if concLbl !== null}
              <span
                class="rounded border border-violet-600 bg-violet-900/40 px-1.5 py-0.5 text-[10px] text-violet-200"
                title="Click × to clear concentration"
              >
                🌀 {concLbl || 'concentrating'}
                <button
                  class="ml-1 text-violet-300 hover:text-violet-100"
                  on:click={() => { clearConcentrating(p); concentrationOpenFor = null; }}
                >×</button>
              </span>
            {:else}
              <button
                class="text-[10px] text-slate-500 hover:text-slate-300"
                title="Mark as concentrating"
                on:click={() => (concentrationOpenFor = concentrationOpenFor === p.id ? null : p.id)}
              >
                {concentrationOpenFor === p.id ? '− conc' : '+ conc'}
              </button>
            {/if}
          {/if}
          {#if (p.statblock && (data.role === 'dm' || p.reveals?.combat)) || (p.kind === 'pc' && !!data.participantPcStats?.[p.id])}
            <button
              class="text-[10px] text-slate-500 hover:text-slate-300"
              title="Show / hide statblock"
              on:click={() => (statblockOpenFor = statblockOpenFor === p.id ? null : p.id)}
            >
              {statblockOpenFor === p.id ? '− stats' : '+ stats'}
            </button>
          {/if}
          <button
            class="text-[10px] text-slate-500 hover:text-slate-300"
            title="Show / hide plan"
            on:click={() => toggleEconomy(p.id)}
          >
            {economyOpenFor === p.id ? '− plan' : '+ plan'}
          </button>
          {#if data.role === 'dm'}
            <button
              class="ml-auto rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-400 hover:border-red-700 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
              title={p.kind === 'pc' ? 'Remove this PC from the encounter' : `Remove ${p.kind} from encounter`}
              on:click={() => removeParticipant(p.id)}
              disabled={busy}
            >
              ✕
            </button>
          {/if}
          {#if condsFor(p).length > 0 || conditionsOpenFor === p.id}
            <div class="basis-full pl-12 flex flex-wrap items-center gap-1 pt-1 text-[10px]">
              {#each condsFor(p) as c}
                <button
                  class="rounded border border-amber-700 bg-amber-950/30 px-1.5 py-0.5 text-amber-200 hover:bg-amber-900/40 disabled:opacity-40"
                  disabled={busy || data.role !== 'dm'}
                  title="Remove condition"
                  on:click={() => toggleCondition(p, c)}
                >
                  {c} ×
                </button>
              {/each}
              {#if data.role === 'dm' && conditionsOpenFor === p.id}
                {#each COMMON_CONDITIONS.filter((c) => !condsFor(p).includes(c)) as c}
                  <button
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:bg-slate-800"
                    disabled={busy}
                    on:click={() => toggleCondition(p, c)}
                  >
                    + {c}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
          {#if data.role === 'dm' && concentrationOpenFor === p.id && concLbl === null}
            <div class="basis-full pl-12 flex flex-wrap items-center gap-1 pt-1 text-[10px]">
              <span class="text-slate-500 mr-1">🌀 concentrate on</span>
              <input
                class="w-44 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px]"
                placeholder="bless, hex, hold person…"
                maxlength="80"
                bind:value={concDrafts[p.id]}
                on:keydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const label = (concDrafts[p.id] ?? '').trim();
                    if (label) {
                      startConcentrating(p, label);
                      concDrafts[p.id] = '';
                      concentrationOpenFor = null;
                    }
                  }
                }}
              />
              <button
                class="rounded border border-slate-600 px-1.5 py-0.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                disabled={busy || !(concDrafts[p.id] ?? '').trim()}
                on:click={() => {
                  const label = (concDrafts[p.id] ?? '').trim();
                  if (!label) return;
                  startConcentrating(p, label);
                  concDrafts[p.id] = '';
                  concentrationOpenFor = null;
                }}
              >start</button>
            </div>
          {/if}
          {#if p.kind !== 'pc' && data.role === 'dm' && p.reveals && revealOpenFor === p.id}
            <div class="basis-full pl-12 flex flex-wrap items-center gap-1 pt-1 text-[10px]">
              <span class="text-slate-500 mr-1">reveal:</span>
              <RevealChip label="identity" on={p.reveals.identity} on:toggle={(e) => patchReveal(p.id, { identity: e.detail })} disabled={busy} />
              <RevealChip label="vitals" on={p.reveals.vitals} on:toggle={(e) => patchReveal(p.id, { vitals: e.detail })} disabled={busy} />
              <RevealChip label="combat" on={p.reveals.combat} on:toggle={(e) => patchReveal(p.id, { combat: e.detail })} disabled={busy} />
              <RevealChip label="hidden" tone="danger" on={p.reveals.hidden} on:toggle={(e) => patchReveal(p.id, { hidden: e.detail })} disabled={busy} />
              <button class="ml-1 text-slate-500 hover:text-emerald-300 underline-offset-2 hover:underline" on:click={() => revealAll(p.id)} disabled={busy}>reveal all</button>
              <button class="text-slate-500 hover:text-slate-300 underline-offset-2 hover:underline" on:click={() => hideAll(p.id)} disabled={busy}>hide all</button>
            </div>
          {/if}
          {#if data.role === 'dm' && p.kind !== 'pc' && editMonsterOpenFor === p.id}
            <div class="basis-full ml-12 mt-1 flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-slate-950/60 p-2 text-xs">
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
                    <option value={m.slug}>{m.name} <span>(CR {m.cr})</span></option>
                  {/each}
                </select>
              </label>
              <button
                class="rounded bg-emerald-700/70 px-2 py-0.5 text-[11px] hover:bg-emerald-700 disabled:opacity-40"
                disabled={busy || !editMonsterNameDraft.trim()}
                on:click={() => saveMonsterEdit(p)}
              >save</button>
              <button
                class="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800"
                on:click={() => (editMonsterOpenFor = null)}
              >cancel</button>
              <button
                class="ml-auto rounded border border-red-800 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-900/60 disabled:opacity-40"
                disabled={busy}
                on:click={async () => {
                  await removeParticipant(p.id);
                  if (editMonsterOpenFor === p.id) editMonsterOpenFor = null;
                }}
              >Remove from encounter</button>
            </div>
          {/if}
          {#if p.statblock && statblockOpenFor === p.id}
            <div class="basis-full ml-12 mt-1">
              <MonsterStatblockView statblock={p.statblock} dense />
            </div>
          {/if}
          {#if p.kind === 'pc' && statblockOpenFor === p.id && data.participantPcStats?.[p.id]}
            {@const cs = data.participantPcStats[p.id]}
            <div class="basis-full ml-12 mt-1 rounded border border-slate-800 bg-slate-950/60 p-2 text-xs">
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span><span class="text-slate-500">AC</span> {cs.ac}</span>
                <span><span class="text-slate-500">HP</span> {cs.hp.current}/{cs.hp.max}{#if cs.hp.temp > 0}<span class="text-emerald-300"> +{cs.hp.temp}</span>{/if}</span>
                <span><span class="text-slate-500">prof</span> +{cs.proficiencyBonus}</span>
                <span><span class="text-slate-500">lvl</span> {cs.totalLevel}</span>
                <span><span class="text-slate-500">pp</span> {cs.passivePerception}</span>
                {#each Object.entries(cs.speeds) as [mode, ft]}
                  <span><span class="text-slate-500">{mode}</span> {ft}ft</span>
                {/each}
              </div>
              <div class="mt-2 grid grid-cols-6 gap-1 text-center font-mono">
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
              <div class="mt-2 grid grid-cols-2 gap-x-3">
                <div>
                  <div class="text-[10px] uppercase tracking-wide text-slate-500">Saves</div>
                  <ul class="text-slate-400">
                    {#each ['str','dex','con','int','wis','cha'] as ab}
                      {@const s = cs.saves[ab]}
                      {#if s}
                        <li>
                          <span class={s.proficient ? 'text-emerald-300' : 'text-slate-400'}>{s.proficient ? '●' : '○'} {ab.toUpperCase()}</span>
                          <span class="ml-1 font-mono text-slate-300">{s.bonus >= 0 ? '+' : ''}{s.bonus}</span>
                        </li>
                      {/if}
                    {/each}
                  </ul>
                </div>
                <div>
                  <div class="text-[10px] uppercase tracking-wide text-slate-500">Proficient skills</div>
                  <ul class="text-slate-400">
                    {#each Object.entries(cs.skills).filter(([, sk]) => sk.proficient).sort(([a],[b]) => a.localeCompare(b)) as [name, sk]}
                      <li>
                        <span class={sk.expertise ? 'text-emerald-300' : 'text-slate-300'}>{sk.expertise ? '◆' : '●'} {name.replace(/-/g, ' ')}</span>
                        <span class="ml-1 font-mono text-slate-300">{sk.bonus >= 0 ? '+' : ''}{sk.bonus}</span>
                      </li>
                    {/each}
                    {#if !Object.values(cs.skills).some((sk) => sk.proficient)}
                      <li class="text-slate-600">—</li>
                    {/if}
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
              {#if cs.resistances.length > 0 || cs.immunities.length > 0 || cs.vulnerabilities.length > 0}
                <div class="mt-1 text-[11px]">
                  {#if cs.resistances.length > 0}
                    <div><span class="text-slate-500">Resist:</span> <span class="text-slate-300">{cs.resistances.join(', ')}</span></div>
                  {/if}
                  {#if cs.immunities.length > 0}
                    <div><span class="text-slate-500">Immune:</span> <span class="text-slate-300">{cs.immunities.join(', ')}</span></div>
                  {/if}
                  {#if cs.vulnerabilities.length > 0}
                    <div><span class="text-slate-500">Vulnerable:</span> <span class="text-slate-300">{cs.vulnerabilities.join(', ')}</span></div>
                  {/if}
                </div>
              {/if}
              {#if Object.keys(cs.senses).length > 0}
                <div class="mt-1 text-[11px]">
                  <span class="text-slate-500">Senses:</span>
                  {#each Object.entries(cs.senses) as [sense, ft]}
                    <span class="ml-1 text-slate-300">{sense} {ft}ft</span>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          {#if economyOpenFor === p.id && roundEconomy[p.id]}
            {@const isPc = p.kind === 'pc'}
            {@const speeds = isPc
              ? (data.participantPcStats?.[p.id]?.speeds ?? { walk: 30 })
              : (p.statblock?.speeds ?? { walk: 30 })}
            {@const walkSpeed = (speeds.walk ?? speeds.fly ?? speeds.swim ?? 30)}
            <div class="basis-full bg-slate-900/60 border-t border-slate-800 px-4 py-3 mt-1 rounded-b">
              <div class="mb-2 flex items-center gap-2">
                <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Plan</div>
                {#if data.role === 'dm' && plan && (plan.actionLabel || plan.bonusActionLabel)}
                  <button
                    class="rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-900/40"
                    on:click={() => openResolve(p)}
                  >
                    resolve
                  </button>
                  <button
                    class="text-[10px] text-slate-500 hover:text-red-400"
                    on:click={() => clearPlan(p.id)}
                  >
                    clear
                  </button>
                {/if}
              </div>
              <ActionEconomyPanel
                mode="observer"
                readonly={isPc}
                {busy}
                actionChoices={actionChoicesFor(p)}
                bonusChoices={bonusChoicesFor(p)}
                plannedActionId={plan?.actionId ?? ''}
                plannedBonusActionId={plan?.bonusActionId ?? ''}
                actionUsed={roundEconomy[p.id].actionUsed}
                bonusUsed={roundEconomy[p.id].bonusUsed}
                reactionUsed={roundEconomy[p.id].reactionUsed}
                {walkSpeed}
                movementUsed={roundEconomy[p.id].movement}
                showConcentration={false}
                participants={data.participants}
                selfId={p.id}
                plannedTargetIds={plan?.targetParticipantIds ?? []}
                plannedBonusTargetIds={plan?.bonusTargetParticipantIds ?? []}
                on:actionPick={(e) => persistNonPcPlan(p, { actionId: e.detail })}
                on:bonusPick={(e) => persistNonPcPlan(p, { bonusActionId: e.detail })}
                on:targetPick={(e) => persistNonPcPlan(p, { targetParticipantIds: e.detail })}
                on:bonusTargetPick={(e) => persistNonPcPlan(p, { bonusTargetParticipantIds: e.detail })}
                on:toggleActionUsed={() => { roundEconomy[p.id].actionUsed = !roundEconomy[p.id].actionUsed; roundEconomy = roundEconomy; }}
                on:toggleBonusUsed={() => { roundEconomy[p.id].bonusUsed = !roundEconomy[p.id].bonusUsed; roundEconomy = roundEconomy; }}
                on:toggleReactionUsed={() => { roundEconomy[p.id].reactionUsed = !roundEconomy[p.id].reactionUsed; roundEconomy = roundEconomy; }}
                on:movementDelta={(e) => { roundEconomy[p.id].movement = Math.max(0, Math.min(walkSpeed, roundEconomy[p.id].movement + e.detail)); roundEconomy = roundEconomy; }}
                on:movementReset={() => { roundEconomy[p.id].movement = 0; roundEconomy = roundEconomy; }}
              />
              {#if !isPc && isSpellAction(p.id)}
                <div class="mt-2 flex items-center gap-1.5 text-xs">
                  <span class="text-[10px] text-slate-500">Cast at slot:</span>
                  <select
                    class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[10px]"
                    bind:value={roundEconomy[p.id].slotLevel}
                    on:change={() => (roundEconomy = roundEconomy)}
                  >
                    {#each [1,2,3,4,5,6,7,8,9] as lvl}
                      <option value={lvl}>L{lvl}</option>
                    {/each}
                  </select>
                </div>
              {/if}
              <div class="mt-2 flex items-center gap-2 text-xs">
                <span class="text-slate-500 whitespace-nowrap">Free Actions:</span>
                <input
                  class="flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] placeholder-slate-600"
                  placeholder="object interaction, communicate, etc."
                  bind:value={roundEconomy[p.id].freeActions}
                  on:input={() => (roundEconomy = roundEconomy)}
                />
              </div>
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
          <div class="text-xs">
            <span class="block text-slate-400 mb-1">From pack</span>
            {#if data.monsterOptions.length === 0}
              <p class="text-amber-300">No monsters loaded.</p>
            {:else}
              <button
                class="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100"
                on:click={() => (showMonsterPicker = true)}
              >
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                {newMonsterSlug ? newName : 'Search monsters…'}
              </button>
            {/if}
          </div>
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
        {#if newKind !== 'pc'}
          <label class="text-xs">
            <span class="block text-slate-400">Qty</span>
            <input
              type="number"
              min="1"
              max="20"
              class="w-14 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
              bind:value={newQuantity}
              title="Adding N copies suffixes the names #1, #2, …"
            />
          </label>
        {/if}
        <button
          class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
          on:click={addParticipant}
          disabled={busy || (newKind !== 'pc' && !newName) || (newKind === 'pc' && !newCharacterId)}
        >
          {newKind !== 'pc' && newQuantity > 1 ? `Add ${newQuantity}` : 'Add'}
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

    {#if acting && acting.statblockActions && acting.statblockActions.length > 0 && !amendingLogId}
      <div class="mb-3 flex flex-wrap gap-1 text-xs">
        <span class="self-center text-slate-500 mr-1">Statblock:</span>
        {#each acting.statblockActions as a}
          {@const dmg = (a.damage ?? []).map((d) => `${d.dice} ${d.type}`).join(', ')}
          <button
            class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-slate-300 hover:border-emerald-600 hover:text-emerald-200"
            title="Pre-fill the form. You still roll the dice."
            on:click={() => pickStatblockAction(a)}
          >
            {a.name}
            {#if a.attackBonus != null}<span class="text-slate-500"> +{a.attackBonus}</span>{/if}
            {#if dmg}<span class="text-red-300/80"> · {dmg}</span>{/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if !amendingLogId}
      <div class="mb-3 flex flex-wrap gap-1 text-xs">
        <span class="self-center text-slate-500 mr-1">Common:</span>
        {#each COMMON_ACTIONS as label}
          <button
            class="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-slate-400 hover:border-slate-500 hover:text-slate-200"
            on:click={() => pickCommonAction(label)}
          >
            {label}
          </button>
        {/each}
      </div>
    {/if}

    {#if !amendingLogId}
      <div class="mb-3 rounded border border-indigo-900/50 bg-slate-950/40 p-2">
        <div class="mb-1 flex items-center gap-2 text-xs">
          <span class="text-slate-500">Multi-save (AOE):</span>
          <label class="flex items-center gap-1">
            <span class="text-slate-500">DC</span>
            <input
              type="number"
              class="w-14 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono"
              placeholder="—"
              bind:value={resolveSaveDC}
            />
          </label>
          <span class="text-slate-600">
            {#if resolveMultiTargetIds.length > 0 && resolveSaveDC != null}
              · {resolveMultiTargetIds.length} target(s) — per-target save vs DC fires N log rows
            {:else}
              · enter DC + check targets to fire one row per target; leave blank for single-target
            {/if}
          </span>
        </div>
        {#if resolveSaveDC != null}
          <ul class="grid grid-cols-2 gap-1 text-xs">
            {#each data.participants as q (q.id)}
              {#if q.id !== resolveForParticipantId}
                {@const checked = resolveMultiTargetIds.includes(q.id)}
                {@const roll = resolveTargetSaveRolls[q.id]}
                {@const outcome =
                  typeof roll === 'number' && resolveSaveDC != null
                    ? roll >= resolveSaveDC
                      ? 'saved'
                      : 'failed-save'
                    : null}
                <li class="flex items-center gap-1 rounded border border-slate-800 px-1 py-0.5">
                  <input
                    type="checkbox"
                    {checked}
                    on:change={(e) => {
                      if (checkboxChecked(e)) {
                        if (!resolveMultiTargetIds.includes(q.id))
                          resolveMultiTargetIds = [...resolveMultiTargetIds, q.id];
                      } else {
                        resolveMultiTargetIds = resolveMultiTargetIds.filter((id) => id !== q.id);
                      }
                    }}
                  />
                  <span class="flex-1 truncate text-slate-300">{q.name}</span>
                  <input
                    type="number"
                    class="w-12 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-center font-mono text-[10px]"
                    placeholder="save"
                    disabled={!checked}
                    bind:value={resolveTargetSaveRolls[q.id]}
                  />
                  {#if outcome}
                    <span
                      class="rounded px-1 text-[9px] uppercase {outcome === 'saved'
                        ? 'bg-emerald-900/40 text-emerald-200'
                        : 'bg-red-900/40 text-red-200'}"
                    >
                      {outcome === 'saved' ? '½' : 'X'}
                    </span>
                  {/if}
                </li>
              {/if}
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

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
          <option value="saved">saved (half dmg)</option>
          <option value="failed-save">failed save</option>
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

{#if concSavePrompt && data.role === 'dm'}
  <div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-600 bg-amber-950/40 px-4 py-3 text-sm">
    <span class="text-amber-200">
      ⚠ <strong>{concSavePrompt.participantName}</strong> is concentrating — CON save DC {concSavePrompt.dc}
    </span>
    <button
      class="rounded border border-red-700 bg-red-900/40 px-2 py-0.5 text-xs text-red-200 hover:bg-red-900/70"
      on:click={() => dropConcentration(concSavePrompt?.participantId ?? '')}
    >
      Fail save (drop)
    </button>
    <button
      class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
      on:click={() => (concSavePrompt = null)}
    >
      Pass / dismiss
    </button>
  </div>
{/if}

{#if data.actionLog.length > 0}
  <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-sm font-semibold text-slate-200">
        Action log ({logOriginals.length}{#if logOriginals.length !== data.actionLog.length} of {data.actionLog.length}{/if})
      </h2>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <label class="flex items-center gap-1">
          <span class="text-slate-500">Who:</span>
          <select
            class="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5"
            bind:value={logFilterParticipantId}
          >
            <option value="all">all</option>
            {#each data.participants as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        </label>
        <label class="flex items-center gap-1">
          <span class="text-slate-500">Round:</span>
          <select
            class="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5"
            bind:value={logFilterRound}
          >
            <option value="all">all</option>
            {#each logRounds as r}
              <option value={r}>R{r}</option>
            {/each}
          </select>
        </label>
        {#if logFilterParticipantId !== 'all' || logFilterRound !== 'all'}
          <button
            class="text-slate-500 hover:text-slate-200"
            on:click={() => {
              logFilterParticipantId = 'all';
              logFilterRound = 'all';
            }}
          >
            clear
          </button>
        {/if}
      </div>
    </div>
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

{#if showMonsterPicker}
  <MonsterPicker
    monsters={data.monsterOptions}
    disabled={busy}
    on:pick={onMonsterPicked}
    on:close={() => (showMonsterPicker = false)}
  />
{/if}
