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
import { monsterDerive, type MonsterDerived } from '$lib/rules/monster-derive';
import { hpBucket, parseReveals, type ParticipantReveals } from '$lib/realtime/reveals';
import { initiativeCompare, makePlaceholderNamer } from '$lib/realtime/participants';
import { derive } from '$lib/rules';
import type { ActionCost, CharacterDocument, ContentLookup } from '$lib/rules/types';
import { buildContentLookup, serializeDerived } from '$lib/server/content/lookup';

export async function buildEncounterPageData(
  campaign: { id: string },
  encounterId: string,
  isDM: boolean
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
    Array<{ name: string; attackBonus?: number; range?: string; damage?: Array<{ dice: string; type: string }> }>
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
          damage: a.damage
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

  // M3.5b: action log entries for this encounter — chronological.
  const logRows = await db
    .select()
    .from(schema.actionLog)
    .where(eq(schema.actionLog.encounterId, enc.id))
    .orderBy(schema.actionLog.createdAt);

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
   *  the encounter UI, not just on the character sheet. */
  type PcActionChoice = { id: string; name: string; cost: ActionCost; attackCount?: number };
  const participantPcActions: Record<string, PcActionChoice[]> = {};
  /** Derived trigger list per PC participant — drives the reaction queue so
   *  the DM is prompted when a PC trigger fires during turn resolution. */
  type PcTriggerChoice = { id: string; name: string; on: string[] };
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
  /** Persisted concentration target per non-PC participant. PC concentration
   *  lives on the character document and rides through participantPcConcentrating
   *  below. */
  const participantNonPcConcentrating: Record<string, { label: string; sinceRound?: number } | null> = {};
  for (const p of partRows) {
    if (p.planJson) {
      try {
        participantPlans[p.id] = JSON.parse(p.planJson);
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
      if (!participant || !char.document) continue;
      try {
        const doc = JSON.parse(char.document) as CharacterDocument;
        const prepared = new Set(doc.spells?.prepared ?? []);
        const known = doc.spells?.known ?? [];
        participantSpells[participant.id] = known
          .filter(k => prepared.has(k.slug))
          .map(k => ({ slug: k.slug, name: k.slug, level: 0 }));
        participantPcConditions[participant.id] = [...(doc.conditions ?? [])];
        participantPcConcentrating[participant.id] = doc.concentrating ?? null;
        participantPcReceivedBuffs[participant.id] = [...(doc.receivedBuffs ?? [])];
        try {
          const lookup = await lookupForOwner(char.ownerUserId ?? null);
          const d = serializeDerived(derive(doc, lookup));
          const s = d.stats;
          participantPcActions[participant.id] = (d.actions ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            cost: a.cost,
            ...(a.attackCount != null && a.attackCount > 1 ? { attackCount: a.attackCount } : {})
          }));
          participantPcTriggers[participant.id] = (d.triggers ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            on: t.on
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
            statblockActions: p.statblockSlug ? statblockActions.get(p.statblockSlug) ?? [] : [],
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
          // Note: maxHp + currentHp stay shipped to players because the
          // client computes the live HP bucket from them as SSE HP updates
          // flow through. The display layer is responsible for not showing
          // the raw numbers when `reveals.vitals` is false.
          currentHp: r.currentHp,
          maxHp: r.maxHp,
          tempHp: r.tempHp
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
    participantPcStats,
    participantPcActions,
    participantPcTriggers,
    participantPcConcentrating,
    participantPcReceivedBuffs,
    participantPlans,
    participantNonPcConcentrating,
    actionLog: logRows.map((r) => ({
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
      createdAt: r.createdAt.getTime()
    }))
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
