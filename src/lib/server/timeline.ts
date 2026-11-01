// Campaign timeline — session_log rows and the combat action_log folded into
// one newest-first feed. Backs the campaign page's Log tab and the recent
// log on the party dashboard (spectator + table view).
//
// Redaction is per viewer and delegated, never re-implemented:
//   combat rows   → redactActionLog / buildLiveParticipantList (player lens
//                   unless isDM), exactly as the encounter screens do
//   session rows  → private rows are filtered in SQL for non-DM viewers, so
//                   they never leave the database for a player or spectator.

import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { buildLiveParticipantList } from '$lib/realtime/participants';
import { parseReveals } from '$lib/realtime/reveals';
import { buildRedactionMap, redactActionLog } from '$lib/realtime/action-log';
import { serializeActionLogEntry } from '$lib/server/serializers';
import { loadMonsterDex, participantDex } from '$lib/server/encounter/participant-dex';
import { describeCombatEntry } from '$lib/dashboard/describe';
import type { TimelineEntry } from '$lib/dashboard/types';

export interface TimelineQuery {
  isDM: boolean;
  limit: number;
  /** Only entries about this character. */
  characterId?: string;
  /** Cursor: only entries strictly older than this (ms). */
  before?: number;
}

type Label = { name: string; characterId: string | null };

async function combatEntries(campaignId: string, q: TimelineQuery): Promise<TimelineEntry[]> {
  const where: SQL[] = [eq(schema.encounters.campaignId, campaignId)];
  if (q.before !== undefined) where.push(lt(schema.actionLog.createdAt, new Date(q.before)));
  if (q.characterId) {
    const mine = await db
      .select({ id: schema.participants.id })
      .from(schema.participants)
      .innerJoin(schema.encounters, eq(schema.encounters.id, schema.participants.encounterId))
      .where(
        and(
          eq(schema.encounters.campaignId, campaignId),
          eq(schema.participants.characterId, q.characterId)
        )
      );
    const ids = mine.map((r) => r.id);
    if (ids.length === 0) return [];
    where.push(
      or(
        inArray(schema.actionLog.participantId, ids),
        inArray(schema.actionLog.targetParticipantId, ids)
      ) as SQL
    );
  }
  const logRows = await db
    .select({ log: schema.actionLog, encounterName: schema.encounters.name })
    .from(schema.actionLog)
    .innerJoin(schema.encounters, eq(schema.encounters.id, schema.actionLog.encounterId))
    .where(and(...where))
    .orderBy(desc(schema.actionLog.createdAt))
    .limit(q.limit);
  if (logRows.length === 0) return [];

  const encounterIds = Array.from(new Set(logRows.map((r) => r.log.encounterId)));
  const parts = await db
    .select({
      id: schema.participants.id,
      encounterId: schema.participants.encounterId,
      kind: schema.participants.kind,
      characterId: schema.participants.characterId,
      name: schema.participants.name,
      initiative: schema.participants.initiative,
      sortOrder: schema.participants.sortOrder,
      statblockSlug: schema.participants.statblockSlug,
      statblockJson: schema.participants.statblockJson,
      revealsJson: schema.participants.revealsJson
    })
    .from(schema.participants)
    .where(inArray(schema.participants.encounterId, encounterIds));

  // PC names track sheet renames; PC docs feed the dex tiebreak so "Enemy N"
  // numbering matches the encounter screen's.
  const pcIds = Array.from(
    new Set(parts.filter((p) => p.characterId).map((p) => p.characterId as string))
  );
  const charNames = new Map<string, string>();
  const charDocs = new Map<string, Record<string, unknown>>();
  if (pcIds.length > 0) {
    const rows = await db
      .select({ id: schema.characters.id, name: schema.characters.name, document: schema.characters.document })
      .from(schema.characters)
      .where(inArray(schema.characters.id, pcIds));
    for (const r of rows) {
      charNames.set(r.id, r.name);
      try {
        if (r.document) charDocs.set(r.id, JSON.parse(r.document));
      } catch {
        // malformed doc → default dex
      }
    }
  }
  const monsterDex = await loadMonsterDex(
    parts.map((p) => p.statblockSlug).filter((s): s is string => !!s)
  );

  const labels = new Map<string, Map<string, Label>>();
  const redaction = new Map<string, ReturnType<typeof buildRedactionMap>>();
  for (const encId of encounterIds) {
    const rows = parts.filter((p) => p.encounterId === encId);
    const list = buildLiveParticipantList(
      rows.map((p) => ({
        id: p.id,
        kind: p.kind,
        characterId: p.characterId,
        name: p.kind === 'pc' && p.characterId ? charNames.get(p.characterId) ?? p.name : p.name,
        initiative: p.initiative,
        dexScore: participantDex(p, charDocs, monsterDex),
        sortOrder: p.sortOrder,
        reveals: parseReveals(p.revealsJson)
      })),
      q.isDM
    );
    labels.set(encId, new Map(list.map((e) => [e.id, { name: e.name, characterId: e.characterId }])));
    redaction.set(
      encId,
      buildRedactionMap(
        rows.map((p) => ({ id: p.id, kind: p.kind, name: p.name, reveals: parseReveals(p.revealsJson) }))
      )
    );
  }

  return logRows.map(({ log: row, encounterName }) => {
    const [entry] = redactActionLog(
      [serializeActionLogEntry(row)],
      redaction.get(row.encounterId) ?? new Map(),
      q.isDM
    );
    const l = labels.get(row.encounterId) ?? new Map<string, Label>();
    const actor = entry.participantId ? l.get(entry.participantId) ?? null : null;
    const target = entry.targetParticipantId ? l.get(entry.targetParticipantId) ?? null : null;
    return {
      id: entry.id,
      at: entry.createdAt,
      source: 'combat' as const,
      kind: 'combat',
      isPrivate: false,
      amendsId: null,
      amendedById: null,
      actorName: null,
      restorable: false,
      characterIds: [actor?.characterId, target?.characterId].filter((x): x is string => !!x),
      summary: describeCombatEntry({
        actor: actor?.name ?? null,
        target: target?.name ?? null,
        actionLabel: entry.actionLabel,
        hit: entry.hit,
        damageRoll: entry.damageRoll
      }),
      encounterName,
      round: entry.round,
      hpBefore: entry.targetHpBefore,
      hpAfter: entry.targetHpAfter,
      redacted: entry.redacted === true
    };
  });
}

