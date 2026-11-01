// Quick damage / heal for a party member — the table view's DM control.
//
// Campaign-scoped on purpose: healing caps at the derived max HP, and what
// derive() can see depends on the campaign's content grants. DM-only, like
// the rest of the table view's controls; players adjust their own HP on
// their sheet. Writes go through the scoped vitals writer, which can touch
// HP and nothing else on the document.

import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { CampaignCode, HpDeltaRequest, HpDeltaResponse, Uuid } from '$lib/server/api/schemas';
import { parseJson, parseParams } from '$lib/server/api/validate';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { applyPcHpDelta } from '$lib/server/encounter/pc-vitals';
import type { RequestHandler } from './$types';

const Params = z.object({ code: CampaignCode, id: Uuid });

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { code, id } = parseParams({ code: params.code?.toUpperCase(), id: params.id }, Params);
  const m = await requireMembershipByCode(user, code);
  if (m.role !== 'dm') throw error(403, 'only the DM can adjust HP from the table view');
  const body = await parseJson(request, HpDeltaRequest);

  // Linked via the join table — never the characters.campaignId soft pointer.
  const linked = await db
    .select({ id: schema.campaignCharacters.characterId })
    .from(schema.campaignCharacters)
    .where(
      and(
        eq(schema.campaignCharacters.campaignId, m.campaignId),
        eq(schema.campaignCharacters.characterId, id)
      )
    )
    .limit(1);
  if (linked.length === 0) throw error(404, 'character not in this campaign');

  const delta = body.damage !== undefined ? { damage: body.damage } : { heal: body.heal as number };
  return json(await applyPcHpDelta(id, delta, m.campaignId, user.id));
};

export const _openapi = {
  POST: {
    summary: 'Apply quick damage or healing to a party member (DM only)',
    description:
      'Computed server-side from the stored document: temp HP absorbs damage first (then an active ' +
      'polymorph form), healing caps at derived max HP. Untyped — no resistances are applied.',
    params: Params,
    body: HpDeltaRequest,
    response: HpDeltaResponse,
    errors: [
      { status: 403, description: 'DM only' },
      { status: 404, description: 'Character not linked to this campaign' },
      { status: 409, description: 'Character has no usable document' }
    ]
  }
} as const;
