// Action log — audit trail for what happened in combat.
//
// POST appends one row. Player submitters may only log actions for
// participants linked to characters they own.
//
// GET returns the encounter's log in chronological order.
//
// Corrections (DM amendments) are PATCH on the per-entry endpoint at
// /api/encounters/[id]/log/[logId]; deletions are DELETE on the same.
// Previous versions appended new "amendment" rows referencing the prior
// entry — that produced noisy logs, so amendments now overwrite the
// original instead. Legacy isAmendment / amendsLogId columns survive on
// the schema for backwards compat with rows written under the old flow.

import { json, error } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, schema } from '$lib/server/db';
import { SubmitActionLogRequest } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams, parseSearch } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { logger } from '$lib/server/logger';
import {
  buildTriggerEventsFromLog,
  makeFactionContext
} from '$lib/server/encounter/log-triggers';
import { matchTriggers } from '$lib/server/encounter/triggers';
import { loadEncounterTriggerContext } from '$lib/server/encounter/load-participant-triggers';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

// Pagination for GET. `entries` stays chronological (createdAt asc) and the
// envelope keeps its historical key, so pre-pagination consumers that read
// `body.entries` still work; `total` tells them whether they got everything.
// Combat logs are short (hundreds of rows at the very worst), so the 200
// default effectively preserves "full history" for real encounters while
// bounding the response for pathological ones.
const LogListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0)
});

function serialize(r: typeof schema.actionLog.$inferSelect) {
  return {
    id: r.id,
    encounterId: r.encounterId,
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
  };
}

async function requireEncounter(userId: string, encounterId: string) {
  const enc = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  if (enc.length === 0) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc[0].campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  return { enc: enc[0], role };
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id: encounterId } = parseParams(params, Params);
  const { limit, offset } = parseSearch(url, LogListQuery);
  await requireEncounter(locals.user.id, encounterId);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.actionLog)
    .where(eq(schema.actionLog.encounterId, encounterId));
  const rows = await db
    .select()
    .from(schema.actionLog)
    .where(eq(schema.actionLog.encounterId, encounterId))
    .orderBy(asc(schema.actionLog.createdAt))
    .limit(limit)
    .offset(offset);
  return json({ entries: rows.map(serialize), total: Number(total), limit, offset });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id: encounterId } = parseParams(params, Params);
  const { enc, role } = await requireEncounter(locals.user.id, encounterId);

  const body = await parseJson(request, SubmitActionLogRequest);

  // Players may only act for participants tied to characters they own.
  if (role === 'player' && body.participantId) {
    const part = await db
      .select({
        characterId: schema.participants.characterId,
        encounterId: schema.participants.encounterId
      })
      .from(schema.participants)
      .where(eq(schema.participants.id, body.participantId))
      .limit(1);
    if (part.length === 0 || part[0].encounterId !== encounterId) {
      throw error(400, 'participant not in this encounter');
    }
    if (!part[0].characterId) {
      throw error(403, 'cannot log actions for non-pc participants as a player');
    }
    const char = await db
      .select({ ownerUserId: schema.characters.ownerUserId })
      .from(schema.characters)
      .where(eq(schema.characters.id, part[0].characterId))
      .limit(1);
    if (!char[0] || char[0].ownerUserId !== locals.user.id) {
      throw error(403, 'cannot log actions for a character you do not own');
    }
  }

  const row: typeof schema.actionLog.$inferInsert = {
    id: randomUUID(),
    encounterId,
    round: body.round,
    participantId: body.participantId,
    targetParticipantId: body.targetParticipantId ?? null,
    actionId: body.actionId,
    actionLabel: body.actionLabel,
    submittedByUserId: locals.user.id,
    submitterRole: role,
    isAmendment: false,
    amendsLogId: null,
    attackRoll: body.attackRoll ?? null,
    damageRoll: body.damageRoll ?? null,
    hit: body.hit ?? null,
    targetHpBefore: body.targetHpBefore ?? null,
    targetHpAfter: body.targetHpAfter ?? null,
    notes: body.notes ?? null,
    createdAt: new Date()
  };

  await db.insert(schema.actionLog).values(row);
  const stored = await db
    .select()
    .from(schema.actionLog)
    .where(eq(schema.actionLog.id, row.id))
    .limit(1);

  // Trigger consumer wiring (engine gap #2 — see docs/engine-gaps.md).
  // After the row commits, evaluate which trigger declarations on the
  // encounter's participants fire on this log row. We return the
  // matched opportunities on the response so the client can prompt the
  // player; auto-firing grants is a follow-on (the UI does not yet
  // consume `triggerOpportunities`).
  // TODO: surface the returned `triggerOpportunities` in the encounter
  //   page UI as a prompt panel ("Relentless Endurance — use 1/long?").
  let triggerOpportunities: Array<{
    participantId: string;
    triggerId: string;
    triggerName: string;
    sourceContent: { kind: string; slug: string };
    eventName: string;
    grants?: unknown;
    limit?: { per: string; uses: number };
  }> = [];
  try {
    const { triggers, factions } = await loadEncounterTriggerContext(
      encounterId,
      enc.campaignId
    );
    if (triggers.length > 0) {
      const factionCtx = makeFactionContext(factions);
      const events = buildTriggerEventsFromLog(
        {
          participantId: stored[0].participantId,
          targetParticipantId: stored[0].targetParticipantId,
          actionId: stored[0].actionId,
          hit: stored[0].hit,
          damageRoll: stored[0].damageRoll,
          targetHpBefore: stored[0].targetHpBefore,
          targetHpAfter: stored[0].targetHpAfter
        },
        factionCtx
      );
      for (const evt of events) {
        const opps = matchTriggers(triggers, evt);
        for (const o of opps) {
          triggerOpportunities.push({
            participantId: o.participantId,
            triggerId: o.trigger.id,
            triggerName: o.trigger.name,
            sourceContent: o.trigger.sourceContent,
            eventName: evt.name,
            grants: o.trigger.grants,
            limit: o.trigger.limit
          });
        }
      }
    }
  } catch (err) {
    // Trigger evaluation is best-effort; never block the log POST on
    // it. A malformed character doc or content lookup glitch shouldn't
    // prevent the action from being recorded — but it should be visible.
    logger.warn(
      { err, encounterId, logId: row.id, userId: locals.user.id },
      'action log: trigger evaluation failed'
    );
    triggerOpportunities = [];
  }

  return json({ ...serialize(stored[0]), triggerOpportunities }, { status: 201 });
};

export const _openapi = {
  GET: {
    summary:
      'Read the action log for an encounter (chronological). Paginated via ?limit (default 200, max 500) and ?offset; responds { entries, total, limit, offset }.'
  },
  POST: { summary: 'Append a resolution to the action log', body: SubmitActionLogRequest }
} as const;
