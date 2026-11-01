// Spectator link management (DM only). The link itself is served by
// GET /api/watch/[token]; this route issues, reads and revokes the token.
// See $lib/server/spectator-token for where it lives and why.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { CampaignCode, SpectatorLink } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import {
  getSpectatorToken,
  revokeSpectatorToken,
  rotateSpectatorToken
} from '$lib/server/spectator-token';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });

async function requireDm(locals: App.Locals, params: Record<string, string>) {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM can manage the spectator link');
  return { user, campaignId: m.campaignId };
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const { campaignId } = await requireDm(locals, params);
  return json({ token: await getSpectatorToken(campaignId) });
};

export const POST: RequestHandler = async ({ params, locals }) => {
  const { user, campaignId } = await requireDm(locals, params);
  const token = await rotateSpectatorToken(campaignId);
  logger.info({ userId: user.id, campaignId }, 'spectator link issued');
  return json({ token });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const { user, campaignId } = await requireDm(locals, params);
  await revokeSpectatorToken(campaignId);
  logger.info({ userId: user.id, campaignId }, 'spectator link revoked');
  return new Response(null, { status: 204 });
};

export const _openapi = {
  GET: {
    summary: 'Read the campaign spectator link token (DM only)',
    params: Params,
    response: SpectatorLink,
    errors: [{ status: 403, description: 'DM only' }, 404]
  },
  POST: {
    summary: 'Issue a new spectator link token, revoking any previous one (DM only)',
    params: Params,
    response: SpectatorLink,
    errors: [{ status: 403, description: 'DM only' }, 404]
  },
  DELETE: {
    summary: 'Revoke the spectator link (DM only)',
    params: Params,
    status: 204,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
} as const;
