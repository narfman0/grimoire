import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { Uuid } from '$lib/server/api/schemas';
import { PlanJson } from '$lib/server/api/encounter-schemas';
import { parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

// ---------------------------------------------------------------------------
// Response schema (Zod) — mirrors EncounterSnapshot from encounter-channel.ts
// ---------------------------------------------------------------------------

const ParticipantHpSchema = z.object({
  currentHp: z.number().int().nullable(),
  tempHp: z.number().int().nonnegative(),
  maxHp: z.number().int().nullable(),
  conditions: z.array(z.string()),
  concentrating: z
    .union([
      z.object({ label: z.string(), sinceRound: z.number().int().nonnegative().optional() }),
      z.boolean(),
      z.null()
    ])
    .nullable()
    .optional()
});

const EncounterStateResponse = z.object({
  round: z.number().int().nonnegative(),
  activeParticipantId: Uuid.nullable(),
  plans: z.record(z.string(), PlanJson.nullable()),
  participantHp: z.record(z.string(), ParticipantHpSchema)
});

export type TEncounterStateResponse = z.infer<typeof EncounterStateResponse>;

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);

  const encRows = await db
    .select({ campaignId: schema.encounters.campaignId, round: schema.encounters.round, activeParticipantId: schema.encounters.activeParticipantId })
    .from(schema.encounters)
    .where(eq(schema.encounters.id, id))
    .limit(1);
  const enc = encRows[0];
  if (!enc) throw error(404, 'encounter not found');

  const role = await getMembershipByCampaignId(locals.user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');

  const partRows = await db
    .select({
      id: schema.participants.id,
      kind: schema.participants.kind,
      currentHp: schema.participants.currentHp,
      maxHp: schema.participants.maxHp,
      tempHp: schema.participants.tempHp,
      conditionsJson: schema.participants.conditionsJson,
      planJson: schema.participants.planJson,
      concentratingJson: schema.participants.concentratingJson
    })
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, id));

  const plans: Record<string, z.infer<typeof PlanJson> | null> = {};
  const participantHp: Record<string, z.infer<typeof ParticipantHpSchema>> = {};

  for (const p of partRows) {
    // Plans
    if (p.planJson) {
      try {
        const parsed = PlanJson.safeParse(JSON.parse(p.planJson));
        if (parsed.success) plans[p.id] = parsed.data;
      } catch {
        // ignore malformed plan
      }
    }

    // HP + conditions + concentration
    let conditions: string[] = [];
    try {
      const parsed = JSON.parse(p.conditionsJson);
      if (Array.isArray(parsed)) conditions = parsed as string[];
    } catch {
      // ignore
    }

    let concentrating: { label: string; sinceRound?: number } | null = null;
    if (p.kind !== 'pc' && p.concentratingJson) {
      try {
        concentrating = JSON.parse(p.concentratingJson);
      } catch {
        // ignore
      }
    }

    participantHp[p.id] = {
      currentHp: p.currentHp ?? null,
      tempHp: p.tempHp ?? 0,
      maxHp: p.maxHp ?? null,
      conditions,
      concentrating
    };
  }

  const body: TEncounterStateResponse = {
    round: enc.round,
    activeParticipantId: enc.activeParticipantId ?? null,
    plans,
    participantHp
  };

  return json(body);
};
