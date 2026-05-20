import { json, error } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
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
      characterId: schema.participants.characterId,
      currentHp: schema.participants.currentHp,
      maxHp: schema.participants.maxHp,
      tempHp: schema.participants.tempHp,
      conditionsJson: schema.participants.conditionsJson,
      planJson: schema.participants.planJson,
      concentratingJson: schema.participants.concentratingJson
    })
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, id));

  // PC HP / temp / conditions / concentration live on the character document,
  // not on the participants row. Loading them per-poll keeps the poll
  // snapshot consistent with the doc — without this, a stale or default
  // value on the participants row would silently override the doc's real
  // values in the client's liveHpMap and the UI would snap back after
  // every mutation. Mirrors the SSR backfill in +page.server.ts.
  const pcCharIds = partRows
    .filter((p) => p.kind === 'pc' && p.characterId)
    .map((p) => p.characterId as string);
  const charDocs = new Map<string, Record<string, unknown>>();
  if (pcCharIds.length > 0) {
    const rows = await db
      .select({ id: schema.characters.id, document: schema.characters.document })
      .from(schema.characters)
      .where(inArray(schema.characters.id, pcCharIds));
    for (const r of rows) {
      if (!r.document) continue;
      try {
        charDocs.set(r.id, JSON.parse(r.document) as Record<string, unknown>);
      } catch {
        // skip malformed doc
      }
    }
  }

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

    // PC HP / temp / conditions / concentration come from the char doc.
    // For a stub PC (linked character has no document yet), HP stays null
    // — the participants row is intentionally not the source of truth for
    // PC HP, and the SSR data has the row of authority for the UI.
    const isPc = p.kind === 'pc' && !!p.characterId;
    const doc = isPc ? charDocs.get(p.characterId as string) : undefined;

    let conditions: string[] = [];
    if (isPc) {
      const c = doc?.conditions;
      if (Array.isArray(c)) conditions = c as string[];
    } else {
      try {
        const parsed = JSON.parse(p.conditionsJson);
        if (Array.isArray(parsed)) conditions = parsed as string[];
      } catch {
        // ignore malformed json on the participants row
      }
    }

    let concentrating: { label: string; sinceRound?: number } | null = null;
    if (isPc) {
      const c = doc?.concentrating;
      if (c && typeof c === 'object' && 'label' in c) {
        concentrating = c as { label: string; sinceRound?: number };
      }
    } else if (p.concentratingJson) {
      try {
        concentrating = JSON.parse(p.concentratingJson);
      } catch {
        // ignore
      }
    }

    let currentHp: number | null;
    let tempHp: number;
    let maxHp: number | null;
    if (isPc) {
      currentHp = doc && typeof doc.currentHp === 'number' ? (doc.currentHp as number) : null;
      tempHp = doc && typeof doc.tempHp === 'number' ? (doc.tempHp as number) : 0;
      // maxHp requires running derive(); the client already has it via SSR
      // (data.participants[].maxHp), so omit here.
      maxHp = null;
    } else {
      currentHp = p.currentHp ?? null;
      tempHp = p.tempHp ?? 0;
      maxHp = p.maxHp ?? null;
    }

    participantHp[p.id] = { currentHp, tempHp, maxHp, conditions, concentrating };
  }

  const body: TEncounterStateResponse = {
    round: enc.round,
    activeParticipantId: enc.activeParticipantId ?? null,
    plans,
    participantHp
  };

  return json(body);
};