function hpOf(detail: unknown): { before: number | null; after: number | null; restorable: boolean } {
  const d = detail as { before?: { currentHp?: unknown; tempHp?: unknown }; after?: { currentHp?: unknown } } | null;
  const b = d?.before?.currentHp;
  const a = d?.after?.currentHp;
  return {
    before: typeof b === 'number' ? b : null,
    after: typeof a === 'number' ? a : null,
    restorable: typeof b === 'number' && typeof d?.before?.tempHp === 'number'
  };
}

async function sessionEntries(campaignId: string, q: TimelineQuery): Promise<TimelineEntry[]> {
  const visibility = q.isDM ? [] : [eq(schema.sessionLog.isPrivate, false)];
  const where: SQL[] = [eq(schema.sessionLog.campaignId, campaignId), ...visibility];
  if (q.characterId) where.push(eq(schema.sessionLog.characterId, q.characterId));
  if (q.before !== undefined) where.push(lt(schema.sessionLog.createdAt, new Date(q.before)));
  const rows = await db
    .select({ row: schema.sessionLog, actorName: schema.users.username })
    .from(schema.sessionLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.sessionLog.actorUserId))
    .where(and(...where))
    .orderBy(desc(schema.sessionLog.createdAt))
    .limit(q.limit);
  if (rows.length === 0) return [];

  // Which of these rows were later corrected? Only corrections the viewer
  // may see count — a private amendment mustn't hint at itself.
  const amenders = await db
    .select({ id: schema.sessionLog.id, amends: schema.sessionLog.amendsLogId })
    .from(schema.sessionLog)
    .where(
      and(
        eq(schema.sessionLog.campaignId, campaignId),
        inArray(
          schema.sessionLog.amendsLogId,
          rows.map((r) => r.row.id)
        ),
        ...visibility
      )
    );
  const amendedBy = new Map(amenders.map((a) => [a.amends as string, a.id]));

  return rows.map(({ row, actorName }) => {
    let detail: unknown = null;
    try {
      detail = row.detailJson ? JSON.parse(row.detailJson) : null;
    } catch {
      detail = null;
    }
    const hp = row.kind === 'hp' ? hpOf(detail) : { before: null, after: null, restorable: false };
    return {
      id: row.id,
      at: row.createdAt.getTime(),
      source: 'session' as const,
      kind: row.kind,
      isPrivate: row.isPrivate,
      amendsId: row.amendsLogId,
      amendedById: amendedBy.get(row.id) ?? null,
      actorName: actorName ?? null,
      restorable: hp.restorable && !!row.characterId,
      characterIds: row.characterId ? [row.characterId] : [],
      summary: row.summary,
      encounterName: null,
      round: null,
      hpBefore: hp.before,
      hpAfter: hp.after,
      redacted: false
    };
  });
}

export async function loadTimeline(campaignId: string, q: TimelineQuery): Promise<TimelineEntry[]> {
  const [combat, session] = await Promise.all([
    combatEntries(campaignId, q),
    sessionEntries(campaignId, q)
  ]);
  return [...combat, ...session].sort((a, b) => b.at - a.at).slice(0, q.limit);
}
