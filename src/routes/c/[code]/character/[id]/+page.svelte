<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import { derive } from '$lib/rules';
  import type { CharacterDocument, Derived, ContentLookup } from '$lib/rules/types';
  import { connectCharacterDoc, type ConnectedDoc } from '$lib/realtime/character-doc';
  import {
    connectEncounterDoc,
    setTurnPlan,
    clearTurnPlan,
    applyDamage as applyEncDamage,
    applyHeal as applyEncHeal,
    type ConnectedEncounter,
    type EncounterSnapshot,
    type TurnPlan,
    type ParticipantHp
  } from '$lib/realtime/encounter-doc';
  import type { PageData } from './$types';

  export let data: PageData;

  // Common conditions surfaced as quick checkboxes. Rare ones can be set via API.
  const COMMON_CONDITIONS = [
    'rage',
    'frightened',
    'prone',
    'restrained',
    'unconscious',
    'poisoned',
    'charmed',
    'incapacitated',
    'invisible',
    'stunned'
  ];

  let busy = false;
  let damageInput = 0;
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

  // ---- realtime sync (M2.3) ----
  // Y.Doc state from the server replaces the SSR snapshot once the websocket
  // is open. Client runs derive() locally on every Y.Doc update so the
  // displayed stats reflect live HP/conditions/toggles within one tick.
  let conn: ConnectedDoc | null = null;
  let syncStatus: 'connecting' | 'open' | 'closed' | 'auth-failed' = 'connecting';
  let unsubStatus: (() => void) | undefined;
  let unsubDoc: (() => void) | undefined;
  /** Snapshot from the live Y.Doc — null until first message arrives. */
  let liveDoc: CharacterDocument | null = null;

  // Build a ContentLookup over the shipped contentMap. Lazy via $: so HMR
  // updates of contentMap (rare) re-thread.
  $: contentLookup = ((ref) =>
    data.contentMap[`${ref.kind}/${ref.slug}`]) as ContentLookup;

  // The effective document: live Y.Doc snapshot when available, else the
  // SSR document. Falls back gracefully if the sync-server is offline.
  $: document = (liveDoc ?? data.document) as CharacterDocument | null;

  // Re-derive when document changes. Initial render uses the server's
  // derived output (data.derived) so first paint isn't blank.
  $: derived = document
    ? serializeDerivedClient(derive(document, contentLookup))
    : data.derived;

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

  // ---- M3.4: turn planner ----
  // When this character is a participant in a live encounter, we connect to
  // the encounter Y.Doc so the player can broadcast a turn plan (action +
  // target + notes) that the DM sees live on the encounter page.
  let encConn: ConnectedEncounter | null = null;
  let encState: EncounterSnapshot | null = null;
  let unsubEncState: (() => void) | undefined;
  let planActionId = '';
  let planTargetId: string | null = null;
  let planNotes = '';
  let planSubmitting = false;

  // ---- M3.5c: resolve flow ----
  // The player can resolve their own plan: optionally declare what they
  // rolled (attack total, damage total, hit/miss), apply HP to a non-PC
  // target via the Y.Doc, and append to the encounter's action_log.
  // PC targets aren't auto-damaged here — the target's own sheet is the
  // source of truth for PC HP.
  let resolveOpen = false;
  let resolveAttack: number | null = null;
  let resolveDamage: number | null = null;
  let resolveHit: '' | 'hit' | 'miss' | 'crit' | 'fumble' | 'heal' = '';
  let resolveNotes = '';
  let resolveSubmitting = false;
  let resolveError: string | null = null;

  onMount(() => {
    if (!data.syncToken) return;
    conn = connectCharacterDoc({ token: data.syncToken, characterId: data.character.id });
    unsubStatus = conn.status.subscribe((s) => (syncStatus = s));
    unsubDoc = conn.document.subscribe((d) => (liveDoc = d));

    if (data.liveEncounter) {
      encConn = connectEncounterDoc({
        token: data.syncToken,
        encounterId: data.liveEncounter.id
      });
      unsubEncState = encConn.state.subscribe((s) => {
        encState = s;
        // Pre-fill the draft from the existing plan if any (so reload doesn't lose it).
        if (s && data.liveEncounter) {
          const existing = s.plans[data.liveEncounter.selfParticipantId];
          if (existing && !planActionId) {
            planActionId = existing.actionId;
            planTargetId = existing.targetParticipantId;
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

  /** Action cost label shown next to each plan option. */
  function costLabel(cost: unknown): string {
    if (cost === 'action') return 'Action';
    if (cost === 'bonus') return 'Bonus';
    if (cost === 'reaction') return 'Reaction';
    if (cost === 'free') return 'Free';
    if (cost && typeof cost === 'object') {
      if ('movement' in cost) {
        const c = cost as { movement: number };
        return `${c.movement} ft move`;
      }
      if ('uses' in cost) {
        const c = cost as { uses: number; per: string };
        return `${c.uses}/${c.per}`;
      }
    }
    return String(cost ?? '');
  }

  /** Flat list of actions available from derived, plus a human label. */
  $: actionOptions = derived
    ? (derived.actions ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        costLabel: costLabel(a.cost),
        attackBonus: a.attackBonus ?? null,
        range: a.range
      }))
    : [];

  function submitPlan() {
    if (!encConn || !data.liveEncounter) return;
    const action = actionOptions.find((a) => a.id === planActionId);
    if (!action) return;
    planSubmitting = true;
    try {
      const plan: TurnPlan = {
        actionId: action.id,
        actionLabel: `${action.name} (${action.costLabel})`,
        targetParticipantId: planTargetId,
        notes: planNotes.slice(0, 200),
        updatedAt: Date.now()
      };
      setTurnPlan(encConn.ydoc, data.liveEncounter.selfParticipantId, plan);
    } finally {
      planSubmitting = false;
    }
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
    if (!data.liveEncounter || !myPlan?.targetParticipantId) return null;
    return data.liveEncounter.participants.find((p) => p.id === myPlan!.targetParticipantId) ?? null;
  }

  async function submitResolve() {
    if (!encConn || !data.liveEncounter || !myPlan) return;
    const round = encState?.round ?? 0;
    const selfId = data.liveEncounter.selfParticipantId;
    const target = resolveTargetParticipant();
    resolveSubmitting = true;
    resolveError = null;

    // Apply HP to the target via Y.Doc when:
    //   - target exists, is non-PC
    //   - damage roll declared
    //   - hit ∈ {hit, crit} → damage; hit === 'heal' → healing (capped to maxHp)
    // PC targets aren't auto-applied here — the target player's sheet
    // is the source of truth for their HP.
    let targetHpBefore: number | null = null;
    let targetHpAfter: number | null = null;
    if (
      target &&
      target.kind !== 'pc' &&
      typeof resolveDamage === 'number' &&
      resolveDamage > 0 &&
      (resolveHit === 'hit' || resolveHit === 'crit' || resolveHit === 'heal')
    ) {
      const live = encState?.participantHp[target.id];
      const seed: ParticipantHp = {
        currentHp: live?.currentHp ?? null,
        tempHp: live?.tempHp ?? 0,
        conditions: live?.conditions ?? []
      };
      targetHpBefore = seed.currentHp;
      const next =
        resolveHit === 'heal'
          ? applyEncHeal(encConn.ydoc, target.id, resolveDamage, target.maxHp, seed)
          : applyEncDamage(encConn.ydoc, target.id, resolveDamage, seed);
      targetHpAfter = next.currentHp;
    }

    try {
      const res = await fetch(`/api/encounters/${data.liveEncounter.id}/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId: selfId,
          targetParticipantId: myPlan.targetParticipantId,
          actionId: myPlan.actionId,
          actionLabel: myPlan.actionLabel,
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
      // Clear the plan now that the action has been resolved.
      clearTurnPlan(encConn.ydoc, selfId);
      planActionId = '';
      planTargetId = null;
      planNotes = '';
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
    if (isMyTurn && !prevIsMyTurn && document?.reactionUsedThisRound) {
      // Fire-and-forget; busy state stays untouched for this background reset.
      patchDocument((d) => {
        d.reactionUsedThisRound = false;
      }).catch(() => {});
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
    const n = Math.max(0, Math.floor(damageInput));
    if (n === 0) return;
    await patchDocument((d) => {
      const tempAbsorbed = Math.min(d.tempHp, n);
      d.tempHp -= tempAbsorbed;
      d.currentHp = Math.max(0, d.currentHp - (n - tempAbsorbed));
    });
    damageInput = 0;
  }

  async function applyHeal() {
    const n = Math.max(0, Math.floor(healInput));
    if (n === 0 || !derived) return;
    await patchDocument((d) => {
      d.currentHp = Math.min(derived!.stats.hp.max, d.currentHp + n);
    });
    healInput = 0;
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
    await patchDocument((d) => {
      const has = d.conditions.includes(name);
      if (on && !has) d.conditions.push(name);
      else if (!on && has) d.conditions = d.conditions.filter((c) => c !== name);
    });
  }

  async function toggleModifier(id: string, enabled: boolean) {
    await patchDocument((d) => {
      d.modifierToggles[id] = enabled;
    });
  }

  async function adjustResource(id: string, delta: number, max: number) {
    await patchDocument((d) => {
      d.resourcesSpent ??= {};
      const next = Math.max(0, Math.min(max, (d.resourcesSpent[id] ?? 0) + delta));
      d.resourcesSpent[id] = next;
    });
  }

  // ---- reaction + concentration (M3.6) ----
  async function toggleReaction() {
    await patchDocument((d) => {
      d.reactionUsedThisRound = !d.reactionUsedThisRound;
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
  let pickerSlug = data.itemOptions[0]?.slug ?? '';

  async function addItem() {
    if (!pickerSlug) return;
    const opt = data.itemOptions.find((i) => i.slug === pickerSlug);
    if (!opt) return;
    await patchDocument((d) => {
      d.inventory.push({
        contentKind: 'item',
        contentSlug: opt.slug,
        version: 1,
        equipped: false,
        attuned: false
      });
    });
  }

  async function setInventoryFlag(index: number, key: 'equipped' | 'attuned', on: boolean) {
    await patchDocument((d) => {
      if (!d.inventory[index]) return;
      d.inventory[index][key] = on;
    });
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
  let spellPickerSlug = data.spellOptions[0]?.slug ?? '';

  async function addSpell() {
    if (!spellPickerSlug) return;
    const opt = data.spellOptions.find((s) => s.slug === spellPickerSlug);
    if (!opt) return;
    await patchDocument((d) => {
      if (d.spells.known.some((k) => k.slug === opt.slug)) return; // dedupe
      d.spells.known.push({ kind: 'spell', slug: opt.slug, version: 1 });
    });
  }

  async function togglePrepared(slug: string, on: boolean) {
    await patchDocument((d) => {
      const has = d.spells.prepared.includes(slug);
      if (on && !has) d.spells.prepared.push(slug);
      else if (!on && has) d.spells.prepared = d.spells.prepared.filter((s) => s !== slug);
    });
  }

  async function removeSpell(slug: string) {
    await patchDocument((d) => {
      d.spells.known = d.spells.known.filter((s) => s.slug !== slug);
      d.spells.prepared = d.spells.prepared.filter((s) => s !== slug);
    });
  }

  function spellMeta(slug: string) {
    return data.spellOptions.find((s) => s.slug === slug);
  }

  function levelLabel(level: number): string {
    if (level === 0) return 'cantrip';
    if (level === 1) return '1st';
    if (level === 2) return '2nd';
    if (level === 3) return '3rd';
    return `${level}th`;
  }

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
    await patchDocument((d) => {
      resetResourcesByPer(d, 'short-rest');
      d.reactionUsedThisRound = false;
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
      d.reactionUsedThisRound = false;
      d.concentrating = null;
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

<header class="mb-6 flex items-baseline justify-between">
  <div>
    <h1 class="text-2xl font-semibold">{data.character.name}</h1>
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
    <p class="mt-1 text-xs">
      {#if syncStatus === 'open'}
        <span class="rounded bg-emerald-900/40 px-1.5 py-0.5 text-emerald-200">● Live sync connected</span>
      {:else if syncStatus === 'connecting'}
        <span class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">○ Sync connecting…</span>
      {:else if syncStatus === 'auth-failed'}
        <span class="rounded bg-red-900/40 px-1.5 py-0.5 text-red-200">✕ Sync auth failed</span>
      {:else}
        <span class="rounded bg-amber-900/40 px-1.5 py-0.5 text-amber-200">⚠ Sync offline (edits still persist via API)</span>
      {/if}
    </p>
  </div>
  <a class="text-xs text-slate-400 hover:text-slate-200" href={`/c/${data.campaign.code}`}>
    ← back to {data.campaign.name}
  </a>
</header>

{#if data.liveEncounter}
  <!-- ===== M3.4 turn planner ===== -->
  <section
    class="mb-6 rounded-lg border p-4 {isMyTurn
      ? 'border-emerald-700 bg-emerald-950/30'
      : 'border-amber-800 bg-amber-950/20'}"
  >
    <div class="mb-3 flex items-baseline justify-between">
      <h2 class="text-sm font-semibold">
        {#if isMyTurn}
          <span class="text-emerald-200">▶ Your turn</span>
        {:else}
          <span class="text-amber-200">⏳ In encounter</span>
        {/if}
        <a
          class="ml-2 text-xs font-normal text-slate-400 hover:text-slate-200"
          href={`/c/${data.campaign.code}/encounters/${data.liveEncounter.id}`}
        >
          {data.liveEncounter.name}
        </a>
      </h2>
      <p class="text-xs text-slate-400">
        {#if encState}
          round {encState.round}
          {#if encActiveName && !isMyTurn}
            · waiting on <span class="text-slate-200">{encActiveName}</span>
          {/if}
        {:else}
          connecting…
        {/if}
      </p>
    </div>

    {#if myPlan}
      <div class="mb-3 rounded border border-slate-700 bg-slate-950/60 p-2 text-xs">
        <div class="flex items-baseline justify-between gap-2">
          <div>
            <span class="font-semibold text-slate-300">Broadcast plan:</span>
            <span class="ml-1 text-emerald-200">{myPlan.actionLabel}</span>
            {#if myPlan.targetParticipantId}
              {@const tgt = data.liveEncounter.participants.find((p) => p.id === myPlan.targetParticipantId)}
              {#if tgt}
                <span class="text-slate-400"> → </span>
                <span class="text-slate-200">{tgt.name}</span>
              {/if}
            {/if}
            {#if myPlan.notes}
              <p class="mt-1 text-slate-400">“{myPlan.notes}”</p>
            {/if}
          </div>
          {#if !resolveOpen}
            <button
              class="rounded border border-emerald-700 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-900/40"
              on:click={openResolve}
            >
              Resolve
            </button>
          {/if}
        </div>
      </div>

      {#if resolveOpen}
        <div class="mb-3 rounded border border-emerald-800 bg-emerald-950/30 p-3 text-xs">
          <p class="mb-2 text-slate-300">
            Declare what you rolled (optional). HP applies automatically to non-PC
            targets when you mark hit/crit and provide damage; the log captures
            whatever you submit and the DM can amend.
          </p>
          <div class="flex flex-wrap items-end gap-2">
            <label>
              <span class="block text-slate-400">Attack total</span>
              <input
                type="number"
                class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
                placeholder="d20+mod"
                bind:value={resolveAttack}
              />
            </label>
            <label>
              <span class="block text-slate-400">Damage</span>
              <input
                type="number"
                class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-sm"
                placeholder="rolled"
                bind:value={resolveDamage}
              />
            </label>
            <label>
              <span class="block text-slate-400">Outcome</span>
              <select
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                bind:value={resolveHit}
              >
                <option value="">— let DM decide —</option>
                <option value="hit">hit</option>
                <option value="crit">crit</option>
                <option value="miss">miss</option>
                <option value="fumble">fumble</option>
                <option value="heal">heal</option>
              </select>
            </label>
            <label class="flex-1">
              <span class="block text-slate-400">Notes</span>
              <input
                class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                placeholder="advantage, hex, etc."
                maxlength="500"
                bind:value={resolveNotes}
              />
            </label>
            <button
              class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
              on:click={submitResolve}
              disabled={resolveSubmitting}
            >
              {resolveSubmitting ? 'Submitting…' : 'Submit'}
            </button>
            <button
              class="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
              on:click={() => (resolveOpen = false)}
              disabled={resolveSubmitting}
            >
              Cancel
            </button>
          </div>
          {#if resolveError}
            <p class="mt-2 text-red-300">{resolveError}</p>
          {/if}
        </div>
      {/if}
    {/if}

    {#if actionOptions.length === 0}
      <p class="text-xs text-slate-400">
        No actions resolved from your character sheet yet. Pick up a weapon /
        prepare a spell first.
      </p>
    {:else}
      <div class="flex flex-wrap items-end gap-2 text-sm">
        <label class="text-xs">
          <span class="block text-slate-400">Action</span>
          <select
            class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            bind:value={planActionId}
          >
            <option value="">— pick —</option>
            {#each actionOptions as a}
              <option value={a.id}>
                {a.name}
                {#if a.costLabel}({a.costLabel}){/if}
                {#if a.attackBonus != null} +{a.attackBonus}{/if}
              </option>
            {/each}
          </select>
        </label>
        <label class="text-xs">
          <span class="block text-slate-400">Target</span>
          <select
            class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            bind:value={planTargetId}
          >
            <option value={null}>— none / self —</option>
            {#each data.liveEncounter.participants as p}
              {#if p.id !== data.liveEncounter.selfParticipantId}
                <option value={p.id}>{p.name} <span class="text-slate-500">({p.kind})</span></option>
              {/if}
            {/each}
          </select>
        </label>
        <label class="flex-1 text-xs">
          <span class="block text-slate-400">Notes</span>
          <input
            class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            placeholder="e.g. cast with hex; flank from the south"
            maxlength="200"
            bind:value={planNotes}
          />
        </label>
        <button
          class="rounded bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
          on:click={submitPlan}
          disabled={planSubmitting || !planActionId || !encConn}
        >
          Broadcast
        </button>
      </div>
    {/if}
  </section>
{/if}

{#if document && derived}
  <!-- ===== Stats / saves / skills / actions (read-only) — sits above the
       in-encounter mutable cluster so the static stuff is the first thing
       a player sees. ===== -->
  <Sheet derived={derived} />

  <!-- Compact level-up row: one tiny ↑ button per class. Form panel below
       only renders when a draft is active. -->
  <section class="mb-6 flex flex-wrap items-center gap-2 text-xs">
    <span class="text-slate-500">Level up:</span>
    {#each document.classes as cls}
      <button
        class="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-emerald-600 hover:text-emerald-200 disabled:opacity-40"
        disabled={busy || cls.level >= 20}
        title="Bump {cls.slug} to L{cls.level + 1}"
        on:click={() => startLevelUp(cls.slug)}
      >
        ↑ {cls.slug} L{cls.level}
      </button>
    {/each}
  </section>

  <!-- ===== Edit panel: HP / hit dice / conditions / toggles / rest ===== -->
  <section class="mb-6 grid gap-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4 md:grid-cols-2">
    <!-- HP -->
    <div>
      <h2 class="mb-2 text-sm font-semibold text-slate-200">HP</h2>
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

  <!-- Reaction + concentration (compact row above slots/resources) -->
  <section class="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/30 p-3 text-sm">
    <!-- Reaction pill -->
    <button
      class="rounded border px-2 py-1 text-xs font-medium transition-colors {reactionUsed
        ? 'border-slate-700 bg-slate-950 text-slate-500 hover:text-slate-300'
        : 'border-emerald-700 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40'}"
      disabled={busy}
      title={reactionUsed
        ? 'Reaction used this round. Click to mark available again.'
        : 'Reaction available. Click to mark used.'}
      on:click={toggleReaction}
    >
      ⚡ Reaction: {reactionUsed ? 'used' : 'ready'}
    </button>

    <!-- Concentration -->
    {#if document.concentrating}
      <span
        class="flex items-center gap-2 rounded border border-indigo-700 bg-indigo-950/40 px-2 py-1 text-xs text-indigo-200"
      >
        <span>🌀 Concentrating:</span>
        <span class="font-semibold">{document.concentrating.label}</span>
        {#if document.concentrating.sinceRound != null}
          <span class="text-indigo-400/70">(since R{document.concentrating.sinceRound})</span>
        {/if}
        <button
          class="ml-1 rounded border border-indigo-700 px-1.5 py-0 text-[10px] hover:bg-indigo-900/40 disabled:opacity-40"
          disabled={busy}
          on:click={endConcentration}
        >
          drop
        </button>
      </span>
    {:else}
      <span class="flex items-center gap-1">
        <span class="text-xs text-slate-500">🌀 Concentrate on</span>
        <input
          class="w-44 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
          placeholder="bless, hex, hold person…"
          maxlength="80"
          bind:value={concDraft}
          on:keydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              startConcentration();
            }
          }}
        />
        <button
          class="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40"
          disabled={busy || concDraft.trim() === ''}
          on:click={startConcentration}
        >
          start
        </button>
      </span>
    {/if}
  </section>

  <!-- Spell slots + resources (mutable cluster) -->
  {@const slotLevels = Object.keys(derived.stats.spellSlots).map(Number).sort((a, b) => a - b)}
  {#if slotLevels.length > 0 || derived.resources.length > 0}
    <section class="mb-6 grid gap-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4 md:grid-cols-2">
      {#if slotLevels.length > 0}
        <div>
          <h2 class="mb-2 text-sm font-semibold text-slate-200">Spell slots</h2>
          <ul class="space-y-1 text-sm">
            {#each slotLevels as lvl}
              {@const slot = derived.stats.spellSlots[lvl]}
              {@const remaining = slot.max - slot.used}
              <li class="flex items-center justify-between gap-2 rounded border border-slate-700 px-2 py-1">
                <span class="font-mono text-xs">
                  L{lvl} <span class="ml-1">{remaining} / {slot.max}</span>
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
      {/if}
      {#if derived.resources.length > 0}
        <div>
          <h2 class="mb-2 text-sm font-semibold text-slate-200">Resources</h2>
          <ul class="space-y-1 text-sm">
            {#each derived.resources as r}
              {@const remaining = r.max - r.used}
              <li class="flex items-center justify-between gap-2 rounded border border-slate-700 px-2 py-1">
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
        </div>
      {/if}
    </section>
  {/if}

  <!-- Conditions + toggles -->
  <section class="mb-6 grid gap-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4 md:grid-cols-2">
    <div>
      <h2 class="mb-2 text-sm font-semibold text-slate-200">Conditions</h2>
      <ul class="flex flex-wrap gap-2 text-sm">
        {#each COMMON_CONDITIONS as cond}
          {@const on = document.conditions.includes(cond)}
          <li>
            <label
              class="inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs {on
                ? 'border-emerald-600 bg-emerald-900/30 text-emerald-200'
                : 'border-slate-700 text-slate-400 hover:text-slate-200'}"
            >
              <input
                type="checkbox"
                class="hidden"
                checked={on}
                on:change={(e) => toggleCondition(cond, checkboxChecked(e))}
                disabled={busy}
              />
              <span class="capitalize">{cond}</span>
            </label>
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
            Bumps ({bgDraftMeta.abilityChoices.map((a) => a.toUpperCase()).join(' / ')})
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
                  {#each bgDraftMeta.abilityChoices as a}
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

  <!-- Inventory -->
  <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
    <h2 class="mb-3 text-sm font-semibold text-slate-200">Inventory</h2>

    {#if document.inventory.length > 0}
      <ul class="mb-3 divide-y divide-slate-800">
        {#each document.inventory as slot, i}
          {@const meta = itemMeta(slot.contentSlug)}
          <li class="flex items-center justify-between gap-3 py-2 text-sm">
            <div class="flex-1">
              <span class="font-medium">{meta?.name ?? slot.contentSlug}</span>
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
            <label class="flex items-center gap-1 text-xs text-slate-400" class:opacity-40={!meta?.requiresAttunement}>
              <input
                type="checkbox"
                checked={slot.attuned}
                disabled={busy || !meta?.requiresAttunement}
                on:change={(e) => setInventoryFlag(i, 'attuned', checkboxChecked(e))}
              />
              attuned
            </label>
            <button
              class="text-xs text-slate-500 hover:text-red-400"
              disabled={busy}
              on:click={() => removeInventoryItem(i)}
            >
              ×
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="flex gap-2">
      <select
        class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
        bind:value={pickerSlug}
      >
        {#each data.itemOptions as opt}
          <option value={opt.slug}>{opt.name} <span class="text-slate-500">({opt.category})</span></option>
        {/each}
      </select>
      <button
        class="rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600 disabled:opacity-50"
        disabled={busy || !pickerSlug}
        on:click={addItem}
      >
        Add
      </button>
    </div>
  </section>

  <!-- Spells -->
  {#if derived.stats.spellcastingAbility}
    <section class="mb-6 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
      <h2 class="mb-3 text-sm font-semibold text-slate-200">Spells</h2>
      <p class="mb-3 text-xs text-slate-500">
        Spellbook = "known" list. Toggle "prepared" to make a spell available today.
      </p>

      {#if document.spells.known.length > 0}
        <ul class="mb-3 divide-y divide-slate-800">
          {#each document.spells.known as ref}
            {@const meta = spellMeta(ref.slug)}
            {@const prep = document.spells.prepared.includes(ref.slug)}
            <li class="flex items-center justify-between gap-3 py-2 text-sm">
              <div class="flex-1">
                <span class="font-medium">{meta?.name ?? ref.slug}</span>
                {#if meta}
                  <span class="ml-2 text-xs text-slate-500">{levelLabel(meta.level)} &middot; {meta.school}</span>
                {/if}
              </div>
              <label class="flex items-center gap-1 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={prep}
                  disabled={busy}
                  on:change={(e) => togglePrepared(ref.slug, checkboxChecked(e))}
                />
                prepared
              </label>
              <button class="text-xs text-slate-500 hover:text-red-400" disabled={busy} on:click={() => removeSpell(ref.slug)}>
                ×
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="flex gap-2">
        <select class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" bind:value={spellPickerSlug}>
          {#each data.spellOptions as opt}
            <option value={opt.slug}>{opt.name} <span class="text-slate-500">({levelLabel(opt.level)})</span></option>
          {/each}
        </select>
        <button
          class="rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600 disabled:opacity-50"
          disabled={busy || !spellPickerSlug}
          on:click={addSpell}
        >
          Add
        </button>
      </div>
    </section>
  {/if}

{:else}
  <section class="rounded-lg border border-amber-800 bg-amber-950/30 p-6 text-sm">
    <h2 class="text-base font-semibold text-amber-200">No character document</h2>
    <p class="mt-2 text-amber-100">
      This character was created without a full document. Recreate via the
      form on the campaign page or POST a document via
      <code class="text-xs">PATCH /api/characters/{data.character.id}</code>.
    </p>
  </section>
{/if}
