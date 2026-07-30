// Shared load core for the two encounter routes:
//
//   /c/[code]/encounters/[id]                          (code-scoped)
//   /campaigns/[dmUsername]/[slug]/encounters/[id]     (named URL)
//
// Each route's +page.server.ts keeps only param resolution + membership
// checks, then delegates here for everything both pages share: participant
// assembly with reveal-based redaction, monster statblock derivation, per-PC
// derived stats/actions/triggers, the action log, and the add-monster /
// add-PC picker data.

import { error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { readCombatState } from '$lib/encounter/combat-state';
import { monsterDerive, type MonsterDerived } from '$lib/rules/monster-derive';
import { hpBucket, parseReveals, type ParticipantReveals } from '$lib/realtime/reveals';
import { initiativeCompare, makePlaceholderNamer } from '$lib/realtime/participants';
import { normalizeTimers, pruneTimers } from '$lib/encounter/condition-timers';
import { buildRedactionMap, redactActionLog } from '$lib/realtime/action-log';
import { derive } from '$lib/rules';
import { hasResourceBudget } from '$lib/rules/apply-grants';
import type { ActionCost, CharacterDocument, ContentLookup } from '$lib/rules/types';
import { buildContentLookup, serializeDerived } from '$lib/server/content/lookup';
import { boardWire, loadEncounterBoard } from '$lib/server/encounter/board';
import { visibleTokenPositions } from '$lib/encounter/board-visibility';

export async function buildEncounterPageData(
  campaign: { id: string },
  encounterId: string,
  isDM: boolean,
  /** Viewing user's id. Used only to compute `myParticipantIds` — which rows
   *  on this page are the viewer's own characters — so the page can raise a
   *  "your turn" callout for the player whose PC is active without showing
   *  it to everyone watching the same active row. */
  viewerUserId?: string
) {
  const encRows = await db
    .select()
    .from(schema.encounters)
    .where(and(eq(schema.encounters.id, encounterId), eq(schema.encounters.campaignId, campaign.id)))
    .limit(1);
  if (encRows.length === 0) throw error(404, 'encounter not found in this campaign');
  const enc = encRows[0];

  // Players can't reach a staging encounter — it's the DM's draft and the
  // name alone can spoil ("Final Boss Room"). 404 mirrors what they see in
  // the encounter list.
  if (!isDM && enc.status === 'staging') throw error(404, 'encounter not found in this campaign');

  const partRows = await db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, enc.id));

  // Attached battle board (or undefined). Wire shape is role-redacted by
  // boardWire; token positions go through visibleTokenPositions — the same
  // two paths the /state poll and the board REST route use.
  const boardRow = await loadEncounterBoard(enc.id);

  // Pull each unique monster statblock's `actions` so the DM resolve panel
  // can offer a picker instead of free-text. We only ship the per-action
  // mechanical bits (name, attackBonus, damage dice, range) — DM rolls,
  // engine fills HP. Cached by slug to avoid N queries when there are
  // multiple goblins.
  const monsterSlugs = Array.from(
    new Set(partRows.map((p) => p.statblockSlug).filter((s): s is string => !!s))
  );
  const statblockActions = new Map<
    string,
    Array<{
      name: string;
      attackBonus?: number;
      range?: string;
      damage?: Array<{ dice: string; type: string }>;
      /** Prose, shipped so the resolve panel can pre-fill a save DC from
       *  "DC 15 Dexterity saving throw" instead of making the DM retype it
       *  every round (see $lib/encounter/save-prose). */
      description?: string;
      saveDC?: number;
      saveAbility?: string;
    }>
  >();
  // Full derived statblock per monster slug — UI uses this to render the
  // inline expandable sheet view next to each non-PC participant.
  const monsterStatblocks = new Map<string, MonsterDerived>();
  // Dex scores for monster slugs — used as the initiative tiebreaker.
  const monsterDex = new Map<string, number>();
  if (monsterSlugs.length > 0) {
    const rows = await db
      .select({ slug: schema.content.slug, data: schema.content.data })
      .from(schema.content)
      .where(eq(schema.content.kind, 'monster'));
    for (const r of rows) {
      if (!monsterSlugs.includes(r.slug)) continue;
      const data = JSON.parse(r.data as string) as Record<string, unknown>;
      const derived = monsterDerive(data);
      monsterStatblocks.set(r.slug, derived);
      // Picker shape: extract action subset that the resolve panel needs.
      statblockActions.set(
        r.slug,
        derived.actions.map((a) => ({
          name: a.name,
          attackBonus: a.attackBonus,
          range: a.range,
          damage: a.damage,
          description: a.description,
          saveDC: a.saveDC,
          saveAbility: a.saveAbility
        }))
      );
      monsterDex.set(r.slug, derived.abilityScores.dex);
    }
  }

  // Dex for PCs comes from the character document. Batch-load any character
  // referenced by a participant so the initiative tiebreaker has a value.
  const pcCharIds = Array.from(
    new Set(partRows.map((p) => p.characterId).filter((s): s is string => !!s))
  );
  const pcDex = new Map<string, number>();
  if (pcCharIds.length > 0) {
    // Pull characters linked to this campaign via the M:N join. Post-Phase 1
    // a character can live in N campaigns; we still scope to *this* one.
    const charRows = await db
      .select({ id: schema.characters.id, document: schema.characters.document })
      .from(schema.characters)
      .innerJoin(
        schema.campaignCharacters,
        eq(schema.campaignCharacters.characterId, schema.characters.id)
      )
      .where(eq(schema.campaignCharacters.campaignId, campaign.id));
    for (const r of charRows) {
      if (!pcCharIds.includes(r.id) || !r.document) continue;
      try {
        const doc = JSON.parse(r.document) as { abilityScores?: { dex?: number } };
        if (typeof doc.abilityScores?.dex === 'number') pcDex.set(r.id, doc.abilityScores.dex);
      } catch {
        // ignore
      }
    }
  }

  function dexForParticipant(p: typeof partRows[number]): number {
    if (p.characterId) return pcDex.get(p.characterId) ?? 10;
    if (p.statblockSlug) return monsterDex.get(p.statblockSlug) ?? 10;
    // Ad-hoc NPC: try the inline statblockJson, else default 10.
    if (p.statblockJson) {
      try {
        const d = JSON.parse(p.statblockJson) as { abilityScores?: { dex?: number } };
        return d.abilityScores?.dex ?? 10;
      } catch {
        // fall through
      }
    }
    return 10;
  }

  // M3.5b: action log entries for this encounter — chronological. The rows
  // are redacted per viewer role at serialization time below; a hidden
  // participant's row otherwise ships its name, action, damage and the
  // target's exact HP to every player (see $lib/realtime/action-log).
  const logRows = await db
    .select()
    .from(schema.actionLog)
    .where(eq(schema.actionLog.encounterId, enc.id))
    .orderBy(schema.actionLog.createdAt);

  /** Real name + reveal flags per participant id — the input the log
   *  redactor needs. Built from the unfiltered rows on purpose: it must
   *  know about the hidden participants in order to redact them. */
  const logRedaction = buildRedactionMap(
    partRows.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      reveals: parseReveals(p.revealsJson)
    }))
  );

  /** Participant ids a player viewer is allowed to know exist. Keyed
   *  side-channels (plans, concentration) are filtered through this so they
   *  don't reintroduce a hidden participant the list already dropped. */
  const visibleToViewer = new Set(
    partRows
      .filter((p) => isDM || p.kind === 'pc' || !parseReveals(p.revealsJson).hidden)
      .map((p) => p.id)
  );

  // Characters linked to this campaign — for "add PC" picker and the
  // party-budget summary in the encounter header. JOIN through
  // campaign_characters so post-Phase 1 multi-campaign PCs show up
  // correctly. Document JSON carries `classes[].level` which we sum into
  // a per-PC total level. leftJoin users so legacy NULL-owner characters
  // still list (they just have no sheet URL).
  const charRows = await db
    .select({
      id: schema.characters.id,
      name: schema.characters.name,
      slug: schema.characters.slug,
      ownerUsername: schema.users.username,
      document: schema.characters.document
    })
    .from(schema.characters)
    .innerJoin(
      schema.campaignCharacters,
      eq(schema.campaignCharacters.characterId, schema.characters.id)
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.characters.ownerUserId))
    .where(eq(schema.campaignCharacters.campaignId, campaign.id));

  /** Live character name by character.id — lets PC participant rows reflect
   *  rename in the character sheet without having to re-sync the snapshot
   *  stored on the participants table. */
  const charNameById = new Map(charRows.map((r) => [r.id, r.name]));

  /** Sheet-link parts (owner username + slug) by character.id, so the
   *  encounter view can deep-link to the campaign-free /characters/<user>/<slug>
   *  sheet. Null entries (legacy NULL-owner/slug) get no link. */
  const characterLinks: Record<string, { username: string; slug: string }> = {};
  for (const r of charRows) {
    if (r.ownerUsername && r.slug) {
      characterLinks[r.id] = { username: r.ownerUsername, slug: r.slug };
    }
  }

  // Party makeup — only characters that are participants in this encounter
  // count toward the budget. Multi-classed PCs sum their class levels.
  const encounterCharacterIds = new Set(
    partRows.map((p) => p.characterId).filter((s): s is string => !!s)
  );
  const partyLevels: number[] = [];
  for (const r of charRows) {
    if (!encounterCharacterIds.has(r.id) || !r.document) continue;
    try {
      const doc = JSON.parse(r.document) as { classes?: Array<{ level?: number }> };
      const total = (doc.classes ?? []).reduce((s, c) => s + (c.level ?? 0), 0);
      if (total > 0) partyLevels.push(total);
    } catch {
      // ignore — char without a parseable doc is excluded from the budget
    }
  }
  const partySize = partyLevels.length;
  const partyLevelSum = partyLevels.reduce((s, l) => s + l, 0);
  const partyAvgLevel = partySize > 0 ? partyLevelSum / partySize : 0;

  // For PC participants, load prepared spell list (action-economy foldout),
  // current conditions (+cond disclosure), and compact derived stats
  // (+stats disclosure). One pass over the character rows powers all three.
  const pcParticipants = partRows.filter(p => p.kind === 'pc' && p.characterId);
  const participantSpells: Record<string, Array<{slug: string; name: string; level: number}>> = {};
  const participantPcConditions: Record<string, string[]> = {};
  /** Round-scoped duration overlay on each PC's conditions, read from the
   *  character document. First-paint seed only — the 2s poll keeps it fresh
   *  afterwards. Non-PC timers ride `participantPlans[id].conditionTimers`.
   *  See $lib/encounter/condition-timers. */
  const participantPcConditionTimers: Record<
    string,
    Array<{ condition: string; untilRound: number }>
  > = {};
  type CompactPcStats = {
    ac: number;
    hp: { current: number; max: number; temp: number };
    abilities: Record<string, { score: number; mod: number }>;
    saves: Record<string, { bonus: number; proficient: boolean }>;
    skills: Record<string, { bonus: number; proficient: boolean; expertise: boolean }>;
    senses: Record<string, number>;
    speeds: Record<string, number>;
    passivePerception: number;
    proficiencyBonus: number;
    totalLevel: number;
    spellSaveDC: number | null;
    spellAttackBonus: number | null;
    spellcastingAbility: string | null;
    resistances: string[];
    immunities: string[];
    vulnerabilities: string[];
    /** Critical hits against this PC become normal hits (adamantine
     *  armor — stats.incomingCritImmune). The DM resolve flow downgrades
     *  a 'crit' outcome against them; the stats disclosure shows a
     *  defenses line. */
    incomingCritImmune: boolean;
    species: string | null;
    subspecies: string | null;
  };
  const participantPcStats: Record<string, CompactPcStats> = {};
  /** Derived action list per PC participant — drives the DM-side action
   *  chooser so custom/homebrew actions (e.g. racial features) show up in
   *  the encounter UI, not just on the character sheet.
   *
   *  Each row also carries the *legality* bits the encounter planner needs
   *  to grey out a pick it can't offer: which resource pool the action
   *  debits, how much it costs, how much is left, and the server's
   *  `hasResourceBudget` verdict (the same helper the character sheet
   *  uses). Computed here because it needs the full `Derived`, which never
   *  leaves the server; the client folds it together with the live
   *  action-economy flags in $lib/encounter/action-availability. */
  type PcActionChoice = {
    id: string;
    name: string;
    cost: ActionCost;
    attackCount?: number;
    spendsResource?: string;
    resourceCost?: number;
    resourceName?: string;
    resourceRemaining?: number;
    resourceMax?: number;
    /** hasResourceBudget(action, derived.resources) at load time. */
    affordable: boolean;
    /** Dice for the DM's resolve panel. Monster actions have always shipped
     *  these (see `statblockActions`), so a PC's rows were the only ones
     *  whose 🎲 buttons stayed dead — the DM had to look the numbers up on
     *  the sheet and type them. */
    attackBonus?: number;
    damage?: Array<{ dice: string; type: string }>;
    saveDC?: number;
    saveAbility?: string;
    /** Prose, when the derived action carries any — lets the resolve flow
     *  parse an AoE template ("20-foot-radius sphere") and a save DC out of
     *  a PC action exactly as it does for monster actions. */
    description?: string;
    /** Range in feet + melee/ranged classification, for the board: melee
     *  reach feeds threat envelopes and opportunity-attack prompts (a
     *  glaive PC threatens 10 ft, not the flat 5 the statblock-only reader
     *  assumed), and range drives the in-range target highlight. */
    rangeFt?: number;
    attackRange?: 'melee' | 'ranged';
  };
  const participantPcActions: Record<string, PcActionChoice[]> = {};
  /** Per-PC action-economy flags, read straight off the character document
   *  (the same `*UsedThisRound` fields the character sheet writes). SSR seed
   *  for the encounter planner's used-toggles; the 2s poll keeps them fresh
   *  afterwards so a second DM tab agrees. */
  type EconomyState = {
    actionUsed: boolean;
    bonusUsed: boolean;
    reactionUsed: boolean;
    movementUsed: number;
  };
  const participantPcEconomy: Record<string, EconomyState> = {};
  /** Participant ids whose linked character is owned by the viewing user.
   *  Drives the "it's your turn" callout — distinct from "this is the
   *  active row", which every viewer sees. */
  const myParticipantIds: string[] = [];
  /** Derived trigger list per PC participant — drives the reaction queue so
   *  the DM is prompted when a PC trigger fires during turn resolution.
   *  `grants` carries the trigger's structured grant payload so the prompt
   *  can render its one-line summary (grantSummary in
   *  $lib/rules/grant-summary) instead of a bare trigger name. */
  type PcTriggerChoice = {
    id: string;
    name: string;
    on: string[];
    grants?: { type: string; [k: string]: unknown };
  };
  const participantPcTriggers: Record<string, PcTriggerChoice[]> = {};
  /** PC concentration sourced from the character document. Null when the
   *  PC isn't concentrating. Lets the DM see what each PC is concentrating
   *  on inline with the participant row. */
  const participantPcConcentrating: Record<
    string,
    { label: string; sinceRound?: number } | null
  > = {};
  /** Per-PC receivedBuffs (Shield of Faith, Bless, etc.) so the encounter
   *  view can label "PC has +2 AC because Shield of Faith from Cleric
   *  Vortha" alongside the rolled-up participantPcStats. Buff *effects*
   *  already flow through derive() into participantPcStats automatically;
   *  this field gives the DM source visibility for those effects. */
  const participantPcReceivedBuffs: Record<
    string,
    Array<{ id: string; spellSlug: string; slot?: number; variant?: string; sourceLabel?: string }>
  > = {};

  /** Persisted plan per participant — read from the new plan_json column so
   *  SSR can render the chooser's selection without waiting for the SSE
   *  channel to deliver a 'plan' event. */
  const participantPlans: Record<string, unknown> = {};
  /** Non-PC combat state (migration 0009), read with the one-release
   *  fallback to the legacy plan_json keys. Only the lair marker is shipped
   *  to the page — and the whole state ships as `participantCombatState`
   *  so the encounter page can seed the channel's economy/timers for the
   *  first paint (writers stopped putting them on plan_json in 0009). */
  const combatStates: Record<string, ReturnType<typeof readCombatState>> = {};
  /** Persisted concentration target per non-PC participant. PC concentration
   *  lives on the character document and rides through participantPcConcentrating
   *  below. */
  const participantNonPcConcentrating: Record<string, { label: string; sinceRound?: number } | null> = {};
  for (const p of partRows) {
    // A hidden participant is absent from the player's participant list —
    // its plan / concentration must not ride along in these id-keyed maps.
    if (!visibleToViewer.has(p.id)) continue;
    combatStates[p.id] = readCombatState(p.combatStateJson, p.planJson);
    if (p.planJson) {
      try {
        const plan = JSON.parse(p.planJson) as Record<string, unknown>;
        // Fog redaction for planned movement, mirroring the /state poll: a
        // viewer who may not see this token's position may not see where it
        // intends to go either. `participantPositions` (same fog mask) is
        // the visibility set; it's computed after this loop, so strip
        // against the raw inputs here.
        if (!isDM && (plan.moveTo || plan.path)) {
          const visible =
            Object.keys(
              visibleTokenPositions([p], boardRow, false)
            ).length > 0;
          if (!visible) {
            delete plan.moveTo;
            delete plan.path;
          }
        }
        participantPlans[p.id] = plan;
      } catch {
        // ignore malformed JSON
      }
    }
    if (p.kind !== 'pc' && p.concentratingJson) {
      try {
        participantNonPcConcentrating[p.id] = JSON.parse(p.concentratingJson);
      } catch {
        // ignore malformed JSON
      }
    }
  }

  if (pcParticipants.length > 0) {
    const spellCharRows = await db
      .select({
        id: schema.characters.id,
        ownerUserId: schema.characters.ownerUserId,
        document: schema.characters.document
      })
      .from(schema.characters)
      .where(inArray(schema.characters.id, pcParticipants.map(p => p.characterId!)));

    // The content lookup varies only by character owner (owned + subscribed
    // homebrew) and the fixed campaign — build once per distinct owner
    // instead of once per character.
    const lookupByOwner = new Map<string, ContentLookup>();
    async function lookupForOwner(ownerUserId: string | null): Promise<ContentLookup> {
      const key = ownerUserId ?? '';
      let cached = lookupByOwner.get(key);
      if (!cached) {
        cached = (await buildContentLookup(ownerUserId ?? undefined, campaign.id)).lookup;
        lookupByOwner.set(key, cached);
      }
      return cached;
    }

    for (const char of spellCharRows) {
      const participant = pcParticipants.find(p => p.characterId === char.id);
      if (!participant) continue;
      if (viewerUserId && char.ownerUserId === viewerUserId) {
        myParticipantIds.push(participant.id);
      }
      if (!char.document) continue;
      try {
        const doc = JSON.parse(char.document) as CharacterDocument;
        const prepared = new Set(doc.spells?.prepared ?? []);
        const known = doc.spells?.known ?? [];
        participantSpells[participant.id] = known
          .filter(k => prepared.has(k.slug))
          .map(k => ({ slug: k.slug, name: k.slug, level: 0 }));
        participantPcConditions[participant.id] = [...(doc.conditions ?? [])];
        participantPcConditionTimers[participant.id] = pruneTimers(
          normalizeTimers(doc.conditionTimers),
          doc.conditions ?? []
        );
        participantPcEconomy[participant.id] = {
          actionUsed: doc.actionUsedThisRound === true,
          bonusUsed: doc.bonusActionUsedThisRound === true,
          reactionUsed: doc.reactionUsedThisRound === true,
          movementUsed: doc.movementUsedThisRound ?? 0
        };
        participantPcConcentrating[participant.id] = doc.concentrating ?? null;
        participantPcReceivedBuffs[participant.id] = [...(doc.receivedBuffs ?? [])];
        try {
          const lookup = await lookupForOwner(char.ownerUserId ?? null);
          const d = serializeDerived(derive(doc, lookup));
          const s = d.stats;
          const pools = d.resources ?? [];
          participantPcActions[participant.id] = (d.actions ?? []).map((a) => {
            // Pool resolution follows the character sheet's convention
            // (`spendsResource ?? id`): an activity with its own `uses`
            // block emits a pool keyed by the action's own id rather than
            // pointing at a shared one — Second Wind, Rage, Channel
            // Divinity. Without the fallback those never read as spent.
            const poolId = a.spendsResource ?? a.id;
            const pool = pools.find((r) => r.id === poolId);
            return {
              id: a.id,
              name: a.name,
              cost: a.cost,
              ...(a.attackCount != null && a.attackCount > 1 ? { attackCount: a.attackCount } : {}),
              ...(pool ? { spendsResource: poolId } : {}),
              ...(a.resourceCost != null ? { resourceCost: a.resourceCost } : {}),
              ...(pool
                ? {
                    resourceName: pool.name,
                    resourceRemaining: Math.max(0, pool.max - pool.used),
                    resourceMax: pool.max
                  }
                : {}),
              affordable: hasResourceBudget(
                { spendsResource: pool ? poolId : undefined, resourceCost: a.resourceCost },
                pools
              ),
              // Dice for the resolve panel's roll buttons. `damageRolls`
              // carries a formula per damage type; the panel's shape calls
              // that `dice`, same as a monster action's.
              ...(a.attackBonus != null ? { attackBonus: a.attackBonus } : {}),
              ...((a.damageRolls ?? []).length > 0
                ? {
                    damage: (a.damageRolls ?? []).map((r) => ({
                      dice: r.formula,
                      type: r.type
                    }))
                  }
                : {}),
              ...(a.saveDC
                ? { saveDC: a.saveDC.value, saveAbility: a.saveDC.ability }
                : {}),
              ...(a.range?.value ? { rangeFt: a.range.value } : {}),
              ...(a.attackRange ? { attackRange: a.attackRange } : {}),
              ...(a.description ? { description: a.description } : {})
            };
          });
          participantPcTriggers[participant.id] = (d.triggers ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            on: t.on,
            ...(t.grants ? { grants: t.grants as { type: string; [k: string]: unknown } } : {})
          }));
          participantPcStats[participant.id] = {
            ac: s.ac,
            hp: s.hp,
            abilities: s.abilities,
            saves: s.saves,
            skills: s.skills,
            senses: s.senses,
            speeds: s.speeds,
            passivePerception: s.passivePerception,
            proficiencyBonus: s.proficiencyBonus,
            totalLevel: s.totalLevel,
            spellSaveDC: s.spellSaveDC,
            spellAttackBonus: s.spellAttackBonus,
            spellcastingAbility: s.spellcastingAbility,
            resistances: s.resistances,
            immunities: s.immunities,
            vulnerabilities: s.vulnerabilities,
            incomingCritImmune: s.incomingCritImmune,
            species: doc.species?.slug ?? null,
            subspecies: doc.subspecies?.slug ?? null
          };
        } catch {
          // derive() throws on malformed docs — skip stats, keep spells/conditions
        }
      } catch {
        // ignore malformed doc
      }
    }

    const allSlugs = Object.values(participantSpells).flat().map(s => s.slug);
    if (allSlugs.length > 0) {
      const spellContent = await db
        .select({ slug: schema.content.slug, name: schema.content.name, data: schema.content.data })
        .from(schema.content)
        .where(and(eq(schema.content.kind, 'spell'), inArray(schema.content.slug, allSlugs)));

      const spellMeta = new Map(spellContent.map(s => {
        let level = 0;
        try {
          const d = JSON.parse(s.data as string) as { level?: number };
          level = d.level ?? 0;
        } catch { /* ignore */ }
        return [s.slug, { name: s.name, level }];
      }));

      for (const [partId, spells] of Object.entries(participantSpells)) {
        participantSpells[partId] = spells.map(s => ({
          ...s,
          name: spellMeta.get(s.slug)?.name ?? s.slug,
          level: spellMeta.get(s.slug)?.level ?? 0
        })).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
      }
    }
  }

  // Monsters from loaded packs — for the "add monster" picker.
  const monsterRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data
    })
    .from(schema.content)
    .where(eq(schema.content.kind, 'monster'));

  const monsterOptions = monsterRows
    .map((r) => {
      const data = JSON.parse(r.data as string) as {
        cr?: string;
        hp?: { max?: number };
        ac?: number;
        type?: string;
        size?: string;
      };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        cr: data.cr ?? '?',
        maxHp: data.hp?.max ?? null,
        ac: data.ac ?? null,
        type: data.type ?? '',
        size: data.size ?? '',
        /** Full parsed monster row, used by the picker's preview panel.
         *  Avoids a per-preview round-trip to /api/content/{kind}/{slug},
         *  which filters by PUBLIC_SOURCES and 404s for monsters from
         *  $GRIMOIRE_PACKS_DIR / scope-restricted packs. */
        data: data as Record<string, unknown>
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    encounter: {
      id: enc.id,
      campaignId: enc.campaignId,
      name: enc.name,
      status: enc.status,
      round: enc.round,
      activeParticipantId: enc.activeParticipantId,
      notesJson: enc.notesJson ?? null,
      createdAt: enc.createdAt.getTime(),
      endedAt: enc.endedAt ? enc.endedAt.getTime() : null
    },
    board: boardRow ? boardWire(boardRow, isDM) : null,
    participantPositions: visibleTokenPositions(
      partRows.filter((p) => isDM || p.kind === 'pc' || !parseReveals(p.revealsJson).hidden),
      boardRow,
      isDM
    ),
    participants: (() => {
      // Always assemble the DM-shaped row first; then for player viewers,
      // redact name/HP/AC/statblock per the reveal flags and drop hidden
      // entries. The label slot ("Enemy 1") is by *visible position* in
      // initiative order, so it stays stable as reveals flip.
      const fullRows = partRows
        .map((p) => {
          const reveals: ParticipantReveals = parseReveals(p.revealsJson);
          const statblock = p.statblockSlug
            ? monsterStatblocks.get(p.statblockSlug) ?? null
            : p.statblockJson
              ? monsterDerive(JSON.parse(p.statblockJson) as Record<string, unknown>)
              : null;
          // PC HP lives on the character document — the participants table
          // intentionally keeps these null. Backfill from the derived stats
          // we already computed so HP display + DM HP widgets work for PCs.
          const pcHp = p.kind === 'pc' ? participantPcStats[p.id]?.hp ?? null : null;
          const currentHp = pcHp ? pcHp.current : p.currentHp;
          const maxHp = pcHp ? pcHp.max : p.maxHp;
          const tempHp = pcHp ? pcHp.temp : p.tempHp;
          // For PCs, prefer the live character.name over the snapshot stored
          // on the participants table (which can go stale after a rename).
          const liveName = p.kind === 'pc' && p.characterId
            ? charNameById.get(p.characterId) ?? p.name
            : p.name;
          return {
            id: p.id,
            encounterId: p.encounterId,
            characterId: p.characterId,
            name: liveName,
            kind: p.kind,
            statblockSlug: p.statblockSlug,
            statblockJson: p.statblockJson ? JSON.parse(p.statblockJson) : null,
            // Slug monsters use the per-slug cache; ad-hoc/inline monsters
            // (statblockJson only) derive theirs directly, so the resolve
            // panel's roll buttons arm for them too.
            statblockActions: p.statblockSlug
              ? statblockActions.get(p.statblockSlug) ?? []
              : (statblock?.actions ?? []).map((a) => ({
                  name: a.name,
                  attackBonus: a.attackBonus,
                  range: a.range,
                  damage: a.damage,
                  description: a.description,
                  saveDC: a.saveDC,
                  saveAbility: a.saveAbility
                })),
            statblock,
            initiative: p.initiative,
            dexScore: dexForParticipant(p),
            currentHp,
            maxHp,
            tempHp,
            conditions: JSON.parse(p.conditionsJson) as string[],
            sortOrder: p.sortOrder,
            reveals,
            hpBucket: hpBucket(currentHp, maxHp),
            // placeholder fills in below after the initiative sort, so
            // "Enemy N" matches the player's visible order.
            placeholderName: p.name
          };
        })
        .sort(initiativeCompare);

      if (isDM) {
        // DM sees everything. placeholderName mirrors the real name — the
        // UI renders `placeholderName ?? name`, and the DM is never meant
        // to see the "Enemy N" redaction (only players do, below).
        for (const r of fullRows) r.placeholderName = r.name;
        return fullRows;
      }

      // Player branch: drop `hidden`; redact per-flag; PC participants
      // (party members) always render fully.
      const visible = fullRows.filter((r) => r.kind === 'pc' || !r.reveals.hidden);
      const nameFor = makePlaceholderNamer();
      return visible.map((r) => {
        if (r.kind === 'pc') {
          return r;
        }
        const placeholder = nameFor(r);
        return {
          ...r,
          name: r.reveals.identity ? r.name : placeholder,
          placeholderName: placeholder,
          statblockSlug: r.reveals.combat ? r.statblockSlug : null,
          statblockJson: r.reveals.combat ? r.statblockJson : null,
          statblockActions: r.reveals.combat ? r.statblockActions : [],
          statblock: r.reveals.combat
            ? r.statblock
            : r.reveals.vitals && r.statblock
              ? // vitals reveals AC only; surface a minimal statblock so the
                // UI can show AC without leaking attacks/traits.
                ({ ac: r.statblock.ac } as MonsterDerived)
              : null,
          // Vitals: exact numbers only when the DM has revealed them. They
          // used to ship regardless, with the display layer responsible for
          // hiding them — so a player could read a monster's HP out of
          // devtools, and the board token's ring was drawn from the real
          // number. `hpBucket` above is the band they're meant to see, and
          // the poll redacts the same way (see the state route).
          currentHp: r.reveals.vitals ? r.currentHp : null,
          maxHp: r.reveals.vitals ? r.maxHp : null,
          tempHp: r.reveals.vitals ? r.tempHp : 0
        };
      });
    })(),
    campaignCharacters: charRows.map((r) => ({ id: r.id, name: r.name })),
    characterLinks,
    party: {
      size: partySize,
      totalLevel: partyLevelSum,
      avgLevel: partyAvgLevel
    },
    monsterOptions,
    participantSpells,
    participantPcConditions,
    participantPcConditionTimers,
    participantPcStats,
    participantPcActions,
    participantPcEconomy,
    myParticipantIds,
    participantPcTriggers,
    participantPcConcentrating,
    participantPcReceivedBuffs,
    participantPlans,
    // First-paint seed for the poll's economy/timers projections. `lair` is
    // stripped for players below (DM-only prep), matching participantLair.
    participantCombatState: Object.fromEntries(
      Object.entries(combatStates).map(([pid, cs]) => [
        pid,
        isDM ? cs : { ...cs, lair: undefined }
      ])
    ),
    // DM-only, mirroring the /state poll: "which creature is legendary /
    // lairing here" is prep, and only DM-gated UI reads it.
    participantLair: isDM
      ? Object.fromEntries(
          Object.entries(combatStates)
            .filter(([, cs]) => cs.lair === true)
            .map(([pid]) => [pid, true])
        )
      : {},
    participantNonPcConcentrating,
    actionLog: redactActionLog(
      logRows.map((r) => ({
        id: r.id,
        round: r.round,
        participantId: r.participantId,
        targetParticipantId: r.targetParticipantId,
        actionId: r.actionId,
        actionLabel: r.actionLabel,
        submittedByUserId: r.submittedByUserId,
        submitterRole: r.submitterRole,
        isAmendment: r.isAmendment,
        amendsLogId: r.amendsLogId,
        attackRoll: r.attackRoll,
        damageRoll: r.damageRoll,
        hit: r.hit,
        targetHpBefore: r.targetHpBefore,
        targetHpAfter: r.targetHpAfter,
        notes: r.notes,
        rollDetail: r.rollDetailJson,
        // `as boolean` so the exported page-data type stays boolean — the
        // redactor below flips this to true for player viewers.
        redacted: false as boolean,
        createdAt: r.createdAt.getTime()
      })),
      logRedaction,
      isDM
    )
  };
}

/** The route-agnostic slice of page data both encounter routes ship. */
export type EncounterPageCoreData = Awaited<ReturnType<typeof buildEncounterPageData>>;

/** What the shared EncounterPage component consumes: the core data plus the
 *  route-provided campaign context and viewer role. Each route's PageData is
 *  a structural superset of this (the campaign object may carry extra keys
 *  like code or dmUsername/slug — links are built by the route wrappers). */
export type EncounterPageData = EncounterPageCoreData & {
  campaign: { name: string };
  role: 'dm' | 'player';
};
