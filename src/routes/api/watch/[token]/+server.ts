// Spectator poll — the ONLY unauthenticated read of campaign state. The
// token is the credential: 128 random bits the DM can regenerate or revoke
// (see $lib/server/spectator-token). What it returns is the party dashboard,
// which is built through the player lens unconditionally — a spectator sees
// exactly what a player in the campaign sees, never more.

import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { PartyDashboardResponse, SpectatorToken } from '$lib/server/api/schemas';
import { parseParams } from '$lib/server/api/validate';
import { isRateLimited } from '$lib/server/auth/rate-limit';
import { findCampaignBySpectatorToken } from '$lib/server/spectator-token';
import { buildPartyDashboard, dashboardResponse } from '$lib/server/party-dashboard';
import type { RequestHandler } from './$types';

const Params = z.object({ token: SpectatorToken });

export const GET: RequestHandler = async ({ params, request, getClientAddress }) => {
  const { token } = parseParams(params, Params);
  const campaign = await findCampaignBySpectatorToken(token);
  if (!campaign) {
    // Only misses count against the limit — a valid link polls every 2s and
    // must never be throttled. 128-bit tokens make guessing hopeless anyway;
    // this just keeps a scanner from hammering the LIKE prefilter.
    if (isRateLimited(`watch-miss:${getClientAddress()}`, 30, 15 * 60 * 1000)) {
      throw error(429, 'too many lookups — try again later');
    }
    throw error(404, 'spectator link not found or revoked');
  }
  return dashboardResponse(request, await buildPartyDashboard(campaign));
};

export const _openapi = {
  GET: {
    summary: 'Read-only party dashboard for a spectator link (no login)',
    description:
      'Player-lens snapshot of the campaign: party vitals, AC, conditions, spell slots, inventory, ' +
      'the live encounter strip and recent log. Carries an `ETag`; echo it via `If-None-Match` ' +
      'to get a bodyless 304 when nothing changed. 404 once the DM regenerates or revokes the link.',
    params: Params,
    response: PartyDashboardResponse,
    public: true,
    errors: [
      { status: 304, description: 'Not modified — If-None-Match matched the current ETag' },
      { status: 404, description: 'Unknown or revoked link' },
      { status: 429, description: 'Too many failed lookups' }
    ]
  }
} as const;
