// DM undo for an HP log entry: set the character's HP and temp HP back to
// what they were before that entry. The write goes through the scoped vitals
// writer and is itself logged as an amends row — the original stays.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { CampaignCode, HpDeltaResponse, Uuid } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { restoreHp } from '$lib/server/session-log';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode, logId: Uuid });

export const POST: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { code, logId } = parseParams(
    { code: params.code?.toUpperCase(), logId: params.logId },
    Params
  );
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM can restore HP from the log');
  return json(await restoreHp({ campaignId: m.campaignId, logId, actorUserId: user.id }));
};

export const _openapi = {
  POST: {
    summary: "Restore a character's HP to before an HP log entry (DM only)",
    params: Params,
    response: HpDeltaResponse,
    errors: [
      { status: 400, description: 'Entry is not an HP change' },
      { status: 403, description: 'DM only' },
      404,
      { status: 409, description: 'Already at that HP, or character left the campaign' }
    ]
  }
} as const;
