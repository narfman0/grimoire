// Spectator view — no login. The token is the credential; see
// $lib/server/spectator-token. Deliberately ships no campaign code or id in
// page data: the layout links `data.campaign.code`, and a spectator has no
// business learning the join code.

import { error } from '@sveltejs/kit';
import { findCampaignBySpectatorToken, SPECTATOR_TOKEN_RE } from '$lib/server/spectator-token';
import { buildPartyDashboard } from '$lib/server/party-dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  setHeaders({ 'x-robots-tag': 'noindex', 'cache-control': 'private, no-cache' });
  const campaign = SPECTATOR_TOKEN_RE.test(params.token)
    ? await findCampaignBySpectatorToken(params.token)
    : null;
  if (!campaign) throw error(404, 'This spectator link is not valid any more — ask the DM for a new one.');
  return {
    token: params.token,
    dashboard: await buildPartyDashboard(campaign),
    wide: true
  };
};
