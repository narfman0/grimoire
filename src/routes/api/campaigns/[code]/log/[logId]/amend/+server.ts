// Amend a log note (DM only). Append-only: writes a NEW note row pointing at
// the original via amends_log_id; the original row is never touched.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { AmendLogNoteRequest, CampaignCode, LogEntryCreated, Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { amendNote } from '$lib/server/session-log';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode, logId: Uuid });

export const POST: RequestHandler = async ({ params, locals, request }) => {
  const user = requireUser(locals);
  const { code, logId } = parseParams(
    { code: params.code?.toUpperCase(), logId: params.logId },
    Params
  );
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM can amend log notes');
  const body = await parseJson(request, AmendLogNoteRequest);
  const id = await amendNote({ campaignId: m.campaignId, logId, actorUserId: user.id, text: body.text });
  return json({ id }, { status: 201 });
};

export const _openapi = {
  POST: {
    summary: 'Correct a log note by appending an amending note (DM only)',
    params: Params,
    body: AmendLogNoteRequest,
    response: LogEntryCreated,
    status: 201,
    errors: [
      { status: 400, description: 'Only notes can be amended' },
      { status: 403, description: 'DM only' },
      404
    ]
  }
} as const;
