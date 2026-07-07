<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import HoverPopup from '$lib/components/HoverPopup.svelte';
  import FeatureChoicesPanel from '$lib/components/FeatureChoicesPanel.svelte';
  import InventoryPicker from '$lib/components/InventoryPicker.svelte';
  import HpBucketBadge from '$lib/components/HpBucketBadge.svelte';
  import SpellManagerModal from '$lib/components/SpellManagerModal.svelte';
  import ActionEconomyPanel from '$lib/components/ActionEconomyPanel.svelte';
  import ActivationsPanel from '$lib/components/ActivationsPanel.svelte';
  import ReceivedBuffsPanel from '$lib/components/ReceivedBuffsPanel.svelte';
  import {
    derive,
    refreshActivations,
    pickRestVariant,
    applyAutoCancelOnStateChange,
    toggleActivation
  } from '$lib/rules';
  import { SKILLS } from '$lib/rules/skills';
  import { costLabel, slotForCost } from '$lib/rules/action-cost';
  import { COMMON_CONDITIONS, impliedBy } from '$lib/rules/conditions';
  import { applyDamageDelta, applyHealDelta } from '$lib/rules/hp';
  import { lookupFromMap, type CharacterDocument, type Derived, type ContentLookup } from '$lib/rules/types';
  import { connectCharacter, type ConnectedDoc } from '$lib/realtime/character-channel';
  import {
    connectEncounter,
    type ConnectedEncounter,
    type EncounterSnapshot,
    type TurnPlan,
    type ParticipantHp
  } from '$lib/realtime/encounter-channel';
  import type { PageData } from './$types';

  export let data: PageData;

  let busy = false;
  let damageInput = 0;

  // Quick-init state: shown when data.document is null (stub character).
  let initBusy = false;
  let initError: string | null = null;

  async function quickInit() {
    initBusy = true;
    initError = null;
    try {
      const minDoc = {
        id: data.character.id,
        name: data.character.name,
        classes: [{ slug: 'fighter', level: 1, hpRolledPerLevel: [10] }],
        species: { kind: 'species' as const, slug: 'human', version: 1 },
        feats: [],
        abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        proficienciesChosen: {},
        inventory: [],
        spells: { known: [], prepared: [] },
        currentHp: 10,
        tempHp: 0 as const,
        hitDiceSpent: {},
        conditions: [],
        modifierToggles: {}
      };
      const res = await fetch(`/api/characters/${data.character.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: minDoc })
      });
      if (!res.ok) {
        initError = `error: ${res.status} ${(await res.text()).slice(0, 200)}`;
        return;
      }
      await invalidateAll();
    } catch (e) {
      initError = String(e);
    } finally {
      initBusy = false;
    }
  }

  // Per-character edit panel (rename + ability scores). Both go through the
  // same PATCH /api/characters/:id — name as a top-level field, abilities
  // via a full document write that preserves everything else.
  let editingMeta = false;
  let editName = '';
  let editAbilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number } = {
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10
  };
  let editError: string | null = null;
  let healInput = 0;
  let tempHpDraft = data.document?.tempHp ?? 0;
  let restNote: string | null = null;
  /** When true, the hit-dice list is visible inline beneath the Rest row.
   *  Toggled by the Short Rest button; auto-collapses on Long Rest. */
  let restingShort = false;

  // Svelte 4 inline expressions are plain JS — TS `as` casts must live in
  // script-block helpers, not in event handlers.
  function checkboxChecked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  // Surface condition note + modifiers in the hover popup. SRD conditions
  // ship `note` (short prose) and `modifiers` (mechanical effects); some
  // homebrew packs may also ship `description`.
  function conditionMeta(row: { data?: unknown } | undefined): {
    description?: string;
    note?: string;
    modifiers?: Array<{ target: string; mode: string; value: unknown }>;
  } {
    const data = (row?.data ?? {}) as Record<string, unknown>;
    return {
      description: typeof data.description === 'string' ? data.description : undefined,
      note: typeof data.note === 'string' ? data.note : undefined,
      modifiers: Array.isArray(data.modifiers)
        ? (data.modifiers as Array<{ target: string; mode: string; value: unknown }>)
        : undefined
    };
  }

  // ---- realtime sync (M2.3) ----
  // SSE state from the server replaces the SSR snapshot once the stream
  // is open. Client runs derive() locally on every update so the
  // displayed stats reflect live HP/conditions/toggles within one tick.
  let conn: ConnectedDoc | null = null;
  let syncStatus: 'connecting' | 'open' | 'closed' = 'connecting';
  let unsubStatus: (() => void) | undefined;
  let unsubDoc: (() => void) | undefined;
  /** Snapshot from the live SSE stream — null until first message arrives. */
  let liveDoc: CharacterDocument | null = null;

  // Build a ContentLookup over the shipped contentMap. The map is keyed by
  // (kind, slug, authorUserId) so two authors' same-slug homebrew can both
  // resolve when a character references each via authorUserId on the ref.
  // `lookupFromMap` handles the null-author fallback for SRD-style refs.
  $: contentLookup = lookupFromMap(data.contentMap) as ContentLookup;

  // The effective document: live SSE snapshot when available, else the SSR document.
  $: document = (liveDoc ?? data.document) as CharacterDocument | null;

  // Re-derive when document changes. Initial render uses the server's
  // derived output (data.derived) so first paint isn't blank.
  $: derived = document
    ? serializeDerivedClient(derive(document, contentLookup))
    : data.derived;

  // Map of condition slug → the slug that directly implies it, for conditions
  // that are active only because another condition implies them.
  $: impliedConditions = document ? impliedBy(document.conditions) : new Map<string, string>();

  // Sets aren't JSON-serializable; the server's serializeDerived swaps them
  // for arrays before shipping. Client-side derive() returns Sets, so we
  // do the same swap here for shape parity with the Sheet component.
  function serializeDerivedClient(d: Derived) {
    return {
      ...d,
      stats: {
        ...d.stats,
        resistances: [...d.stats.resistances],
        immunities: [...d.stats.immunities],
        vulnerabilities: [...d.stats.vulnerabilities]
      }
    };
  }

  // When this character is a participant in a live encounter, we connect to
  // the encounter SSE channel so the player can broadcast a turn plan (action +
  // target + notes) that the DM sees live on the encounter page.
  let encConn: ConnectedEncounter | null = null;
  let encState: EncounterSnapshot | null = null;
  let unsubEncState: (() => void) | undefined;
  let planActionId = '';
  let planBonusActionId = '';
  let planTargetIds: string[] = [];
  let planBonusTargetIds: string[] = [];
  let planNotes = '';
  let planSubmitting = false;

  // The player can resolve their own plan: optionally declare what they
  // rolled (attack total, damage total, hit/miss), apply HP to a non-PC
  // target via the participant HP API, and append to the encounter's action_log.
  // PC targets aren't auto-damaged here — the target's own sheet is the
  // source of truth for PC HP.
  let resolveOpen = false;
  let resolveAttack: number | null = null;
  let resolveDamage: number | null = null;
  let resolveHit: '' | 'hit' | 'miss' | 'crit' | 'fumble' | 'heal' | 'saved' | 'failed-save' = '';
  /** Per-target save rolls for the multi-target save resolve mode. Keyed by
   *  participant id. Target list is sourced from `planTargetIds`. */
  let targetSaveRolls: Record<string, number | null> = {};
  let resolveNotes = '';
  let resolveSubmitting = false;
  let resolveError: string | null = null;

  onMount(() => {
    conn = connectCharacter({ characterId: data.character.id, seed: data.document });
    unsubStatus = conn.status.subscribe((s) => (syncStatus = s));
    unsubDoc = conn.document.subscribe((d) => (liveDoc = d));

    if (data.liveEncounter) {
      // Seed the channel with the SSR-loaded plan so the chooser pre-selects
      // the broadcast action on first paint — fixes the refresh-after-pick
      // case where the local store would otherwise wait on SSE for the
      // plan to arrive.
      const seedPlans: Record<string, TurnPlan> = {};
      const ssrPlan = data.liveEncounter.selfPlan;
      if (ssrPlan) seedPlans[data.liveEncounter.selfParticipantId] = ssrPlan;
      encConn = connectEncounter({
        encounterId: data.liveEncounter.id,
        seed: { plans: seedPlans }
      });
      // Pre-fill the draft from the SSR plan immediately so refresh keeps
      // the prior selection without waiting for an SSE round-trip.
      if (ssrPlan && !planActionId && !planBonusActionId) {
        planActionId = ssrPlan.actionId;
        planBonusActionId = ssrPlan.bonusActionId ?? '';
        planTargetIds = ssrPlan.targetParticipantIds ?? [];
        planBonusTargetIds = ssrPlan.bonusTargetParticipantIds ?? [];
        planNotes = ssrPlan.notes;
      }
      unsubEncState = encConn.state.subscribe((s) => {
        encState = s;
        // Plans may also arrive later (another tab broadcasted) — adopt them
        // when the local draft is still empty so we mirror the latest state.
        if (s && data.liveEncounter) {
          const existing = s.plans[data.liveEncounter.selfParticipantId];
          if (existing && !planActionId && !planBonusActionId) {
            planActionId = existing.actionId;
            planBonusActionId = existing.bonusActionId ?? '';
            planTargetIds = existing.targetParticipantIds ?? [];
            planBonusTargetIds = existing.bonusTargetParticipantIds ?? [];
            planNotes = existing.notes;
          }
        }
      });
    }
  });

  onDestroy(() => {
    unsubStatus?.();
    unsubDoc?.();
    conn?.destroy();
    unsubEncState?.();
    encConn?.destroy();
  });

  /** Flat list of actions available from derived. Each row carries display
   *  bits plus a favorite flag (from character.favoriteActionIds) and a
   *  recencyRank (lower = more recently used, per the page-server's
   *  action_log lookup). The list is ordered favorites first, then by
   *  recency, then alphabetical so the planner's picker pre-sorts the
   *  most-likely-next-action to the top. */
  $: favorites = new Set(document?.favoriteActionIds ?? []);
  $: recencyRank = new Map((data.recentActionIds ?? []).map((id, i) => [id, i]));
  $: actionOptions = derived
    ? (derived.actions ?? [])
        .map((a) => {
          const slot = slotForCost(a.cost);
          const unavailable =
            (slot === 'action' && document?.actionUsedThisRound) ||
            (slot === 'bonus' && document?.bonusActionUsedThisRound) ||
            (slot === 'reaction' && document?.reactionUsedThisRound);
          return {
            id: a.id,
            name: a.name,
            costLabel: costLabel(a.cost),
            attackBonus: a.attackBonus ?? null,
            saveDC: a.saveDC ?? null,
            range: a.range,
            targetMode: a.targetMode,
            targetCount: a.targetCount,
            isFavorite: favorites.has(a.id),
            recency: recencyRank.has(a.id) ? recencyRank.get(a.id)! : Number.POSITIVE_INFINITY,
            slot,
            unavailable: !!unavailable,
            description: a.description
          };
        })
        .sort((a, b) => {
          if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
          if (a.unavailable !== b.unavailable) return a.unavailable ? 1 : -1;
          if (a.recency !== b.recency) return a.recency - b.recency;
          return a.name.localeCompare(b.name);
        })
    : [];

  /** Action-cost and bonus-cost subsets of actionOptions for the
   *  player-detail action-economy choosers. Ordered same as actionOptions
   *  (favorites → recency → name) so the most-likely-next is on top. */
  $: actionChoices = actionOptions.filter((a) => a.slot === 'action');
  $: bonusChoices = actionOptions.filter((a) => a.slot === 'bonus');

  /** The currently-picked or planned action; drives save-vs-attack mode in resolve. */
  $: pickedAction =
    actionOptions.find((a) => a.id === planActionId) ??
    actionOptions.find((a) => a.id === myPlan?.actionId) ??
    null;
  $: isSaveAction = !!pickedAction?.saveDC;

  /** Walking speed in feet — used as the movement budget. Falls back to 30. */
  $: walkSpeed = derived?.stats.speeds.walk ?? 30;
  $: movementUsed = document?.movementUsedThisRound ?? 0;
  $: movementRemaining = Math.max(0, walkSpeed - movementUsed);
  $: actionUsed = document?.actionUsedThisRound === true;
  $: bonusUsed = document?.bonusActionUsedThisRound === true;

  async function toggleFavoriteAction(actionId: string) {
    await patchDocument((d) => {
      const list = new Set(d.favoriteActionIds ?? []);
      if (list.has(actionId)) list.delete(actionId);
      else list.add(actionId);
      d.favoriteActionIds = [...list];
    });
  }

  function submitPlan() {
    broadcastPlan();
  }

  /** Push the current planActionId + planBonusActionId (plus target/notes)
   *  to the encounter channel. Called by the action / bonus-action choosers
   *  on every change so the DM sees intent in real time. If both slots are
   *  empty, clear the plan entirely instead of writing a blank record. */
  function broadcastPlan() {
    if (!encConn || !data.liveEncounter) return;
    const action = planActionId ? actionOptions.find((a) => a.id === planActionId) : null;
    const bonus = planBonusActionId ? actionOptions.find((a) => a.id === planBonusActionId) : null;
    if (!action && !bonus) {
      encConn.clearPlan(data.liveEncounter.selfParticipantId).catch(() => {});
      return;
    }
    planSubmitting = true;
    const plan: TurnPlan = {
      actionId: action?.id ?? '',
      actionLabel: action ? `${action.name} (${action.costLabel})` : '',
      bonusActionId: bonus?.id,
      bonusActionLabel: bonus ? `${bonus.name} (${bonus.costLabel})` : undefined,
      targetParticipantIds: planTargetIds,
      bonusTargetParticipantIds: planBonusTargetIds.length > 0 ? planBonusTargetIds : undefined,
      notes: planNotes.slice(0, 200),
      updatedAt: Date.now()
    };
    encConn
      .setPlan(data.liveEncounter.selfParticipantId, plan)
      .catch(() => {})
      .finally(() => {
        planSubmitting = false;
      });
  }

  function openResolve() {
    if (!myPlan) return;
    resolveOpen = true;
    resolveAttack = null;
    resolveDamage = null;
    resolveHit = '';
    resolveNotes = '';
    resolveError = null;
  }

  function resolveTargetParticipant() {
    const tid = myPlan?.targetParticipantIds?.[0];
    if (!data.liveEncounter || !tid) return null;
    return data.liveEncounter.participants.find((p) => p.id === tid) ?? null;
  }

  /** Apply HP delta + POST one log entry for a single target. Returns ok. */
  async function applyToTarget(
    target: { id: string; kind: string; maxHp: number | null } | null,
    outcome: typeof resolveHit,
    damage: number | null,
    attack: number | null,
    notesText: string,
    round: number,
    selfId: string
  ): Promise<boolean> {
    if (!encConn || !data.liveEncounter || !myPlan) return false;
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
      const live = encState?.participantHp[target.id];
      const seed: ParticipantHp = {
        currentHp: live?.currentHp ?? null,
        tempHp: live?.tempHp ?? 0,
        conditions: live?.conditions ?? []
      };
      targetHpBefore = seed.currentHp;
      const effective = outcome === 'saved' ? Math.floor(damage / 2) : damage;
      let next: ParticipantHp;
      if (effective === 0) {
        next = seed;
      } else if (outcome === 'heal') {
        next = encConn.applyHeal(target.id, damage, target.maxHp, seed);
      } else {
        next = encConn.applyDamage(target.id, effective, seed);
      }
      targetHpAfter = next.currentHp;
    }
    const res = await fetch(`/api/encounters/${data.liveEncounter.id}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participantId: selfId,
        targetParticipantId: target?.id ?? null,
        actionId: myPlan.actionId,
        actionLabel: myPlan.actionLabel,
        round,
        attackRoll: attack,
        damageRoll: damage,
        hit: outcome || null,
        targetHpBefore,
        targetHpAfter,
        notes: notesText.slice(0, 500) || null
      })
    });
    return res.ok;
  }

  async function submitResolve() {
    if (!encConn || !data.liveEncounter || !myPlan) return;
    const round = encState?.round ?? 0;
    const selfId = data.liveEncounter.selfParticipantId;
    resolveSubmitting = true;
    resolveError = null;

    try {
      if (isSaveAction && planTargetIds.length > 0 && pickedAction?.saveDC) {
        // Multi-target save: fire one log entry per target with per-target
        // pass/fail derived from save roll vs DC. If a row's save input is
        // blank, fall back to the form's outcome (defaults to failed-save).
        const dc = pickedAction.saveDC.value;
        for (const tid of planTargetIds) {
          const t = data.liveEncounter.participants.find((p) => p.id === tid) ?? null;
          if (!t) continue;
          const saveRoll = targetSaveRolls[tid];
          const perTargetOutcome: typeof resolveHit =
            typeof saveRoll === 'number'
              ? saveRoll >= dc
                ? 'saved'
                : 'failed-save'
              : resolveHit || 'failed-save';
          const ok = await applyToTarget(
            t,
            perTargetOutcome,
            resolveDamage,
            saveRoll ?? null,
            resolveNotes,
            round,
            selfId
          );
          if (!ok) {
            resolveError = `log entry failed for ${t.name}`;
            return;
          }
        }
      } else {
        const target = resolveTargetParticipant();
        const ok = await applyToTarget(
          target ? { id: target.id, kind: target.kind, maxHp: target.maxHp } : null,
          resolveHit,
          resolveDamage,
          resolveAttack,
          resolveNotes,
          round,
          selfId
        );
        if (!ok) {
          resolveError = 'log entry failed';
          return;
        }
      }

      // Consume the action-economy slot the resolved action takes.
      const resolvedAction = (derived?.actions ?? []).find((a) => a.id === myPlan.actionId);
      const slot = resolvedAction ? slotForCost(resolvedAction.cost) : null;
      if (slot) {
        await patchDocument((d) => {
          if (slot === 'action') d.actionUsedThisRound = true;
          else if (slot === 'bonus') d.bonusActionUsedThisRound = true;
          else if (slot === 'reaction') d.reactionUsedThisRound = true;
        });
      }
      // Clear the plan now that the action has been resolved.
      encConn.clearPlan(selfId).catch(() => {});
      planActionId = '';
      planTargetIds = [];
      planBonusTargetIds = [];
      planNotes = '';
      targetSaveRolls = {};
      resolveOpen = false;
    } finally {
      resolveSubmitting = false;
    }
  }

  $: myPlan =
    encState && data.liveEncounter
      ? encState.plans[data.liveEncounter.selfParticipantId] ?? null
      : null;

  $: encActiveName =
    encState && data.liveEncounter
      ? data.liveEncounter.participants.find((p) => p.id === encState!.activeParticipantId)?.name ??
        null
      : null;

  $: isMyTurn =
    encState && data.liveEncounter
      ? encState.activeParticipantId === data.liveEncounter.selfParticipantId
      : false;

  // Rising edge: when the active turn lands on us, reset any reaction that
  // got marked used during the prior round. We only react to transitions to
  // avoid clobbering a manual mark-as-used during the same turn.
  let prevIsMyTurn = false;
  $: {
    if (isMyTurn && !prevIsMyTurn) {
      // Action-economy reset on turn-rise: action, bonus, reaction, movement
      // all replenish at the start of the player's turn. Fire-and-forget so
      // busy state stays untouched for this background reset.
      const needsReset =
        document?.actionUsedThisRound ||
        document?.bonusActionUsedThisRound ||
        document?.reactionUsedThisRound ||
        (document?.movementUsedThisRound ?? 0) > 0;
      if (needsReset) {
        patchDocument((d) => {
          d.actionUsedThisRound = false;
          d.bonusActionUsedThisRound = false;
          d.reactionUsedThisRound = false;
          d.movementUsedThisRound = 0;
        }).catch(() => {});
      }
    }
    prevIsMyTurn = isMyTurn;
  }

  $: tempHpDraft = document?.tempHp ?? 0;

  function abilityMod(score: number): number {
    return Math.floor((score - 10) / 2);
  }

  function avgPerHitDie(hitDie: number): number {
    return Math.floor(hitDie / 2) + 1;
  }

  async function patchDocument(updater: (doc: NonNullable<typeof document>) => void) {
    if (!document) return;
    busy = true;
    try {
      const clone = structuredClone(document);
      updater(clone);
      const res = await fetch(`/api/characters/${data.character.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: clone })
      });
      if (!res.ok) {
        restNote = `error: ${res.status} ${(await res.text()).slice(0, 200)}`;
        return;
      }
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  async function applyDamage() {
    if (damageInput <= 0) return;
    const amount = damageInput;
    await patchDocument((d) => {
      const next = applyDamageDelta({ currentHp: d.currentHp, tempHp: d.tempHp }, amount);
      d.currentHp = next.currentHp ?? 0;
      d.tempHp = next.tempHp;
    });
    damageInput = 0;
  }

  async function applyHeal() {
    if (healInput <= 0 || !derived) return;
    const amount = healInput;
    const max = derived.stats.hp.max;
    await patchDocument((d) => {
      const next = applyHealDelta({ currentHp: d.currentHp, tempHp: d.tempHp }, amount, max);
      d.currentHp = next.currentHp ?? 0;
      if (d.currentHp > 0) d.deathSaves = undefined;
    });
    healInput = 0;
  }

  async function adjustDeathSave(kind: 'successes' | 'failures', delta: 1 | -1) {
    await patchDocument((d) => {
      if (!d.deathSaves) d.deathSaves = { successes: 0, failures: 0 };
      d.deathSaves[kind] = Math.max(0, Math.min(3, d.deathSaves[kind] + delta));
    });
  }

  async function setTempHp() {
    const n = Math.max(0, Math.floor(tempHpDraft));
    await patchDocument((d) => {
      d.tempHp = n;
    });
  }

  async function spendHitDie(classSlug: string) {
    if (!document || !derived) return;
    const cls = document.classes.find((c) => c.slug === classSlug);
    if (!cls) return;
    const spent = document.hitDiceSpent[classSlug] ?? 0;
    if (spent >= cls.level) return;
    // Spend the class's average hit-die roll + CON mod (no random in v0).
    // The pack carries hitDie under the class row's data; we don't have it
    // in the page-server load yet — use avg of d8 fallback for v0.
    const conMod = abilityMod(document.abilityScores.con);
    // Look at the class hitDie (live in class hpRolledPerLevel — every entry
    // after the first uses avg, which is `(hitDie/2)+1`. Reverse-engineer:
    // hitDie ≈ (any-after-first - 1) * 2. Falls back to 8 for a level-1 char.
    const hitDieGuess =
      cls.hpRolledPerLevel.length > 1
        ? (cls.hpRolledPerLevel[1] - 1) * 2
        : cls.hpRolledPerLevel[0];
    const recovery = Math.max(1, avgPerHitDie(hitDieGuess) + conMod);
    await patchDocument((d) => {
      d.hitDiceSpent[classSlug] = (d.hitDiceSpent[classSlug] ?? 0) + 1;
      d.currentHp = Math.min(derived!.stats.hp.max, d.currentHp + recovery);
    });
    restNote = `Spent 1 hit die (${classSlug}); recovered ${recovery} HP`;
  }

  async function toggleCondition(name: string, on: boolean) {
    const available = derived?.availableActivations ?? [];
    const equipped = derived?.equipped ?? { armorType: null, shield: false };
    await patchDocument((d) => {
      const has = d.conditions.includes(name);
      if (on && !has) {
        d.conditions.push(name);
        // For stackable conditions, initialise the stack count to 1 when first toggled on.
        if (name === 'exhaustion') {
          if (!d.conditionStacks) d.conditionStacks = {};
          if (!d.conditionStacks[name]) d.conditionStacks[name] = 1;
        }
        // Auto-cancel activations whose autoCancelOn list includes the
        // newly-added condition (Bladesong drops on incapacitated, etc.).
        const cancelled = applyAutoCancelOnStateChange(d, available, equipped);
        d.activations = cancelled.activations ?? d.activations;
        d.concentrating = cancelled.concentrating ?? null;
      } else if (!on && has) {
        d.conditions = d.conditions.filter((c) => c !== name);
        // Clear the stack when condition is removed.
        if (d.conditionStacks) delete d.conditionStacks[name];
      }
    });
  }

  async function setConditionStack(name: string, level: number) {
    await patchDocument((d) => {
      if (!d.conditionStacks) d.conditionStacks = {};
      d.conditionStacks[name] = Math.max(1, Math.min(10, level));
    });
  }

  async function toggleModifier(id: string, enabled: boolean) {
    await patchDocument((d) => {
      d.modifierToggles[id] = enabled;
    });
  }

  async function handleActivationToggle(
    e: CustomEvent<{ id: string; on: boolean; variant?: string; slot?: number }>
  ) {
    if (!derived) return;
    const available = derived.availableActivations;
    const { id, on, variant, slot } = e.detail;
    const opts: { variant?: string; slot?: number } = {};
    if (variant !== undefined) opts.variant = variant;
    if (slot !== undefined) opts.slot = slot;
    await patchDocument((d) => {
      const result = toggleActivation(d, available, id, on, opts);
      d.activations = result.character.activations ?? {};
      d.concentrating = result.character.concentrating ?? null;
    });
  }

  async function handleActivationRestPick(
    e: CustomEvent<{ id: string; variant: string | null }>
  ) {
    if (!derived) return;
    const available = derived.availableActivations;
    const { id, variant } = e.detail;
    await patchDocument((d) => {
      const updated = pickRestVariant(d, available, id, variant);
      d.activations = updated.activations ?? {};
    });
  }

  async function handleAddReceivedBuff(
    e: CustomEvent<{ spellSlug: string; slot?: number }>
  ) {
    const { spellSlug, slot } = e.detail;
    await patchDocument((d) => {
      if (!d.receivedBuffs) d.receivedBuffs = [];
      d.receivedBuffs.push({
        id: `${spellSlug}-${Date.now()}`,
        spellSlug,
        ...(slot !== undefined ? { slot } : {})
      });
    });
  }

  async function handleRemoveReceivedBuff(e: CustomEvent<{ id: string }>) {
    const { id } = e.detail;
    await patchDocument((d) => {
      d.receivedBuffs = (d.receivedBuffs ?? []).filter((b) => b.id !== id);
    });
  }

  async function handleUpdateReceivedBuff(
    e: CustomEvent<{ id: string; patch: Partial<{ slot: number; variant: string; sourceLabel: string }> }>
  ) {
    const { id, patch } = e.detail;
    await patchDocument((d) => {
      const buff = (d.receivedBuffs ?? []).find((b) => b.id === id);
      if (!buff) return;
      Object.assign(buff, patch);
    });
  }

  function openMetaEdit() {
    if (!document) return;
    editName = data.character.name;
    editAbilities = { ...document.abilityScores };
    editError = null;
    editingMeta = true;
  }

  async function saveMetaEdit() {
    if (!document) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      editError = 'name is required';
      return;
    }
    // Validate ability scores in a wide-but-sane range so a typo can't
    // wedge derive(). 3..30 covers everything from rolled minimums to
    // monstrous boons.
    for (const ab of ABILITY_KEYS) {
      const v = editAbilities[ab];
      if (!Number.isFinite(v) || v < 3 || v > 30) {
        editError = `${ab.toUpperCase()} must be 3-30`;
        return;
      }
    }
    busy = true;
    try {
      const nextDoc = { ...document, abilityScores: { ...editAbilities } };
      const res = await fetch(`/api/characters/${data.character.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, document: nextDoc })
      });
      if (!res.ok) {
        editError = `error: ${res.status} ${(await res.text()).slice(0, 200)}`;
        return;
      }
      editingMeta = false;
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  // ---- feats ----
  // Picker key is `pickerId` (slug+author) so two homebrew feats with the
  // same slug from different authors are distinct dropdown entries. The
  // selected option's authorUserId is stamped onto the character document's
  // ContentRef so the engine resolves the right row even after slug
  // collisions arrive.
  let featPickerKey = data.featOptions[0]?.pickerId ?? '';
  let showFeatPicker = false;

  /** Heuristic feat budget. 5e baseline: 1 origin feat at L1 + 1 feat slot at
   *  each ASI level (4/8/12/16/19) where the player chooses feat over ASI.
   *  Fighter gets bonus ASI slots at 6/14; Rogue at 10. We can't tell which
   *  ASI levels were taken as ability bumps vs feats, so this is the *max*
   *  feats the player could plausibly have — they override how many to
   *  actually claim. */
  $: maxFeats = (() => {
    if (!document) return 0;
    let count = 1; // origin feat from background
    for (const c of document.classes) {
      const asiLevels: number[] = [4, 8, 12, 16, 19];
      if (c.slug === 'fighter') asiLevels.push(6, 14);
      if (c.slug === 'rogue') asiLevels.push(10);
      for (const lvl of asiLevels) {
        if (c.level >= lvl) count += 1;
      }
    }
    return count;
  })();

  /** Resolve an option by (slug, authorUserId). When authorUserId is null/
   *  undefined we prefer the global row, then any homebrew with that slug —
   *  matches how buildContentLookup falls back. */
  function featMeta(slug: string, authorUserId?: string | null) {
    if (authorUserId != null) {
      const exact = data.featOptions.find((f) => f.slug === slug && f.authorUserId === authorUserId);
      if (exact) return exact;
    }
    return (
      data.featOptions.find((f) => f.slug === slug && f.authorUserId === null) ??
      data.featOptions.find((f) => f.slug === slug)
    );
  }
  function featByPickerId(id: string) {
    return data.featOptions.find((f) => f.pickerId === id);
  }

  // Draft picks for the currently-selected feat. Reset whenever featPickerKey
  // changes so stale picks from a previous feat don't leak in.
  let featDraftAbility = '';
  let featDraftSkillProf = '';
  let featDraftExpertise = '';
  let featDraftSave = '';
  let featDraftLanguage = '';
  let featDraftTool = '';
  let featDraftSpells: string[] = [];
  let featDraftFeature = '';
  let featDraftFeatures: string[] = [];
  let featDraftAsiMode: 'one' | 'split' = 'one';
  let featDraftAsiSelections: string[] = [''];

  // Inline edit state for already-installed feats with asiBudget.
  let editingAsiKey: string | null = null;
  let editAsiMode: 'one' | 'split' = 'one';
  let editAsiSelections: string[] = [''];

  function openAsiEdit(f: { slug: string; authorUserId?: string | null; choices?: Record<string, unknown> }, asiBudget: number) {
    const key = `${f.slug}|${f.authorUserId ?? ''}`;
    if (editingAsiKey === key) { editingAsiKey = null; return; }
    const existing = (f.choices?.asis as Array<{ ability: string; bonus: number }> | undefined) ?? [];
    if (existing.length > 1) {
      editAsiMode = 'split';
      editAsiSelections = existing.map((a) => a.ability);
    } else {
      editAsiMode = 'one';
      editAsiSelections = [existing[0]?.ability ?? ''];
    }
    editingAsiKey = key;
  }

  // Phase 4: Persist a feature-pick selection emitted by FeatureChoicesPanel.
  // Subclass-row picks land on character.subclassChoices; everything else
  // lands on character.featureChoices.
  async function onFeaturePick(
    e: CustomEvent<{ featureSlug: string; kind: string; picks: Record<string, unknown> }>
  ) {
    const { featureSlug, kind, picks } = e.detail;
    await patchDocument((d) => {
      if (kind === 'subclass') {
        if (!d.subclassChoices) d.subclassChoices = {};
        d.subclassChoices[featureSlug] = picks;
      } else {
        if (!d.featureChoices) d.featureChoices = {};
        d.featureChoices[featureSlug] = picks;
      }
    });
  }

  async function saveAsiChoices(f: { slug: string; authorUserId?: string | null }, asiBudget: number) {
    const asis: Array<{ ability: string; bonus: number }> = [];
    if (editAsiMode === 'one') {
      if (editAsiSelections[0]) asis.push({ ability: editAsiSelections[0], bonus: asiBudget });
    } else {
      for (const ab of editAsiSelections) {
        if (ab) asis.push({ ability: ab, bonus: 1 });
      }
    }
    await patchDocument((d) => {
      const feat = d.feats.find(
        (x) => x.slug === f.slug && (x.authorUserId ?? null) === (f.authorUserId ?? null)
      );
      if (!feat) return;
      feat.choices = { ...(feat.choices ?? {}), asis };
    });
    editingAsiKey = null;
  }
  let lastDraftKey = '';
  $: if (featPickerKey !== lastDraftKey) {
    featDraftAbility = '';
    featDraftSkillProf = '';
    featDraftExpertise = '';
    featDraftSave = '';
    featDraftLanguage = '';
    featDraftTool = '';
    featDraftSpells = [];
    featDraftFeature = '';
    featDraftFeatures = [];
    featDraftAsiMode = 'one';
    featDraftAsiSelections = [''];
    lastDraftKey = featPickerKey;
  }
  $: pickedFeatChoices = featByPickerId(featPickerKey)?.choices ?? null;
  $: featFeaturePickCount = (pickedFeatChoices?.feature as { picks?: number } | undefined)?.picks ?? 1;
  $: featFeatureAllowed = (pickedFeatChoices?.feature as { allowedFeatures?: string[] } | undefined)?.allowedFeatures ?? [];
  $: featFeatureCategory = (pickedFeatChoices?.feature as { category?: string } | undefined)?.category ?? 'Feature';
  $: featFeatureReady = !pickedFeatChoices?.feature ||
    (featFeaturePickCount > 1 ? featDraftFeatures.length >= featFeaturePickCount : !!featDraftFeature);
  /** Skill list restricted to "currently proficient" for the expertise input
   *  when the feat says `allowedSkills: 'proficient'`. Falls back to all
   *  skills if derived isn't ready. */
  $: proficientSkills = derived
    ? SKILLS.filter((s) => derived.stats.skills[s]?.proficient)
    : SKILLS;

  async function addFeat() {
    if (!featPickerKey) return;
    const opt = featByPickerId(featPickerKey);
    if (!opt) return;
    const choices: Record<string, unknown> = {};
    if (opt.asiBudget != null) {
      const asis: Array<{ ability: string; bonus: number }> = [];
      if (featDraftAsiMode === 'one') {
        if (featDraftAsiSelections[0]) asis.push({ ability: featDraftAsiSelections[0], bonus: opt.asiBudget });
      } else {
        for (const ab of featDraftAsiSelections) {
          if (ab) asis.push({ ability: ab, bonus: 1 });
        }
      }
      if (asis.length > 0) choices.asis = asis;
    }
    if (opt.choices?.asi && featDraftAbility) {
      choices.asi = { ability: featDraftAbility };
    }
    if (opt.choices?.skillProficiency && featDraftSkillProf) {
      choices.skillProficiency = { skill: featDraftSkillProf };
    }
    if (opt.choices?.expertise && featDraftExpertise) {
      choices.expertise = { skill: featDraftExpertise };
    }
    if (opt.choices?.savingThrow && featDraftSave) {
      choices.savingThrow = { ability: featDraftSave };
    }
    if (opt.choices?.language && featDraftLanguage) {
      choices.language = { language: featDraftLanguage };
    }
    if (opt.choices?.toolProficiency && featDraftTool) {
      choices.toolProficiency = { tool: featDraftTool };
    }
    if (opt.choices?.spell && featDraftSpells.length > 0) {
      choices.spell = { spells: featDraftSpells };
    }
    if (opt.choices?.feature) {
      const pickCount = (opt.choices.feature as { picks?: number }).picks ?? 1;
      if (pickCount > 1 && featDraftFeatures.length > 0) {
        choices.feature = { features: featDraftFeatures };
      } else if (pickCount <= 1 && featDraftFeature) {
        choices.feature = { feature: featDraftFeature };
      }
    }
    await patchDocument((d) => {
      // Dedupe per (slug, authorUserId) — Alice's and Bob's "alert" coexist.
      if (d.feats.some((f) => f.slug === opt.slug && (f.authorUserId ?? null) === opt.authorUserId)) return;
      d.feats.push({
        kind: 'feat',
        slug: opt.slug,
        // Only emit authorUserId when it's a homebrew row; keeps the
        // document shape minimal for SRD/pack content.
        ...(opt.authorUserId ? { authorUserId: opt.authorUserId } : {}),
        ...(Object.keys(choices).length > 0 ? { choices } : {})
      });
    });
    showFeatPicker = false;
    featPickerKey = '';
  }
  async function removeFeat(slug: string, authorUserId: string | null | undefined) {
    await patchDocument((d) => {
      d.feats = d.feats.filter(
        (f) => !(f.slug === slug && (f.authorUserId ?? null) === (authorUserId ?? null))
      );
    });
  }

  /** Pick out the player's locked-in choices for an installed feat. Used by
   *  the list display to show "Skill Expert (Dex / Investigation / Perception)". */
  function describeFeatChoices(slug: string): string {
    const f = document?.feats.find((x) => x.slug === slug);
    const c = f?.choices as
      | {
          asis?: Array<{ ability: string; bonus: number }>;
          asi?: { ability?: string };
          skillProficiency?: { skill?: string };
          expertise?: { skill?: string };
          savingThrow?: { ability?: string };
          language?: { language?: string };
          toolProficiency?: { tool?: string };
          spell?: { spells?: string[] };
          feature?: { feature?: string };
        }
      | undefined;
    if (!c) return '';
    const parts: string[] = [];
    if (c.asis?.length) {
      for (const a of c.asis) parts.push(`+${a.bonus} ${a.ability.toUpperCase()}`);
    }
    if (c.asi?.ability) parts.push(`+1 ${c.asi.ability.toUpperCase()}`);
    if (c.savingThrow?.ability) parts.push(`save prof ${c.savingThrow.ability.toUpperCase()}`);
    if (c.skillProficiency?.skill) parts.push(`prof ${c.skillProficiency.skill}`);
    if (c.expertise?.skill) parts.push(`expertise ${c.expertise.skill}`);
    if (c.toolProficiency?.tool) parts.push(`tool ${c.toolProficiency.tool}`);
    if (c.language?.language) parts.push(`language ${c.language.language}`);
    if (c.spell?.spells?.length) parts.push(`spells: ${c.spell.spells.join(', ')}`);
    if ((c.feature as { features?: string[] } | undefined)?.features?.length)
      parts.push(`${(c.feature as { features?: string[] }).features!.join(', ')}`);
    else if (c.feature?.feature) parts.push(`feature ${c.feature.feature}`);
    return parts.join(' · ');
  }

  async function adjustResource(id: string, delta: number, max: number) {
    // If this resource has an appliesCondition (e.g. Rage → "rage" condition),
    // consuming a charge (delta > 0) also activates the condition so the
    // engine's appliesWhen-gated modifiers (resistance, rage damage) light
    // up without a second click. Restoring (+1) doesn't auto-drop — the
    // player drops the condition explicitly via the conditions row when
    // rage actually ends.
    const r = derived?.resources.find((x) => x.id === id);
    const cond = delta > 0 ? r?.appliesCondition : undefined;
    await patchDocument((d) => {
      d.resourcesSpent ??= {};
      const next = Math.max(0, Math.min(max, (d.resourcesSpent[id] ?? 0) + delta));
      d.resourcesSpent[id] = next;
      if (cond && !d.conditions.includes(cond)) d.conditions.push(cond);
    });
  }

  // ---- reaction + concentration (M3.6) ----
  async function toggleReaction() {
    await patchDocument((d) => {
      d.reactionUsedThisRound = !d.reactionUsedThisRound;
    });
  }

  // ---- action-economy slots (M3.7) ----
  async function toggleAction() {
    await patchDocument((d) => {
      d.actionUsedThisRound = !d.actionUsedThisRound;
    });
  }
  async function toggleBonusAction() {
    await patchDocument((d) => {
      d.bonusActionUsedThisRound = !d.bonusActionUsedThisRound;
    });
  }
  async function adjustMovement(deltaFt: number) {
    await patchDocument((d) => {
      const cur = d.movementUsedThisRound ?? 0;
      d.movementUsedThisRound = Math.max(0, cur + deltaFt);
    });
  }
  async function resetMovement() {
    await patchDocument((d) => {
      d.movementUsedThisRound = 0;
    });
  }

  let concDraft = '';
  $: reactionUsed = document?.reactionUsedThisRound === true;
  async function startConcentration() {
    const label = concDraft.trim();
    if (!label) return;
    const round = encState?.round ?? undefined;
    await patchDocument((d) => {
      d.concentrating = { label, ...(round != null ? { sinceRound: round } : {}) };
    });
    concDraft = '';
  }
  async function endConcentration() {
    await patchDocument((d) => {
      d.concentrating = null;
    });
  }

  // ---- inventory ----
  let showInventoryPicker = false;

  async function addItem(slug: string) {
    if (!slug) return;
    const opt = data.itemOptions.find((i) => i.slug === slug);
    if (!opt) return;
    await patchDocument((d) => {
      d.inventory.push({
        contentKind: 'item',
        contentSlug: opt.slug,
        version: 1,
        // Stamp homebrew author so the engine resolves the right row even
        // when a pack and a subscription share a slug. Pack items stay
        // unstamped (authorUserId null).
        ...(opt.authorUserId ? { authorUserId: opt.authorUserId } : {}),
        equipped: false,
        attuned: false
      });
    });
  }

  function onPickerPick(e: CustomEvent<{ slug: string }>) {
    showInventoryPicker = false;
    if (e.detail.slug) addItem(e.detail.slug);
  }

  async function setInventoryFlag(index: number, key: 'equipped' | 'attuned', on: boolean) {
    const available = derived?.availableActivations ?? [];
    await patchDocument((d) => {
      if (!d.inventory[index]) return;
      d.inventory[index][key] = on;
      // When equipped state changes, re-derive the equipped summary
      // inline so the auto-cancel walk sees the new state. Done with a
      // lightweight scan rather than a full derive() — same logic the
      // engine uses, applied to the patched draft.
      if (key === 'equipped') {
        const eq = recomputeEquippedFromInventory(d, contentLookup);
        const cancelled = applyAutoCancelOnStateChange(d, available, eq);
        d.activations = cancelled.activations ?? d.activations;
        d.concentrating = cancelled.concentrating ?? null;
      }
    });
  }

  // Mirrors the equipped-summary computation in derive.ts: walk the
  // character's equipped inventory, resolve item slugs against the
  // content lookup, classify as armor body slot / shield. Kept inline
  // to avoid a full derive() round-trip from the equip handler.
  function recomputeEquippedFromInventory(
    d: NonNullable<typeof document>,
    lookup: typeof contentLookup
  ): { armorType: 'light' | 'medium' | 'heavy' | null; shield: boolean } {
    let armorType: 'light' | 'medium' | 'heavy' | null = null;
    let shield = false;
    for (const slot of d.inventory) {
      if (!slot.equipped) continue;
      const row = lookup({ kind: slot.contentKind, slug: slot.contentSlug });
      const data = row?.data as { category?: string; armorType?: string } | undefined;
      if (data?.category !== 'armor') continue;
      if (data.armorType === 'shield') shield = true;
      else if (armorType === null) {
        armorType =
          data.armorType === 'medium' || data.armorType === 'heavy' ? data.armorType : 'light';
      }
    }
    return { armorType, shield };
  }

  async function removeInventoryItem(index: number) {
    await patchDocument((d) => {
      d.inventory.splice(index, 1);
    });
  }

  function itemMeta(slug: string) {
    return data.itemOptions.find((i) => i.slug === slug);
  }

  // ---- spells ----
  let spellManagerOpen = false;

  /** Picker emits the (slug,author) key so two same-slug spells from
   *  different homebrew authors are distinct dropdown entries. We look up
   *  the option by pickerId, dedupe per (slug, author) on the doc, and
   *  stamp authorUserId so the engine resolves the right row even after
   *  slug collisions land. Mirrors the feat add path above. */
  async function addSpell(pickerId: string) {
    const opt = data.spellOptions.find((s) => s.pickerId === pickerId);
    if (!opt) return;
    await patchDocument((d) => {
      if (
        d.spells.known.some(
          (k) => k.slug === opt.slug && (k.authorUserId ?? null) === opt.authorUserId
        )
      ) return;
      d.spells.known.push({
        kind: 'spell',
        slug: opt.slug,
        version: 1,
        ...(opt.authorUserId ? { authorUserId: opt.authorUserId } : {})
      });
    });
  }

  async function togglePrepared(slug: string, on: boolean) {
    await patchDocument((d) => {
      const has = d.spells.prepared.includes(slug);
      if (on && !has) d.spells.prepared.push(slug);
      else if (!on && has) d.spells.prepared = d.spells.prepared.filter((s) => s !== slug);
    });
  }

  /** Remove by (slug, author) so we don't yank a same-slug spell that
   *  belongs to a different author. `prepared` is a slug-only list, so
   *  drop it only when the last known copy of this slug is gone. */
  async function removeSpell(slug: string, authorUserId: string | null | undefined) {
    await patchDocument((d) => {
      d.spells.known = d.spells.known.filter(
        (s) => !(s.slug === slug && (s.authorUserId ?? null) === (authorUserId ?? null))
      );
      const stillKnown = d.spells.known.some((s) => s.slug === slug);
      if (!stillKnown) {
        d.spells.prepared = d.spells.prepared.filter((s) => s !== slug);
      }
    });
  }

  $: preparedCount = document?.spells.prepared.length ?? 0;

  // ---- level up ----
  const ASI_LEVELS = new Set([4, 8, 12, 16, 19]);
  const SUBCLASS_UNLOCK_LEVEL = 3;
  const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

  let levelingUp: {
    classSlug: string;
    newLevel: number;
    needsSubclass: boolean;
    subclassSlug: string;
    needsAsi: boolean;
    asiMode: 'two-one' | 'three-ones';
    asiBumps: Array<{ ability: string; bonus: number }>;
  } | null = null;

  $: subclassOptionsForLevelup = (() => {
    const lvl = levelingUp;
    return lvl ? data.subclassOptions.filter((s) => s.parentClass === lvl.classSlug) : [];
  })();

  function startLevelUp(classSlug: string) {
    if (!document) return;
    const cls = document.classes.find((c) => c.slug === classSlug);
    if (!cls) return;
    const newLevel = cls.level + 1;
    if (newLevel > 20) return;
    // A subclass is needed if the new level is at or past the subclass-unlock
    // threshold AND no subclass is set yet. Catches characters created at L3+
    // without one + the rare "skipped at L3, picking later" case.
    const needsSubclass = newLevel >= SUBCLASS_UNLOCK_LEVEL && !cls.subclass;
    const needsAsi = ASI_LEVELS.has(newLevel);
    const sub = data.subclassOptions.find((s) => s.parentClass === classSlug);
    levelingUp = {
      classSlug,
      newLevel,
      needsSubclass,
      subclassSlug: cls.subclass ?? sub?.slug ?? '',
      needsAsi,
      asiMode: 'two-one',
      asiBumps: [
        { ability: 'str', bonus: 2 },
        { ability: 'dex', bonus: 1 }
      ]
    };
  }

  // Retroactive subclass picker: when an existing L3+ class has no subclass,
  // surface a small inline form on the sheet.
  let subclassFillSlug: Record<string, string> = {};

  async function setSubclassFor(classSlug: string) {
    const choice = subclassFillSlug[classSlug];
    if (!choice) return;
    await patchDocument((d) => {
      const cls = d.classes.find((c) => c.slug === classSlug);
      if (!cls) return;
      cls.subclass = choice;
    });
    restNote = `Set ${classSlug} subclass to ${choice}.`;
  }

  // ---- retroactive background + ASI bump picker ----
  //
  // Creation form doesn't ask for these (deliberately — kept it simple +
  // dodged a reactivity bug). Surface it here when document.background is
  // null. State updates use explicit on:change handlers, NOT reactive `$:`,
  // so the user's dropdown picks aren't blown away by recompute.
  let bgDraftSlug = '';
  let bgDraftMode: 'two-one' | 'three-ones' = 'two-one';
  let bgDraftBumps: Array<{ ability: string; bonus: number }> = [];

  $: bgDraftMeta = data.backgroundOptions.find((b) => b.slug === bgDraftSlug);

  function makeBgBumps(
    mode: 'two-one' | 'three-ones',
    slug: string
  ): Array<{ ability: string; bonus: number }> {
    const bg = data.backgroundOptions.find((b) => b.slug === slug);
    const choices = bg?.abilityChoices ?? [];
    if (mode === 'two-one') {
      return [
        { ability: choices[0] ?? 'str', bonus: 2 },
        { ability: choices[1] ?? 'dex', bonus: 1 }
      ];
    }
    return choices.slice(0, 3).map((a) => ({ ability: a, bonus: 1 }));
  }

  function selectBgDraft(e: Event) {
    const slug = (e.target as HTMLSelectElement).value;
    bgDraftSlug = slug;
    bgDraftBumps = makeBgBumps(bgDraftMode, slug);
  }

  function selectBgMode(mode: 'two-one' | 'three-ones') {
    bgDraftMode = mode;
    bgDraftBumps = makeBgBumps(mode, bgDraftSlug);
  }

  async function applyBackground() {
    if (!bgDraftSlug) {
      restNote = 'Pick a background first.';
      return;
    }
    const distinct = new Set(bgDraftBumps.map((b) => b.ability));
    if (distinct.size !== bgDraftBumps.length) {
      restNote = 'Ability bumps must be distinct.';
      return;
    }
    const bumps = bgDraftBumps;
    const slug = bgDraftSlug;
    await patchDocument((d) => {
      d.background = {
        kind: 'background',
        slug,
        version: 1,
        choices: { asis: bumps }
      };
    });
    restNote = `Set background to ${slug}.`;
    bgDraftSlug = '';
    bgDraftBumps = [];
  }

  function cancelLevelUp() {
    levelingUp = null;
  }

  $: if (levelingUp) {
    levelingUp.asiBumps =
      levelingUp.asiMode === 'two-one'
        ? [
            { ability: levelingUp.asiBumps[0]?.ability ?? 'str', bonus: 2 },
            { ability: levelingUp.asiBumps[1]?.ability ?? 'dex', bonus: 1 }
          ]
        : [
            { ability: levelingUp.asiBumps[0]?.ability ?? 'str', bonus: 1 },
            { ability: levelingUp.asiBumps[1]?.ability ?? 'dex', bonus: 1 },
            { ability: levelingUp.asiBumps[2]?.ability ?? 'con', bonus: 1 }
          ];
  }

  async function confirmLevelUp() {
    if (!levelingUp || !document) return;
    if (levelingUp.needsSubclass && !levelingUp.subclassSlug) {
      restNote = 'Pick a subclass before confirming the level-up.';
      return;
    }
    if (levelingUp.needsAsi) {
      const distinct = new Set(levelingUp.asiBumps.map((b) => b.ability));
      if (distinct.size !== levelingUp.asiBumps.length) {
        restNote = 'ASI ability bumps must be distinct.';
        return;
      }
    }
    const draft = levelingUp;
    await patchDocument((d) => {
      const cls = d.classes.find((c) => c.slug === draft.classSlug);
      if (!cls) return;
      cls.level = draft.newLevel;
      // HP gain: average of hit-die size + CON mod
      const hitDie =
        cls.hpRolledPerLevel.length > 1
          ? (cls.hpRolledPerLevel[1] - 1) * 2
          : cls.hpRolledPerLevel[0];
      const conMod = abilityMod(d.abilityScores.con);
      const gained = Math.max(1, avgPerHitDie(hitDie) + conMod);
      cls.hpRolledPerLevel.push(avgPerHitDie(hitDie));
      // Subclass
      if (draft.needsSubclass && draft.subclassSlug) {
        cls.subclass = draft.subclassSlug;
      }
      // ASI bumps applied to base abilityScores (they compose downstream).
      if (draft.needsAsi) {
        for (const b of draft.asiBumps) {
          d.abilityScores[b.ability as keyof typeof d.abilityScores] += b.bonus;
        }
      }
      // Bump currentHp by the gained amount (rules text: "gain hit point maximum
      // increase as you level"). currentHp goes up by the same amount.
      d.currentHp += gained;
    });
    restNote = `Leveled ${draft.classSlug} to ${draft.newLevel}.`;
    levelingUp = null;
  }

  function resetResourcesByPer(d: NonNullable<typeof document>, per: string) {
    if (!derived) return;
    d.resourcesSpent ??= {};
    for (const r of derived.resources) {
      if (r.per === per) d.resourcesSpent[r.id] = 0;
    }
  }

  /** Clear all `spell-slot/L<n>` entries from resourcesSpent — used on long rest. */
  function resetSpellSlots(d: NonNullable<typeof document>) {
    d.resourcesSpent ??= {};
    for (const key of Object.keys(d.resourcesSpent)) {
      if (key.startsWith('spell-slot/L')) d.resourcesSpent[key] = 0;
    }
  }

  async function shortRest() {
    if (!derived) return;
    const available = derived.availableActivations ?? [];
    await patchDocument((d) => {
      resetResourcesByPer(d, 'short-rest');
      d.actionUsedThisRound = false;
      d.bonusActionUsedThisRound = false;
      d.reactionUsedThisRound = false;
      d.movementUsedThisRound = 0;
      // Refresh per-short-rest activation uses + drop active toggles
      // (rest length is longer than typical activation durations).
      const refreshed = refreshActivations(d, available, 'short-rest');
      d.activations = refreshed.activations ?? {};
      for (const a of available) {
        if (a.duration === 'persistent') continue;
        const state = d.activations[a.id];
        if (state?.active) d.activations[a.id] = { ...state, active: false };
      }
    });
    restingShort = true;
    restNote = 'Short rest — short-rest resources restored. Spend hit dice below as needed.';
  }

  async function longRest() {
    if (!confirm('Take a long rest? Restores HP, half of total hit dice, and per-long-rest abilities.')) return;
    if (!derived) return;
    await patchDocument((d) => {
      d.currentHp = derived!.stats.hp.max;
      d.tempHp = 0;
      // Recover floor(total/2) hit dice per class, min 1.
      for (const c of d.classes) {
        const spent = d.hitDiceSpent[c.slug] ?? 0;
        const recovered = Math.max(1, Math.floor(c.level / 2));
        d.hitDiceSpent[c.slug] = Math.max(0, spent - recovered);
      }
      // Reset per-long-rest AND per-short-rest resources (long rest covers
      // short-rest features too) AND spell slots. Drop concentration and
      // restore reaction.
      resetResourcesByPer(d, 'long-rest');
      resetResourcesByPer(d, 'short-rest');
      resetSpellSlots(d);
      d.actionUsedThisRound = false;
      d.bonusActionUsedThisRound = false;
      d.reactionUsedThisRound = false;
      d.movementUsedThisRound = 0;
      d.concentrating = null;
      // Refresh per-rest activation uses + drop all active toggles
      // (long rest covers short, day, and long activation refresh
      // policies).
      const available = derived!.availableActivations ?? [];
      const refreshed = refreshActivations(d, available, 'long-rest');
      d.activations = refreshed.activations ?? {};
      for (const a of available) {
        if (a.duration === 'persistent') continue;
        const state = d.activations[a.id];
        if (state?.active) d.activations[a.id] = { ...state, active: false };
      }
      // Toggles (Reckless, GWM…) are per-turn / per-attack choices — don't
      // reset them on rest. Conditions like "frightened" generally end on a
      // long rest unless the source persists, but we don't track durations
      // yet, so leave them — DM adjudicates.
    });
    restingShort = false;
    restNote = 'Long rest complete.';
  }

  // Spell-slot consumption keys (matches derive.ts overlay).
  function slotKey(level: number): string {
    return `spell-slot/L${level}`;
  }
  async function spendSlot(level: number) {
    if (!derived) return;
    const slot = derived.stats.spellSlots[level];
    if (!slot || slot.used >= slot.max) return;
    await patchDocument((d) => {
      d.resourcesSpent ??= {};
      d.resourcesSpent[slotKey(level)] = Math.min(slot.max, (d.resourcesSpent[slotKey(level)] ?? 0) + 1);
    });
  }
  async function restoreSlot(level: number) {
    if (!derived) return;
    const slot = derived.stats.spellSlots[level];
    if (!slot || slot.used <= 0) return;
    await patchDocument((d) => {
      d.resourcesSpent ??= {};
      d.resourcesSpent[slotKey(level)] = Math.max(0, (d.resourcesSpent[slotKey(level)] ?? 0) - 1);
    });
  }
