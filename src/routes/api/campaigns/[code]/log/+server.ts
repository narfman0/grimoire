// Campaign timeline: session_log + combat action_log, newest first.
//
// GET: any approved member. The DM sees private notes and unredacted combat
// rows; players get the player lens (private rows filtered in SQL, combat
// rows redacted exactly like their encounter screen).
// POST: DM adds a free-text note, optionally private, optionally about one
// character. Append-only — corrections go through .../[logId]/amend.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import {
  AddLogNoteRequest,
  CampaignCode,
  LogEntryCreated,
  TimelineList,
  TimelineQuery
} from '$lib/server/api/schemas';
import { parseJson, parseParams, parseSearch } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { loadTimeline } from '$lib/server/timeline';
import { addNote } from '$lib/server/session-log';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });

export const GET: RequestHandler = async ({ params, locals, url }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);
  const m = await requireMembershipByCode(user, code);
  const q = parseSearch(url, TimelineQuery);
  const entries = await loadTimeline(m.campaignId, {
    isDM: m.role === 'dm',
    limit: q.limit,
    characterId: q.characterId,
    before: q.before
  });
  return json({ entries });
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM can add log notes');
  const body = await parseJson(request, AddLogNoteRequest);
  if (body.characterId) {
    const linked = await db
      .select({ id: schema.campaignCharacters.characterId })
      .from(schema.campaignCharacters)
      .where(
        and(
          eq(schema.campaignCharacters.campaignId, m.campaignId),
          eq(schema.campaignCharacters.characterId, body.characterId)
        )
      )
      .limit(1);
    if (linked.length === 0) throw error(400, 'character is not in this campaign');
  }
  const id = await addNote({
    campaignId: m.campaignId,
    actorUserId: user.id,
    text: body.text,
    isPrivate: body.isPrivate,
    characterId: body.characterId ?? null
  });
  return json({ id }, { status: 201 });
};

export const _openapi = {
  GET: {
    summary: 'Campaign timeline: session log + combat log, newest first',
    description:
      'HP, conditions, death saves, spell slots / resources, rests, inventory, levels and DM notes, ' +
      'folded with combat action-log rows. Players never receive private notes; combat rows are ' +
      'redacted per the encounter reveal flags. Page with `before` (ms cursor).',
    params: Params,
    query: TimelineQuery,
    response: TimelineList,
    errors: [401, 403]
  },
  POST: {
    summary: 'Add a free-text DM note to the campaign log (DM only)',
    params: Params,
    body: AddLogNoteRequest,
    response: LogEntryCreated,
    status: 201,
    errors: [{ status: 400, description: 'Character not in this campaign' }, { status: 403, description: 'DM only' }]
  }
} as const;
