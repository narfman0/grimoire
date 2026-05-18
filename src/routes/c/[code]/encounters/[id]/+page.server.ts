import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { SESSION_COOKIE } from '$lib/server/auth/sessions';
import { monsterDerive, type MonsterDerived } from '$lib/rules/monster-derive';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
  if (!locals.user) throw redirect(303, '/login');
  const code = params.code.toUpperCase();
  const m = await requireMembershipByCode(locals.user, code);
  // Hocuspocus uses the same session id the HTTP layer reads. httpOnly means
  // client JS can't grab it from document.cookie, so we ship it through page
  // data for the realtime connection (M3.3).
  const syncToken = cookies.get(SESSION_COOKIE) ?? '';

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
    const charRows = await db
      .select({ id: schema.characters.id, document: schema.characters.document })
      .from(schema.characters)
      .where(eq(schema.characters.campaignId, m.campaignId));
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

  // Characters in this campaign — for "add PC" picker and the party-budget
  // summary in the encounter header. Document JSON carries `classes[].level`
  // which we sum into a per-PC total level.
  const charRows = await db
    .select({
      id: schema.characters.id,
      name: schema.characters.name,
      document: schema.characters.document
    })
    .from(schema.characters)
    .where(eq(schema.characters.campaignId, m.campaignId));

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
    syncToken,
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
    participants: partRows
      .map((p) => ({
        id: p.id,
        encounterId: p.encounterId,
        characterId: p.characterId,
        name: p.name,
        kind: p.kind,
        statblockSlug: p.statblockSlug,
        statblockJson: p.statblockJson ? JSON.parse(p.statblockJson) : null,
        statblockActions: p.statblockSlug ? statblockActions.get(p.statblockSlug) ?? [] : [],
        statblock: p.statblockSlug
          ? monsterStatblocks.get(p.statblockSlug) ?? null
          : p.statblockJson
            ? monsterDerive(JSON.parse(p.statblockJson) as Record<string, unknown>)
            : null,
        initiative: p.initiative,
        dexScore: dexForParticipant(p),
        currentHp: p.currentHp,
        maxHp: p.maxHp,
        tempHp: p.tempHp,
        conditions: JSON.parse(p.conditionsJson) as string[],
        sortOrder: p.sortOrder
      }))
      // Initiative tiebreaker per RAW: higher Dex first. Then add-order.
      .sort(
        (a, b) =>
          (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity) ||
          b.dexScore - a.dexScore ||
          a.sortOrder - b.sortOrder
      ),
    campaignCharacters: charRows.map((r) => ({ id: r.id, name: r.name })),
    party: {
      size: partySize,
      totalLevel: partyLevelSum,
      avgLevel: partyAvgLevel
    },
    monsterOptions,
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