</script>

<svelte:head>
  <title>{data.character.name} — {data.campaign.name}</title>
</svelte:head>

<header class="mb-6 flex items-start justify-between">
  <div class="flex items-start gap-3">
    {#if document?.portrait}
      <img src={document.portrait} alt={data.character.name} class="h-16 w-11 rounded object-cover object-top" />
    {/if}
    <div>
    <h1 class="flex items-baseline gap-2 text-2xl font-semibold">
      <span>{data.character.name}</span>
      <span
        class="inline-block h-1.5 w-1.5 rounded-full {syncStatus === 'open'
          ? 'bg-emerald-400'
          : syncStatus === 'connecting'
            ? 'bg-slate-500'
            : 'bg-amber-400'}"
        title={syncStatus === 'open'
          ? 'Live sync connected'
          : syncStatus === 'connecting'
            ? 'Sync connecting…'
            : 'Sync offline (edits still persist via API)'}
        aria-label="Live sync status"
      ></span>
      {#if document && !editingMeta}
        <button
          class="text-xs font-normal text-slate-500 hover:text-emerald-300"
          title="Rename + edit ability scores"
          on:click={openMetaEdit}
        >
          ✎ edit
        </button>
      {/if}
    </h1>
    <p class="text-sm text-slate-400">
      {#if document}
        {#each document.classes as c, i}
          {c.slug}{#if c.subclass} ({c.subclass}){/if} {c.level}{#if i < document.classes.length - 1}, {/if}
        {/each}
        &middot; {document.species.slug}{#if document.subspecies} ({document.subspecies.slug}){/if}
        {#if document.background} &middot; {document.background.slug}{/if}
      {:else}
        no document yet
      {/if}
    </p>
    </div>
  </div>
  <a class="text-xs text-slate-400 hover:text-slate-200" href={`/c/${data.campaign.code}`}>
    ← back to {data.campaign.name}
  </a>
</header>

{#if editingMeta && document}
  <section class="mb-6 rounded-lg border border-emerald-800 bg-emerald-950/20 p-4">
    <h2 class="mb-3 text-sm font-semibold text-emerald-200">Edit character</h2>
    <div class="mb-3">
      <label class="block text-xs">
        <span class="mb-1 block text-slate-400">Name</span>
        <input
          class="w-full max-w-sm rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          bind:value={editName}
          maxlength="120"
        />
      </label>
    </div>
    <div class="mb-3">
      <span class="mb-1 block text-xs text-slate-400">Ability scores (3-30)</span>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {#each ABILITY_KEYS as ab}
          <label class="text-xs">
            <span class="block text-center text-[10px] uppercase tracking-wide text-slate-500">{ab}</span>
            <input
              type="number"
              min="3"
              max="30"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono"
              bind:value={editAbilities[ab]}
            />
          </label>
        {/each}
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
        on:click={saveMetaEdit}
        disabled={busy}
      >
        Save
      </button>
      <button
        class="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
        on:click={() => (editingMeta = false)}
        disabled={busy}
      >
        Cancel
      </button>
      {#if editError}
        <span class="text-xs text-red-300">{editError}</span>
      {/if}
    </div>
    <p class="mt-2 text-[10px] text-slate-500">
      Renames the character + overwrites ability scores. Class / species /
      subclass + level-up are managed elsewhere on the sheet.
    </p>
  </section>
{/if}


{#if document && derived}
  <!-- ===== Plan panel (top of page) =====
       Only surfaced when this character is a participant in a live
       encounter — outside of combat the slots don't mean anything, and the
       chooser would broadcast intent nobody is listening for. Same label
       as the encounter page's per-row Plan section so the two pages
       stay coherent. -->
  {#if data.liveEncounter}
    <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-slate-200">Plan</h2>
        <a
          class="rounded border border-emerald-700 bg-emerald-950/30 px-2 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-900/40"
          href={`/c/${data.campaign.code}/encounters/${data.liveEncounter.id}`}
        >
          ↗ {data.liveEncounter.name}
        </a>
      </div>
      <ActionEconomyPanel
        mode="self"
        {busy}
        actionChoices={actionChoices}
        bonusChoices={bonusChoices}
        plannedActionId={planActionId}
        plannedBonusActionId={planBonusActionId}
        {actionUsed}
        {bonusUsed}
        {reactionUsed}
        {walkSpeed}
        {movementUsed}
        concentrating={document.concentrating ?? null}
        participants={data.liveEncounter.participants}
        selfId={data.liveEncounter.selfParticipantId}
        plannedTargetIds={planTargetIds}
        plannedBonusTargetIds={planBonusTargetIds}
        on:actionPick={(e) => { planActionId = e.detail; planTargetIds = []; broadcastPlan(); }}
        on:bonusPick={(e) => { planBonusActionId = e.detail; planBonusTargetIds = []; broadcastPlan(); }}
        on:targetPick={(e) => { planTargetIds = e.detail; broadcastPlan(); }}
        on:bonusTargetPick={(e) => { planBonusTargetIds = e.detail; broadcastPlan(); }}
        on:toggleActionUsed={toggleAction}
        on:toggleBonusUsed={toggleBonusAction}
        on:toggleReactionUsed={toggleReaction}
        on:movementDelta={(e) => adjustMovement(e.detail)}
        on:movementReset={resetMovement}
        on:concentrationStart={(e) => { concDraft = e.detail; startConcentration(); }}
        on:concentrationEnd={endConcentration}
      />
    </section>
  {/if}

  <!-- ===== Stats / saves / skills / actions (read-only) ===== -->
  <Sheet derived={derived} />

  <!-- ===== Edit panel: HP / hit dice / conditions / toggles / rest ===== -->
  <section class="mb-6 grid gap-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4 md:grid-cols-2">
    <!-- HP -->
    <div>
      <div class="mb-2 flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-slate-200">HP</h2>
        <span class="flex flex-wrap items-center gap-1">
          {#each document.classes as cls}
            <button
              class="rounded border border-slate-700 px-1.5 py-0 text-[10px] text-slate-400 hover:border-emerald-600 hover:text-emerald-200 disabled:opacity-40"
              disabled={busy || cls.level >= 20}
              title="Bump {cls.slug} to L{cls.level + 1}"
              on:click={() => startLevelUp(cls.slug)}
            >
              ↑ {cls.slug} L{cls.level}
            </button>
          {/each}
        </span>
      </div>
      <div class="text-3xl font-semibold">
        {document.currentHp} / {derived.stats.hp.max}
        {#if document.tempHp > 0}
          <span class="ml-2 text-base text-emerald-300">+{document.tempHp} temp</span>
        {/if}
      </div>

      <div class="mt-3 flex items-center gap-2 text-sm">
        <input
          type="number"
          min="0"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono"
          bind:value={damageInput}
        />
        <button class="rounded bg-red-700/70 px-3 py-1 hover:bg-red-700" disabled={busy} on:click={applyDamage}>
          Damage
        </button>
        <input
          type="number"
          min="0"
          class="ml-3 w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono"
          bind:value={healInput}
        />
        <button class="rounded bg-emerald-700/70 px-3 py-1 hover:bg-emerald-700" disabled={busy} on:click={applyHeal}>
          Heal
        </button>
      </div>

      <div class="mt-3 flex items-center gap-2 text-sm">
        <span class="text-slate-400">Temp HP</span>
        <input
          type="number"
          min="0"
          class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono"
          bind:value={tempHpDraft}
        />
        <button class="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800" disabled={busy} on:click={setTempHp}>
          Set
        </button>
      </div>

      {#if document.currentHp === 0}
        {@const ds = document.deathSaves ?? { successes: 0, failures: 0 }}
        <div class="mt-3 rounded border border-slate-700 bg-slate-950/40 p-2 text-xs">
          <div class="mb-1 flex items-center gap-2">
            <span class="font-semibold text-slate-300">Death saves</span>
            {#if ds.successes >= 3}
              <span class="rounded bg-emerald-800/60 px-1.5 py-0.5 text-[10px] text-emerald-300">Stable</span>
            {:else if ds.failures >= 3}
              <span class="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">Dead</span>
            {/if}
          </div>
          <div class="flex gap-4">
            <div class="flex items-center gap-1">
              <span class="text-slate-400">Success</span>
              {#each [0, 1, 2] as i}
                <button
                  class="h-5 w-5 rounded border text-center text-[11px] {i < ds.successes ? 'border-emerald-500 bg-emerald-800/50 text-emerald-300' : 'border-slate-600 text-slate-600 hover:border-slate-400'}"
                  disabled={busy}
                  title={i < ds.successes ? 'Remove success' : 'Add success'}
                  on:click={() => adjustDeathSave('successes', i < ds.successes ? -1 : 1)}
                >✓</button>
              {/each}
            </div>
            <div class="flex items-center gap-1">
              <span class="text-slate-400">Failure</span>
              {#each [0, 1, 2] as i}
                <button
                  class="h-5 w-5 rounded border text-center text-[11px] {i < ds.failures ? 'border-red-500 bg-red-900/50 text-red-300' : 'border-slate-600 text-slate-600 hover:border-slate-400'}"
                  disabled={busy}
                  title={i < ds.failures ? 'Remove failure' : 'Add failure'}
                  on:click={() => adjustDeathSave('failures', i < ds.failures ? -1 : 1)}
                >✗</button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Rests (hit dice surfaces inline when short-resting) -->
    <div>
      <h2 class="mb-2 text-sm font-semibold text-slate-200">Rest</h2>
      <div class="flex gap-2">
        <button
          class="flex-1 rounded border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800"
          disabled={busy}
          on:click={shortRest}
        >
          {restingShort ? 'Short rest — pick hit dice ↓' : 'Short rest'}
        </button>
        <button
          class="flex-1 rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
          disabled={busy}
          on:click={longRest}
        >
          Long rest
        </button>
      </div>

      {#if restingShort}
        <div class="mt-3 rounded border border-slate-700 bg-slate-950/40 p-2">
          <div class="mb-1 flex items-baseline justify-between">
            <h3 class="text-xs font-semibold text-slate-300">Hit dice</h3>
            <button
              class="text-xs text-slate-500 hover:text-slate-300"
              on:click={() => (restingShort = false)}
            >
              done
            </button>
          </div>
          <ul class="space-y-1 text-sm">
            {#each document.classes as cls}
              {@const spent = document.hitDiceSpent[cls.slug] ?? 0}
              {@const remaining = cls.level - spent}
              <li class="flex items-center justify-between gap-2">
                <span>
                  <span class="font-mono">{remaining} / {cls.level}</span>
                  <span class="ml-2 capitalize text-slate-400">{cls.slug}</span>
                </span>
                <button
                  class="rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
                  disabled={busy || remaining === 0}
                  on:click={() => spendHitDie(cls.slug)}
                >
                  Spend 1
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if restNote}
        <p class="mt-2 text-xs text-slate-400">{restNote}</p>
      {/if}
    </div>
  </section>


  <!-- Conditions + toggles -->
  <section class="mb-6 grid gap-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4 md:grid-cols-2">
    <div>
      <h2 class="mb-2 text-sm font-semibold text-slate-200">Conditions</h2>
      <ul class="flex flex-wrap gap-2 text-sm">
        {#each COMMON_CONDITIONS as cond}
          {@const on = document.conditions.includes(cond)}
          {@const impliedBy = impliedConditions.get(cond)}
          {@const row = contentLookup({ kind: 'condition', slug: cond })}
          {@const cdata = conditionMeta(row)}
          {@const stackLevel = document.conditionStacks?.[cond] ?? 1}
          <li class="flex items-center gap-1">
            <label
              class="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs {on
                ? 'cursor-pointer border-emerald-600 bg-emerald-900/30 text-emerald-200'
                : impliedBy
                  ? 'cursor-default border-slate-600 bg-slate-800/40 text-slate-500 italic'
                  : 'cursor-pointer border-slate-700 text-slate-400 hover:text-slate-200'}"
              title={impliedBy ? `implied by ${impliedBy}` : undefined}
            >
              <input
                type="checkbox"
                class="hidden"
                checked={on}
                on:change={(e) => toggleCondition(cond, checkboxChecked(e))}
                disabled={busy || !!impliedBy}
              />
              <HoverPopup>
                <span class="capitalize">{cond}</span>
                <svelte:fragment slot="popup">
                  <div class="mb-1 font-semibold capitalize text-slate-200">{row?.name ?? cond}</div>
                  {#if impliedBy}
                    <p class="mb-1 text-xs text-amber-400">Implied by <span class="capitalize">{impliedBy}</span></p>
                  {/if}
                  {#if cdata.description}
                    <p class="whitespace-pre-wrap text-slate-300">{cdata.description}</p>
                  {/if}
                  {#if cdata.note}
                    <p class="whitespace-pre-wrap text-slate-300">{cdata.note}</p>
                  {/if}
                  {#if cdata.modifiers && cdata.modifiers.length > 0}
                    <ul class="mt-2 list-disc space-y-0.5 border-t border-slate-800 pt-2 pl-4 text-[11px] text-slate-400">
                      {#each cdata.modifiers as m}
                        <li><span class="font-mono text-slate-500">{m.target}</span> <span class="text-slate-600">{m.mode}</span> {String(m.value)}</li>
                      {/each}
                    </ul>
                  {/if}
                  {#if !row}
                    <p class="text-slate-500">No pack data for this condition.</p>
                  {/if}
                </svelte:fragment>
              </HoverPopup>
            </label>
            {#if on && cond === 'exhaustion'}
              <input
                type="number"
                min="1"
                max="10"
                value={stackLevel}
                class="w-12 rounded border border-emerald-700 bg-slate-950 px-1 py-0.5 text-xs text-emerald-200"
                title="Exhaustion level (1–10)"
                aria-label="Exhaustion level"
                on:change={(e) => { const el = e.currentTarget; setConditionStack('exhaustion', parseInt(el.value, 10)); }}
                disabled={busy}
              />
            {/if}
          </li>
        {/each}
      </ul>
    </div>

    <div>
      <h2 class="mb-2 text-sm font-semibold text-slate-200">Toggles</h2>
      {#if derived.toggles.length === 0}
        <p class="text-xs text-slate-500">No user-toggleable modifiers on this character.</p>
      {:else}
        <ul class="space-y-1 text-sm">
          {#each derived.toggles as t}
            <li class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={t.currentlyEnabled}
                on:change={(e) => toggleModifier(t.id, checkboxChecked(e))}
                disabled={busy}
              />
              <span>{t.name}</span>
              <span class="text-xs text-slate-500">({t.sourceContent.kind}/{t.sourceContent.slug})</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  {#if derived.availableActivations.length > 0}
    <ActivationsPanel
      activations={derived.availableActivations}
      {busy}
      concentratingLabel={document.concentrating?.label ?? null}
      on:toggle={handleActivationToggle}
      on:restPick={handleActivationRestPick}
    />
  {/if}

  {#if derived.resources.length > 0}
    <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
      <h2 class="mb-2 text-sm font-semibold text-slate-200">Resources</h2>
      <ul class="space-y-1 text-sm">
        {#each derived.resources as r}
          {@const remaining = r.max - r.used}
          <li class="flex items-center justify-between gap-2 rounded border border-slate-700 px-2 py-1" title={r.description ?? r.name}>
            <span>
              <span class="font-semibold">{r.name}</span>
              <span class="ml-1 font-mono text-xs">{remaining} / {r.max}</span>
              <span class="ml-1 text-xs text-slate-500">/{r.per}</span>
            </span>
            <span class="flex items-center gap-1">
              <button
                class="rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
                disabled={busy || remaining === 0}
                title="Use one"
                on:click={() => adjustResource(r.id, 1, r.max)}
              >
                Use
              </button>
              <button
                class="rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
                disabled={busy || r.used === 0}
                title="Restore one"
                on:click={() => adjustResource(r.id, -1, r.max)}
              >
                +1
              </button>
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- Spellcasting: header + slots -->
  {@const slotLevels = Object.keys(derived.stats.spellSlots).map(Number).sort((a, b) => a - b)}
  {#if slotLevels.length > 0}
    <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
      <h2 class="mb-2 text-sm font-semibold text-slate-200">Spellcasting</h2>
      {#if derived.stats.spellcastingAbility}
        <div class="mb-3 flex items-center justify-between gap-2">
          <div>
            <p class="text-sm font-semibold text-slate-200">
              {preparedCount} prepared · {document.spells.known.length} known
            </p>
            <p class="text-xs text-slate-500">
              {derived.stats.spellcastingAbility.toUpperCase()} · {(derived.stats.spellAttackBonus ?? 0) >= 0 ? '+' : ''}{derived.stats.spellAttackBonus ?? 0} atk · DC {derived.stats.spellSaveDC ?? 0}
            </p>
          </div>
          <button
            class="rounded border border-emerald-700 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/40"
            on:click={() => (spellManagerOpen = true)}
          >
            Manage spells ▸
          </button>
        </div>
        <hr class="mb-3 border-slate-700" />
      {/if}
      <div>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Spell slots</h3>
        <ul class="space-y-1 text-sm">
          {#each slotLevels as lvl}
            {@const slot = derived.stats.spellSlots[lvl]}
            {@const remaining = slot.max - slot.used}
            <li class="flex items-center justify-between gap-2 rounded border border-slate-700 px-2 py-1">
              <span class="text-xs">
                Level {lvl} <span class="ml-1 font-mono">{remaining} / {slot.max}</span>
              </span>
              <span class="flex items-center gap-1">
                <button
                  class="rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
                  disabled={busy || remaining === 0}
                  title="Cast — consume one slot"
                  on:click={() => spendSlot(lvl)}
                >
                  Use
                </button>
                <button
                  class="rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-40"
                  disabled={busy || slot.used === 0}
                  title="Restore one slot"
                  on:click={() => restoreSlot(lvl)}
                >
                  +1
                </button>
              </span>
            </li>
          {/each}
        </ul>
      </div>
    </section>
  {/if}

  <ReceivedBuffsPanel
    buffs={document.receivedBuffs ?? []}
    spellOptions={data.spellOptions}
    {busy}
    on:add={handleAddReceivedBuff}
    on:remove={handleRemoveReceivedBuff}
    on:update={handleUpdateReceivedBuff}
  />

  <!-- Retroactive subclass pickers for any L3+ class missing one -->
  {#each document.classes.filter((c) => c.level >= 3 && !c.subclass) as cls (cls.slug)}
    {@const opts = data.subclassOptions.filter((s) => s.parentClass === cls.slug)}
    <section class="mb-6 rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm">
      <h2 class="mb-2 text-sm font-semibold text-amber-200">
        {cls.slug} L{cls.level} has no subclass
      </h2>
      {#if opts.length === 0}
        <p class="text-amber-100">
          No subclasses loaded for <span class="capitalize">{cls.slug}</span>. Add one to
          <code>$GRIMOIRE_PACKS_DIR</code> or the SRD pack and reload.
        </p>
      {:else}
        <div class="flex gap-2">
          <select
            class="flex-1 rounded border border-amber-700 bg-slate-950 px-2 py-1"
            bind:value={subclassFillSlug[cls.slug]}
          >
            <option value="">— pick subclass —</option>
            {#each opts as opt}
              <option value={opt.slug}>{opt.name} <span class="text-slate-500">({opt.source})</span></option>
            {/each}
          </select>
          <button
            class="rounded bg-amber-700 px-3 py-1 hover:bg-amber-600 disabled:opacity-40"
            disabled={busy || !subclassFillSlug[cls.slug]}
            on:click={() => setSubclassFor(cls.slug)}
          >
            Set
          </button>
        </div>
      {/if}
    </section>
  {/each}

  <!-- Retroactive background picker: surfaces if no background is set yet. -->
  {#if !document.background}
    <section class="mb-6 rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm">
      <h2 class="mb-2 text-sm font-semibold text-amber-200">No background set</h2>
      <p class="mb-3 text-xs text-amber-100">
        Pick a background and apply its ability bumps. 2024 PHB grants +2/+1 or +1/+1/+1 across the background's three allowed abilities.
      </p>

      <div class="flex gap-2 mb-3">
        <select
          class="flex-1 rounded border border-amber-700 bg-slate-950 px-2 py-1"
          value={bgDraftSlug}
          on:change={selectBgDraft}
        >
          <option value="">— pick background —</option>
          {#each data.backgroundOptions as opt}
            <option value={opt.slug}>{opt.name}</option>
          {/each}
        </select>
      </div>

      {#if bgDraftMeta}
        <fieldset class="rounded border border-amber-800 bg-slate-950/30 p-3 mb-3">
          <legend class="px-1 text-xs uppercase tracking-wide text-amber-300">
            Bumps ({bgDraftMeta.abilityChoices.length > 0 ? bgDraftMeta.abilityChoices.map((a) => a.toUpperCase()).join(' / ') : 'any ability'})
          </legend>
          <div class="mb-2 flex gap-4 text-xs">
            <label class="flex items-center gap-1">
              <input
                type="radio"
                name="bg-draft-mode"
                checked={bgDraftMode === 'two-one'}
                on:change={() => selectBgMode('two-one')}
              />
              <span>+2 / +1</span>
            </label>
            <label class="flex items-center gap-1">
              <input
                type="radio"
                name="bg-draft-mode"
                checked={bgDraftMode === 'three-ones'}
                on:change={() => selectBgMode('three-ones')}
              />
              <span>+1 / +1 / +1</span>
            </label>
          </div>
          <div class="grid grid-cols-3 gap-2">
            {#each bgDraftBumps as bump, i}
              <label class="text-xs">
                <span class="block text-amber-300">+{bump.bonus} to</span>
                <select
                  class="w-full rounded border border-amber-700 bg-slate-950 px-2 py-1 uppercase"
                  bind:value={bgDraftBumps[i].ability}
                >
                  {#each (bgDraftMeta.abilityChoices.length > 0 ? bgDraftMeta.abilityChoices : ABILITY_KEYS) as a}
                    <option value={a}>{a.toUpperCase()}</option>
                  {/each}
                </select>
              </label>
            {/each}
          </div>
        </fieldset>

        <button
          class="rounded bg-amber-700 px-3 py-1 text-sm hover:bg-amber-600 disabled:opacity-40"
          disabled={busy}
          on:click={applyBackground}
        >
          Apply background
        </button>
      {/if}
    </section>
  {/if}

  <!-- Level-up draft (only when active; trigger icons live in the compact
       row up top). -->
  {#if levelingUp}
    {@const draft = levelingUp}
    <section class="mb-6 rounded-lg border border-emerald-800 bg-emerald-950/20 p-4">
      <h2 class="mb-3 text-sm font-semibold text-emerald-200">
        Leveling up: <span class="capitalize">{draft.classSlug}</span>
        → <span class="font-mono">L{draft.newLevel}</span>
      </h2>
      <div class="space-y-3 text-sm">
        {#if draft.needsSubclass}
          <label class="block">
            <span class="mb-1 block text-xs uppercase tracking-wide text-slate-500">Subclass</span>
            {#if subclassOptionsForLevelup.length === 0}
              <p class="text-xs text-amber-200">
                No subclasses loaded for {draft.classSlug}. Add one to
                <code>$GRIMOIRE_PACKS_DIR</code> or the SRD pack and reload.
              </p>
            {:else}
              <select
                class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"
                bind:value={levelingUp.subclassSlug}
              >
                {#each subclassOptionsForLevelup as opt}
                  <option value={opt.slug}>{opt.name} <span class="text-slate-500">({opt.source})</span></option>
                {/each}
              </select>
            {/if}
          </label>
        {/if}

        {#if draft.needsAsi}
          <fieldset class="rounded border border-slate-700 p-3">
            <legend class="px-1 text-xs uppercase tracking-wide text-slate-500">
              ASI / Feat (ASI for now; feats land later)
            </legend>
            <div class="mb-2 flex gap-4">
              <label class="flex items-center gap-1">
                <input type="radio" bind:group={levelingUp.asiMode} value="two-one" />
                <span>+2 / +1</span>
              </label>
              <label class="flex items-center gap-1">
                <input type="radio" bind:group={levelingUp.asiMode} value="three-ones" />
                <span>+1 / +1 / +1</span>
              </label>
            </div>
            <div class="grid grid-cols-3 gap-2">
              {#each levelingUp.asiBumps as bump, i}
                <label class="text-xs">
                  <span class="block text-slate-500">+{bump.bonus} to</span>
                  <select
                    class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 uppercase"
                    bind:value={levelingUp.asiBumps[i].ability}
                  >
                    {#each ABILITY_KEYS as ab}
                      <option value={ab}>{ab.toUpperCase()}</option>
                    {/each}
                  </select>
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}

        <div class="flex gap-2">
          <button
            class="rounded bg-emerald-700 px-3 py-1 hover:bg-emerald-600 disabled:opacity-50"
            disabled={busy}
            on:click={confirmLevelUp}
          >
            Confirm
          </button>
          <button class="rounded border border-slate-600 px-3 py-1 hover:bg-slate-800" disabled={busy} on:click={cancelLevelUp}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  {/if}

  <!-- Feats -->
  <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <div class="mb-3 flex items-baseline justify-between">
      <h2 class="text-sm font-semibold text-slate-200">
        Feats
        <span class="ml-1 text-xs text-slate-500">
          {document.feats.length} / {maxFeats} expected
          {#if document.feats.length > maxFeats}
            <span class="text-amber-300">· over budget — DM check</span>
          {:else if document.feats.length < maxFeats}
            <span class="text-slate-600">· {maxFeats - document.feats.length} slot(s) free</span>
          {/if}
        </span>
      </h2>
      <button
        class="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800"
        on:click={() => (showFeatPicker = !showFeatPicker)}
      >
        {showFeatPicker ? '− cancel' : '+ add feat'}
      </button>
    </div>

    {#if document.feats.length === 0 && !showFeatPicker}
      <p class="text-xs text-slate-500">
        No feats yet. 5e gives 1 at L1 (origin feat from background) plus 1 at
        each ASI level you choose feat over the +2/+1 bump.
      </p>
    {:else if document.feats.length > 0}
      <ul class="mb-3 divide-y divide-slate-800 rounded border border-slate-800">
        {#each document.feats as f (`${f.slug}|${f.authorUserId ?? ''}`)}
          {@const meta = featMeta(f.slug, f.authorUserId)}
          {@const expandedKey = `feat-expand-${f.slug}-${f.authorUserId ?? ''}`}
          <li class="text-xs">
            <div class="flex items-center gap-2 px-2 py-1">
              <button
                class="flex-1 text-left text-slate-200 hover:text-slate-100"
                title={meta?.description ? 'Click to expand mechanic; hover for quick view' : ''}
                on:click={() => {
                  const el = globalThis.document.getElementById(expandedKey);
                  if (el) el.hidden = !el.hidden;
                }}
              >
                <HoverPopup>
                  <span>
                    {meta?.name ?? f.slug}
                    {#if !meta}
                      <span class="ml-1 rounded border border-amber-800/60 bg-amber-950/40 px-1 text-[9px] uppercase tracking-wide text-amber-300">missing</span>
                    {:else if meta.isSubscribed}
                      <span class="ml-1 rounded border border-sky-800/60 bg-sky-950/40 px-1 text-[9px] uppercase tracking-wide text-sky-300">subscribed</span>
                    {:else if meta.isHomebrew}
                      <span class="ml-1 rounded border border-indigo-800/60 bg-indigo-950/40 px-1 text-[9px] uppercase tracking-wide text-indigo-300">homebrew</span>
                    {/if}
                    {#if meta?.category}<span class="ml-1 text-slate-600">· {meta.category}</span>{/if}
                    {#if describeFeatChoices(f.slug)}
                      <span class="ml-1 text-[10px] text-emerald-300/80">{describeFeatChoices(f.slug)}</span>
                    {/if}
                    {#if meta?.source}<span class="ml-1 text-[10px] text-slate-600">({meta.source})</span>{/if}
                    {#if meta?.description}
                      <span class="ml-1 text-[10px] text-slate-600">▾</span>
                    {/if}
                  </span>
                  <svelte:fragment slot="popup">
                    <div class="mb-1 font-semibold text-slate-200">{meta?.name ?? f.slug}</div>
                    {#if meta?.category}<div class="text-slate-400">{meta.category}</div>{/if}
                    {#if meta?.prerequisite}
                      <div><span class="text-slate-500">Prerequisite:</span> {meta.prerequisite}</div>
                    {/if}
                    {#if describeFeatChoices(f.slug)}
                      <div class="text-emerald-300/80">{describeFeatChoices(f.slug)}</div>
                    {/if}
                    {#if meta?.description}
                      <p class="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-slate-800 pt-2 text-slate-300">{meta.description}</p>
                    {/if}
                    <div class="mt-1 text-[10px] text-slate-600">{meta?.source ?? ''}</div>
                  </svelte:fragment>
                </HoverPopup>
              </button>
              {#if meta?.asiBudget != null}
                {@const asiKey = `${f.slug}|${f.authorUserId ?? ''}`}
                {@const asiBudgetEdit = meta.asiBudget ?? 2}
                <button
                  class="text-[10px] text-slate-400 hover:text-indigo-300"
                  disabled={busy}
                  title="Configure ability bumps"
                  on:click={() => openAsiEdit(f, asiBudgetEdit)}
                >
                  {editingAsiKey === asiKey ? '▴' : '▾'}
                </button>
              {/if}
              <button
                class="text-[10px] text-slate-500 hover:text-red-400"
                disabled={busy}
                title="Remove feat"
                on:click={() => removeFeat(f.slug, f.authorUserId)}
              >
                ×
              </button>
            </div>

            {#if meta?.asiBudget != null && editingAsiKey === `${f.slug}|${f.authorUserId ?? ''}`}
              {@const asiBudget = meta.asiBudget}
              {@const asiAllowed = meta.abilityChoices?.length ? meta.abilityChoices : ABILITY_KEYS}
              <div class="border-t border-slate-800/60 bg-slate-950/40 px-3 py-2">
                <div class="mb-2 flex gap-4 text-[11px]">
                  <label class="flex items-center gap-1">
                    <input
                      type="radio"
                      bind:group={editAsiMode}
                      value="one"
                      on:change={() => { editAsiSelections = [editAsiSelections[0] ?? '']; }}
                    />
                    +{asiBudget} to one ability
                  </label>
                  {#if asiBudget >= 2}
                    <label class="flex items-center gap-1">
                      <input
                        type="radio"
                        bind:group={editAsiMode}
                        value="split"
                        on:change={() => {
                          editAsiSelections = Array.from({ length: asiBudget }, (_, i) => editAsiSelections[i] ?? '');
                        }}
                      />
                      +1 to {asiBudget} abilities
                    </label>
                  {/if}
                </div>
                <div class="flex flex-wrap gap-2">
                  {#each editAsiSelections as _, i}
                    <select
                      class="rounded border border-slate-700 bg-slate-950 px-2 py-1 uppercase text-xs"
                      bind:value={editAsiSelections[i]}
                    >
                      <option value="">—</option>
                      {#each asiAllowed as ab}
                        <option value={ab}>{ab.toUpperCase()}</option>
                      {/each}
                    </select>
                  {/each}
                </div>
                <div class="mt-2 flex gap-2">
                  <button
                    class="rounded bg-indigo-700 px-3 py-1 text-[11px] hover:bg-indigo-600 disabled:opacity-40"
                    disabled={busy || (() => {
                      const filled = editAsiSelections.filter(Boolean);
                      const required = editAsiMode === 'one' ? 1 : asiBudget;
                      return filled.length < required || new Set(filled).size < required;
                    })()}
                    on:click={() => saveAsiChoices(f, asiBudget)}
                  >
                    Save
                  </button>
                  <button
                    class="rounded border border-slate-600 px-3 py-1 text-[11px] hover:bg-slate-800"
                    on:click={() => (editingAsiKey = null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            {/if}

            {#if meta?.description}
              <div id={expandedKey} hidden class="border-t border-slate-800/60 bg-slate-950/40 px-3 py-2">
                {#if meta.prerequisite}
                  <p class="mb-1 text-[10px] text-amber-400/80">Prerequisite: {meta.prerequisite}</p>
                {/if}
                <p class="text-[11px] leading-relaxed text-slate-400">{meta.description}</p>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if showFeatPicker}
      <div class="border-t border-slate-800 pt-3 text-xs">
        <div class="flex gap-2">
          <select
            class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1"
            bind:value={featPickerKey}
          >
            <option value="">— pick a feat —</option>
            {#each data.featOptions as opt}
              {@const taken = document.feats.some(
                (f) => f.slug === opt.slug && (f.authorUserId ?? null) === opt.authorUserId
              )}
              <option value={opt.pickerId} disabled={taken}>
                {opt.name}{#if opt.category} ({opt.category}){/if} — {opt.source}{#if opt.isSubscribed} · subscribed{:else if opt.isHomebrew} · homebrew{/if}{#if taken} · already taken{/if}
              </option>
            {/each}
          </select>
          <button
            class="rounded bg-emerald-600 px-3 py-1 text-xs hover:bg-emerald-500 disabled:opacity-40"
            disabled={busy ||
              !featPickerKey ||
              (() => {
                const opt = featByPickerId(featPickerKey);
                return opt
                  ? document.feats.some(
                      (f) => f.slug === opt.slug && (f.authorUserId ?? null) === opt.authorUserId
                    )
                  : true;
              })() ||
              (!!pickedFeatChoices?.asi && !featDraftAbility) ||
              (!!pickedFeatChoices?.skillProficiency && !featDraftSkillProf) ||
              (!!pickedFeatChoices?.expertise && !featDraftExpertise) ||
              (!!pickedFeatChoices?.savingThrow && !featDraftSave) ||
              (!!pickedFeatChoices?.language && !featDraftLanguage) ||
              (!!pickedFeatChoices?.toolProficiency && !featDraftTool) ||
              !featFeatureReady ||
              (!!pickedFeatChoices?.spell &&
                pickedFeatChoices.spell.picks != null &&
                featDraftSpells.length !== pickedFeatChoices.spell.picks) ||
              (() => {
                const opt = featByPickerId(featPickerKey);
                if (!opt?.asiBudget) return false;
                const required = featDraftAsiMode === 'one' ? 1 : opt.asiBudget;
                const filled = featDraftAsiSelections.filter(Boolean);
                return filled.length < required || new Set(filled).size < required;
              })()}
            on:click={addFeat}
          >
            Add
          </button>
        </div>

        {#if featByPickerId(featPickerKey)?.asiBudget != null}
          {@const asiOpt = featByPickerId(featPickerKey)}
          {@const asiBudget = asiOpt?.asiBudget ?? 2}
          {@const asiAllowed = asiOpt?.abilityChoices?.length ? asiOpt.abilityChoices : ABILITY_KEYS}
          <div class="mt-2 rounded border border-indigo-900/40 bg-slate-950/40 p-2">
            <p class="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
              Ability Score Improvement (+{asiBudget} total)
            </p>
            <div class="mb-2 flex gap-4 text-xs">
              <label class="flex items-center gap-1">
                <input
                  type="radio"
                  bind:group={featDraftAsiMode}
                  value="one"
                  on:change={() => { featDraftAsiSelections = ['']; }}
                />
                +{asiBudget} to one ability
              </label>
              {#if asiBudget >= 2}
                <label class="flex items-center gap-1">
                  <input
                    type="radio"
                    bind:group={featDraftAsiMode}
                    value="split"
                    on:change={() => { featDraftAsiSelections = Array.from({ length: asiBudget }, () => ''); }}
                  />
                  +1 to {asiBudget} abilities
                </label>
              {/if}
            </div>
            <div class="flex flex-wrap gap-2">
              {#each featDraftAsiSelections as _, i}
                <select
                  class="rounded border border-slate-700 bg-slate-950 px-2 py-1 uppercase"
                  bind:value={featDraftAsiSelections[i]}
                >
                  <option value="">—</option>
                  {#each asiAllowed as ab}
                    <option value={ab}>{ab.toUpperCase()}</option>
                  {/each}
                </select>
              {/each}
            </div>
          </div>
        {/if}

        {#if pickedFeatChoices}
          <div class="mt-2 rounded border border-indigo-900/40 bg-slate-950/40 p-2">
            <p class="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
              This feat wants you to pick:
            </p>
            <div class="flex flex-wrap items-end gap-2">
              {#if pickedFeatChoices.asi}
                <label class="text-xs">
                  <span class="block text-slate-400">
                    +{pickedFeatChoices.asi.bonus ?? 1} to ability
                  </span>
                  <select
                    class="rounded border border-slate-700 bg-slate-950 px-2 py-1 uppercase"
                    bind:value={featDraftAbility}
                  >
                    <option value="">—</option>
                    {#each pickedFeatChoices.asi.allowedAbilities ?? ['str', 'dex', 'con', 'int', 'wis', 'cha'] as ab}
                      <option value={ab}>{ab.toUpperCase()}</option>
                    {/each}
                  </select>
                </label>
              {/if}
              {#if pickedFeatChoices.skillProficiency}
                <label class="text-xs">
                  <span class="block text-slate-400">Skill proficiency</span>
                  <select
                    class="rounded border border-slate-700 bg-slate-950 px-2 py-1 capitalize"
                    bind:value={featDraftSkillProf}
                  >
                    <option value="">—</option>
                    {#each (pickedFeatChoices.skillProficiency.allowedSkills ?? SKILLS) as s}
                      <option value={s}>
                        {s}{#if derived?.stats.skills[s]?.proficient} (already proficient){/if}
                      </option>
                    {/each}
                  </select>
                </label>
              {/if}
              {#if pickedFeatChoices.expertise}
                <label class="text-xs">
                  <span class="block text-slate-400">Expertise</span>
                  <select
                    class="rounded border border-slate-700 bg-slate-950 px-2 py-1 capitalize"
                    bind:value={featDraftExpertise}
                  >
                    <option value="">—</option>
                    {#each (pickedFeatChoices.expertise.allowedSkills === 'proficient'
                      ? proficientSkills
                      : pickedFeatChoices.expertise.allowedSkills ?? SKILLS) as s}
                      <option value={s}>{s}</option>
                    {/each}
                  </select>
                </label>
              {/if}
              {#if pickedFeatChoices.savingThrow}
                <label class="text-xs">
                  <span class="block text-slate-400">Save proficiency</span>
                  <select
                    class="rounded border border-slate-700 bg-slate-950 px-2 py-1 uppercase"
                    bind:value={featDraftSave}
                  >
                    <option value="">—</option>
                    {#each pickedFeatChoices.savingThrow.allowedAbilities ?? ['str', 'dex', 'con', 'int', 'wis', 'cha'] as ab}
                      <option value={ab}>{ab.toUpperCase()}</option>
                    {/each}
                  </select>
                </label>
              {/if}
              {#if pickedFeatChoices.language}
                <label class="text-xs">
                  <span class="block text-slate-400">Language</span>
                  {#if pickedFeatChoices.language.allowedLanguages}
                    <select
                      class="rounded border border-slate-700 bg-slate-950 px-2 py-1 capitalize"
                      bind:value={featDraftLanguage}
                    >
                      <option value="">—</option>
                      {#each pickedFeatChoices.language.allowedLanguages as lang}
                        <option value={lang}>{lang}</option>
                      {/each}
                    </select>
                  {:else}
                    <input
                      class="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                      placeholder="e.g. draconic"
                      bind:value={featDraftLanguage}
                    />
                  {/if}
                </label>
              {/if}
              {#if pickedFeatChoices.toolProficiency}
                <label class="text-xs">
                  <span class="block text-slate-400">Tool proficiency</span>
                  {#if pickedFeatChoices.toolProficiency.allowedTools}
                    <select
                      class="rounded border border-slate-700 bg-slate-950 px-2 py-1 capitalize"
                      bind:value={featDraftTool}
                    >
                      <option value="">—</option>
                      {#each pickedFeatChoices.toolProficiency.allowedTools as tool}
                        <option value={tool}>{tool}</option>
                      {/each}
                    </select>
                  {:else}
                    <input
                      class="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                      placeholder="e.g. thieves-tools"
                      bind:value={featDraftTool}
                    />
                  {/if}
                </label>
              {/if}
              {#if pickedFeatChoices.feature}
                <div class="text-xs">
                  <span class="block text-slate-400 mb-1">
                    {featFeatureCategory}{#if featFeaturePickCount > 1} — pick {featFeaturePickCount}{/if}
                  </span>
                  {#if featFeaturePickCount > 1}
                    <ul class="grid grid-cols-2 gap-1">
                      {#each featFeatureAllowed as fslug}
                        {@const checked = featDraftFeatures.includes(fslug)}
                        {@const atCap = featDraftFeatures.length >= featFeaturePickCount && !checked}
                        <li>
                          <label class="flex items-center gap-1">
                            <input
                              type="checkbox"
                              {checked}
                              disabled={atCap}
                              on:change={(e) => {
                                if (checkboxChecked(e)) {
                                  if (!featDraftFeatures.includes(fslug)) featDraftFeatures = [...featDraftFeatures, fslug];
                                } else {
                                  featDraftFeatures = featDraftFeatures.filter((s) => s !== fslug);
                                }
                              }}
                            />
                            <span class={atCap ? 'text-slate-600' : 'text-slate-300'}>{fslug}</span>
                          </label>
                        </li>
                      {/each}
                    </ul>
                  {:else}
                    <select
                      class="rounded border border-slate-700 bg-slate-950 px-2 py-1"
                      bind:value={featDraftFeature}
                    >
                      <option value="">—</option>
                      {#each featFeatureAllowed as fslug}
                        <option value={fslug}>{fslug}</option>
                      {/each}
                    </select>
                  {/if}
                </div>
              {/if}
            </div>
            {#if pickedFeatChoices.spell}
              <div class="mt-2 border-t border-slate-800 pt-2">
                <span class="text-[10px] uppercase tracking-wide text-slate-500">
                  Spells{#if pickedFeatChoices.spell.picks} — pick {pickedFeatChoices.spell.picks}{/if}
                </span>
                {#if pickedFeatChoices.spell.allowedSpells && pickedFeatChoices.spell.allowedSpells.length > 0}
                  <ul class="mt-1 grid grid-cols-2 gap-1">
                    {#each pickedFeatChoices.spell.allowedSpells as slug}
                      {@const checked = featDraftSpells.includes(slug)}
                      {@const max = pickedFeatChoices.spell.picks}
                      {@const atCap = max != null && featDraftSpells.length >= max && !checked}
                      <li>
                        <label class="flex items-center gap-1">
                          <input
                            type="checkbox"
                            {checked}
                            disabled={atCap}
                            on:change={(e) => {
                              if (checkboxChecked(e)) {
                                if (!featDraftSpells.includes(slug)) featDraftSpells = [...featDraftSpells, slug];
                              } else {
                                featDraftSpells = featDraftSpells.filter((s) => s !== slug);
                              }
                            }}
                          />
                          <span class={atCap ? 'text-slate-600' : 'text-slate-300'}>{slug}</span>
                        </label>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="mt-1 text-[10px] text-amber-300">
                    Feat doesn't list allowed spells — pack file needs `allowedSpells: [...]`.
                  </p>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </section>

  <!-- Feature Choices -->
  {#if derived && derived.pendingFeatureChoices && derived.pendingFeatureChoices.length > 0}
    {@const unresolvedCount = derived.pendingFeatureChoices.filter((p) => p.unresolved).length}
    <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
      <div class="mb-3 flex items-baseline justify-between">
        <h2 class="text-sm font-semibold text-slate-200">
          Feature Choices
          {#if unresolvedCount > 0}
            <span class="ml-1 rounded border border-amber-800/60 bg-amber-950/40 px-1 text-[9px] uppercase tracking-wide text-amber-300">
              {unresolvedCount} unresolved
            </span>
          {/if}
        </h2>
      </div>
      <FeatureChoicesPanel
        pendingChoices={derived.pendingFeatureChoices}
        stats={derived.stats}
        {busy}
        on:pick={onFeaturePick}
      />
    </section>
  {/if}

  <!-- Inventory -->
  <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-sm font-semibold text-slate-200">Inventory</h2>

    {#if document.inventory.length > 0}
      <ul class="mb-3 divide-y divide-slate-800">
        {#each document.inventory as slot, i}
          {@const meta = itemMeta(slot.contentSlug)}
          <li class="flex items-center justify-between gap-3 py-2 text-sm">
            <div class="flex-1">
              <HoverPopup>
                <span class="font-medium">{meta?.name ?? slot.contentSlug}</span>
                <svelte:fragment slot="popup">
                  <div class="mb-1 font-semibold text-slate-200">{meta?.name ?? slot.contentSlug}</div>
                  <div class="text-slate-400">
                    {meta?.category ?? 'item'}
                    {#if meta?.weaponType} · {meta.weaponType}{/if}
                    {#if meta?.armorType} · {meta.armorType}{/if}
                    {#if meta?.rarity} · {meta.rarity}{/if}
                  </div>
                  {#if meta?.damage && meta.damage.length > 0}
                    <div>
                      <span class="text-slate-500">Damage:</span>
                      {meta.damage.map((d) => `${d.dice} ${d.type}`).join(' + ')}
                    </div>
                  {/if}
                  {#if meta?.ac != null}
                    <div>
                      <span class="text-slate-500">AC:</span>
                      {typeof meta.ac === 'number' ? meta.ac : meta.ac.value ?? '?'}
                      {#if typeof meta.ac !== 'number' && meta.ac.calc} ({meta.ac.calc}){/if}
                    </div>
                  {/if}
                  {#if meta?.range && (meta.range.value != null || meta.range.long != null)}
                    <div>
                      <span class="text-slate-500">Range:</span>
                      {meta.range.value ?? '?'}{#if meta.range.long}/{meta.range.long}{/if}
                      {#if meta.range.units} {meta.range.units}{/if}
                    </div>
                  {/if}
                  {#if meta?.properties && meta.properties.length > 0}
                    <div><span class="text-slate-500">Properties:</span> {meta.properties.join(', ')}</div>
                  {/if}
                  {#if meta?.charges && meta.charges.max != null}
                    <div>
                      <span class="text-slate-500">Charges:</span>
                      {meta.charges.max}{#if meta.charges.per} / {meta.charges.per}{/if}
                    </div>
                  {/if}
                  {#if meta?.weight != null}
                    <div><span class="text-slate-500">Weight:</span> {meta.weight} lb</div>
                  {/if}
                  {#if meta?.cost}
                    <div>
                      <span class="text-slate-500">Cost:</span>
                      {#if typeof meta.cost === 'string'}
                        {meta.cost}
                      {:else if typeof meta.cost === 'number'}
                        {meta.cost} gp
                      {:else if meta.cost.value != null}
                        {meta.cost.value}{#if meta.cost.unit} {meta.cost.unit}{:else} gp{/if}
                      {/if}
                    </div>
                  {/if}
                  {#if meta?.requiresAttunement}
                    <div class="text-amber-300">Requires attunement</div>
                  {/if}
                  {#if meta?.description}
                    <p class="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-slate-800 pt-2 text-slate-300">{meta.description}</p>
                  {/if}
                  <div class="mt-1 text-[10px] text-slate-600">{meta?.source ?? ''}</div>
                </svelte:fragment>
              </HoverPopup>
              {#if meta?.kindHint}
                <span class="ml-2 text-xs text-slate-500">{meta.kindHint}</span>
              {/if}
            </div>
            <label class="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={slot.equipped}
                disabled={busy}
                on:change={(e) => setInventoryFlag(i, 'equipped', checkboxChecked(e))}
              />
              equipped
            </label>
            {#if meta?.requiresAttunement}
            <label class="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={slot.attuned}
                disabled={busy}
                on:change={(e) => setInventoryFlag(i, 'attuned', checkboxChecked(e))}
              />
              attuned
            </label>
            {/if}
            <button
              class="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:border-red-700 hover:bg-red-950/30 hover:text-red-300 disabled:opacity-40"
              disabled={busy}
              title="Remove from inventory"
              on:click={() => removeInventoryItem(i)}
            >
              remove
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <button
      class="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
      disabled={busy}
      on:click={() => (showInventoryPicker = true)}
    >
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
      </svg>
      Add item…
    </button>
  </section>

  {#if showInventoryPicker}
    <InventoryPicker
      items={data.itemOptions}
      disabled={busy}
      on:pick={onPickerPick}
    />
  {/if}

  <SpellManagerModal
    bind:open={spellManagerOpen}
    {document}
    {derived}
    spellOptions={data.spellOptions}
    {busy}
    onAddSpell={(pickerId) => addSpell(pickerId)}
    onRemoveSpell={(slug, authorUserId) => removeSpell(slug, authorUserId)}
    onTogglePrepared={(slug, prepared) => togglePrepared(slug, prepared)}
    onClose={() => (spellManagerOpen = false)}
  />

{:else}
  <section class="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm">
    <h2 class="text-base font-semibold text-amber-200">Set up this character</h2>
    <p class="mt-2 text-amber-100">This character has no sheet yet.</p>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button
        class="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
        disabled={initBusy}
        on:click={quickInit}
      >
        {initBusy ? '…' : 'Start with a blank sheet'}
      </button>
    </div>
    <p class="mt-3 text-xs text-amber-300/70">
      Creates a level&nbsp;1 fighter (human, all scores&nbsp;10, 10&nbsp;HP). You can change everything
      on the sheet afterward.
    </p>
    {#if initError}
      <p class="mt-2 text-xs text-red-300">{initError}</p>
    {/if}
  </section>
{/if}
