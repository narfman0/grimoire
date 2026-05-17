import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const code = params.code.toUpperCase();
  const m = await requireMembershipByCode(locals.user, code);

  const campaignRows = await db
    .select({ id: schema.campaigns.id, code: schema.campaigns.code, name: schema.campaigns.name })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);
  const campaign = campaignRows[0];

  const encRows = await db
    .select()
    .from(schema.encounters)
    .where(and(eq(schema.encounters.id, params.id), eq(schema.encounters.campaignId, m.campaignId)))
    .limit(1);
  if (encRows.length === 0) throw error(404, 'encounter not found in this campaign');
  const enc = encRows[0];

  const partRows = await db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, enc.id));

  // Characters in this campaign — for "add PC" picker in M3.2
  const charRows = await db
    .select({
      id: schema.characters.id,
      name: schema.characters.name
    })
    .from(schema.characters)
    .where(eq(schema.characters.campaignId, m.campaignId));

  return {
    campaign,
    user: locals.user,
    role: m.role,
    encounter: {
      id: enc.id,
      campaignId: enc.campaignId,
      name: enc.name,
      status: enc.status,
      round: enc.round,
      activeParticipantId: enc.activeParticipantId,
      createdAt: enc.createdAt.getTime(),
      endedAt: enc.endedAt ? enc.endedAt.getTime() : null
    },
    participants: partRows
      .map((p) => ({
        id: p.id,
        encounterId: p.encounterId,
        characterId: p.characterId,
        name: p.name,
        kind: p.kind,
        statblockSlug: p.statblockSlug,
        statblockJson: p.statblockJson ? JSON.parse(p.statblockJson) : null,
        initiative: p.initiative,
        currentHp: p.currentHp,
        maxHp: p.maxHp,
        tempHp: p.tempHp,
        conditions: JSON.parse(p.conditionsJson) as string[],
        sortOrder: p.sortOrder
      }))
      .sort((a, b) => (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity) || a.sortOrder - b.sortOrder),
    campaignCharacters: charRows
  };
};
