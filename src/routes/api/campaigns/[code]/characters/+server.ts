// Link an existing character into a campaign. The campaign DM (or the
// character's owner) writes a row into campaign_characters; the character
// row itself is untouched.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { handleDbError } from '$lib/server/db/errors';
import { CampaignCode, Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode });
const LinkCharacterRequest = z.object({
  characterId: Uuid,
  role: z.enum(['player', 'guest']).optional().default('player')
});

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);
  const m = await requireMembershipByCode(user, code);

  const body = await parseJson(request, LinkCharacterRequest);

  // The character must belong to the requester. (DMs don't get to drag
  // other players' PCs into their campaign without permission.)
  const charRows = await db
    .select({ id: schema.characters.id, ownerUserId: schema.characters.ownerUserId })
    .from(schema.characters)
    .where(eq(schema.characters.id, body.characterId))
    .limit(1);
  if (charRows.length === 0) throw error(404, 'character not found');
  if (charRows[0].ownerUserId !== user.id) {
    throw error(403, 'you can only link characters you own');
  }

  // Idempotent — if the link already exists, return 200 with no insert;
  // a fresh link returns 201.
  const existing = await db
    .select({ campaignId: schema.campaignCharacters.campaignId })
    .from(schema.campaignCharacters)
    .where(
      and(
        eq(schema.campaignCharacters.campaignId, m.campaignId),
        eq(schema.campaignCharacters.characterId, body.characterId)
      )
    )
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.campaignCharacters).values({
      campaignId: m.campaignId,
      characterId: body.characterId,
      role: body.role,
      addedAt: new Date()
    }).catch((err) => handleDbError(err, 'campaign-characters:link'));
  }

  return json(
    { campaignId: m.campaignId, characterId: body.characterId, role: body.role },
    { status: existing.length === 0 ? 201 : 200 }
  );
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { code } = parseParams({ code: params.code?.toUpperCase() }, Params);
  const m = await requireMembershipByCode(user, code);

  const body = await parseJson(request, z.object({ characterId: Uuid }));

  // Unlink — owner or DM may drop the link. The character row stays.
  const charRows = await db
    .select({ ownerUserId: schema.characters.ownerUserId })
    .from(schema.characters)
    .where(eq(schema.characters.id, body.characterId))
    .limit(1);
  if (charRows.length === 0) throw error(404, 'character not found');
  const isOwner = charRows[0].ownerUserId === user.id;
  const isDm = m.role === 'dm';
  if (!isOwner && !isDm) throw error(403, 'only the owner or DM can unlink');

  await db
    .delete(schema.campaignCharacters)
    .where(
      and(
        eq(schema.campaignCharacters.campaignId, m.campaignId),
        eq(schema.campaignCharacters.characterId, body.characterId)
      )
    );

  return new Response(null, { status: 204 });
};

export const _openapi = {
  POST: {
    summary: 'Link a character into a campaign (idempotent; 200 when already linked)',
    params: Params,
    body: LinkCharacterRequest,
    response: z.object({
      campaignId: Uuid,
      characterId: Uuid,
      role: z.enum(['player', 'guest'])
    }),
    status: 201,
    errors: [{ status: 403, description: 'You can only link characters you own' }, 404]
  },
  DELETE: {
    summary: 'Unlink a character from a campaign (owner or DM)',
    params: Params,
    body: z.object({ characterId: Uuid }),
    status: 204,
    errors: [{ status: 403, description: 'Only the owner or DM can unlink' }, 404]
  }
} as const;
