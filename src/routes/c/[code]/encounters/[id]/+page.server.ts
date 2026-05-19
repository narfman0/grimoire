import { error, redirect } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { monsterDerive, type MonsterDerived } from '$lib/rules/monster-derive';
import { hpBucket, parseReveals, type ParticipantReveals } from '$lib/realtime/reveals';
import { derive } from '$lib/rules';
import type { ActionCost, CharacterDocument } from '$lib/rules/types';
import { buildContentLookup, serializeDerived } from '$lib/server/content/lookup';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const code = params.code.toUpperCase();
  const m = await requireMembershipByCode(locals.user, code);

  const campaignRows = await db
    .select({ id: schema.campaigns.id, code: schema.campaigns.code, name: schema.campaigns.name })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);
  const campaign = campaignRows[0];

  const encRows = await db
    .select()
    .from(schema.encounters)
    .where(and(eq(schema.encounters.id, params.id), eq(schema.encounters.campaignId, m.campaignId)))
    .limit(1);
  if (encRows.length === 0) throw error(404, 'encounter not found in this campaign');
  const enc = encRows[0];

  // Players can't reach a staging encounter — it's the DM's draft and the
  // name alone can spoil ("Final Boss Room"). 404 mirrors what they see in
  // the encounter list.
  const isDM = m.role === 'dm';
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
      .where(eq(schema.campaignCharacters.campaignId, m.campaignId));
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
  // a per-PC total level.
  const charRows = await db
    .select({
      id: schema.characters.id,
      name: schema.characters.name,
      document: schema.characters.document
    })
    .from(schema.characters)
    .innerJoin(
      schema.campaignCharacters,
      eq(schema.campaignCharacters.characterId, schema.characters.id)
    )
    .where(eq(schema.campaignCharacters.campaignId, m.campaignId));

  /** Live character name by character.id — lets PC participant rows reflect
   *  rename in the character sheet without having to re-sync the snapshot
   *  stored on the participants table. */
  const charNameById = new Map(charRows.map((r) => [r.id, r.name]));

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
        try {
          const { lookup } = await buildContentLookup(char.ownerUserId ?? undefined);
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
            vulnerabilities: s.vulnerabilities
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
        size: data.size ?? ''
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    campaign,
    user: locals.user,
    role: m.role,
    encounter: {
      id: enc.id,
      campaignId: enc.campaignId,
      name: enc.name,
      status: enc.status,
      round: enc.round,
      activeParticipantId: enc.activeParticipantId,
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
        .sort(
          (a, b) =>
            (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity) ||
            b.dexScore - a.dexScore ||
            a.sortOrder - b.sortOrder
        );

      if (isDM) {
        // DM sees everything. Compute placeholders anyway (unused by DM UI)
        // for shape symmetry with the player branch.
        let idx = 0;
        for (const r of fullRows) {
          if (r.kind === 'pc') r.placeholderName = r.name;
          else r.placeholderName = `Enemy ${++idx}`;
        }
        return fullRows;
      }

      // Player branch: drop `hidden`; redact per-flag; PC participants
      // (party members) always render fully.
      const visible = fullRows.filter((r) => r.kind === 'pc' || !r.reveals.hidden);
      let idx = 0;
      return visible.map((r) => {
        if (r.kind === 'pc') {
          return r;
        }
        const placeholder = r.reveals.identity ? r.name : `Enemy ${++idx}`;
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
};
