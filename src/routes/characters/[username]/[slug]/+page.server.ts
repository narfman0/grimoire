import { error, redirect } from '@sveltejs/kit';
import {
  requireCharacterViewAccess,
  resolveCharacterByOwnerAndSlug
} from '$lib/server/auth/membership';
import { buildCharacterPageData } from '$lib/server/character-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');

  // Resolve /characters/<username>/<slug> → character. The sheet is campaign-
  // agnostic; combat context (live encounter) is auto-detected by the core.
  const character = await resolveCharacterByOwnerAndSlug(params.username, params.slug);
  if (!character) throw error(404, 'character not found');

  // Authorize: owner/admin (edit) or any approved co-member of a campaign the
  // character is linked to (view-only). Throws 401/403 otherwise.
  const access = await requireCharacterViewAccess(locals.user, {
    id: character.id,
    ownerUserId: character.ownerUserId
  });

  const { isDM, data } = await buildCharacterPageData(character, {
    kind: 'global',
    userId: locals.user.id,
    canSeeAllCampaigns: access.canEdit,
    sharedCampaignIds: access.sharedCampaignIds
  });

  return {
    user: locals.user,
    canEdit: access.canEdit,
    role: isDM ? ('dm' as const) : ('player' as const),
    owner: { username: character.ownerUsername },
    ...data
  };
};
