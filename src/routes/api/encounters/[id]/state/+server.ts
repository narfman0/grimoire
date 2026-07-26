import { json, error } from '@sveltejs/kit';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db, schema } from '$lib/server/db';
import { Uuid } from '$lib/server/api/schemas';
import { PlanJson } from '$lib/server/api/encounter-schemas';
import { parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { parseReveals } from '$lib/realtime/reveals';
import { logger } from '$lib/server/logger';
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

export const GET: RequestHandler = async ({ params, locals, request }) => {
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

  const allRows = await db
    .select({
      id: schema.participants.id,
      kind: schema.participants.kind,
      characterId: schema.participants.characterId,
      currentHp: schema.participants.currentHp,
      maxHp: schema.participants.maxHp,
      tempHp: schema.participants.tempHp,
      conditionsJson: schema.participants.conditionsJson,
      planJson: schema.participants.planJson,
      concentratingJson: schema.participants.concentratingJson,
      revealsJson: schema.participants.revealsJson
    })
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, id));

  // Players never receive hidden participants — the SSR loader filters them
  // out of the page data, and this poll endpoint must apply the same
  // redaction or an open devtools tab reveals the ambush (id, HP, plan).
  const partRows =
    role === 'dm'
      ? allRows
      : allRows.filter((p) => p.kind === 'pc' || !parseReveals(p.revealsJson).hidden);

  // PC HP / temp / conditions / concentration live on the character document,
  // not on the participants row. Loading them per-poll keeps the poll
  // snapshot consistent with the doc — without this, a stale or default
  // value on the participants row would silently override the doc's real
  // values in the client's liveHpMap and the UI would snap back after
  // every mutation. Mirrors the SSR backfill in +page.server.ts.
  const pcCharIds = partRows
    .filter((p) => p.kind === 'pc' && p.characterId)
    .map((p) => p.characterId as string);

  // --- change-token short-circuit (ETag / If-None-Match) -------------------
  // The expensive part of this poll is loading + JSON-parsing character
  // documents (and the per-participant JSON columns). Everything the
  // response depends on is derivable from cheap already-indexed reads:
  //   - encounters.round / activeParticipantId (fetched above for auth),
  //   - the role-filtered participants rows (fetched above; every non-PC
  //     mutation — HP, plan, conditions, concentration, reveals, add /
  //     remove — changes one of the hashed columns),
  //   - max(characters.updated_at) over PC participants (every PC doc
  //     mutation bumps updated_at via PATCH /api/characters),
  //   - the viewer's role — reveals redaction is role-dependent, so a DM
  //     token must never validate a player's cached variant (and hashing
  //     the post-filter rows means hidden-participant churn doesn't even
  //     invalidate player caches).
  // If the client's If-None-Match matches, return 304 before touching the
  // character documents.
  let pcDocsUpdatedMax = 0;
  if (pcCharIds.length > 0) {
    const [agg] = await db
      .select({ max: sql<number | null>`max(${schema.characters.updatedAt})` })
      .from(schema.characters)
      .where(inArray(schema.characters.id, pcCharIds));
    pcDocsUpdatedMax = Number(agg?.max ?? 0);
  }
  const token = createHash('sha1')
    .update(
      JSON.stringify([
        role,
        enc.round,
        enc.activeParticipantId ?? null,
        pcDocsUpdatedMax,
        // Sort for a deterministic hash — SQLite row order is unspecified.
        [...partRows].sort((a, b) => (a.id < b.id ? -1 : 1))
      ])
    )
    .digest('hex');
  const etag = `"${token}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

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
      } catch (err) {
        // best-effort: skip malformed doc, but leave a trail
        logger.warn({ err, encounterId: id, characterId: r.id }, 'state poll: malformed character document');
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
      } catch (err) {
        // best-effort: drop malformed plan, but leave a trail
        logger.warn({ err, encounterId: id, participantId: p.id }, 'state poll: malformed plan_json');
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
      } catch (err) {
        // best-effort: drop malformed conditions, but leave a trail
        logger.warn({ err, encounterId: id, participantId: p.id }, 'state poll: malformed conditions_json');
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
      } catch (err) {
        // best-effort: drop malformed concentration, but leave a trail
        logger.warn({ err, encounterId: id, participantId: p.id }, 'state poll: malformed concentrating_json');
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

  return json(body, { headers: { etag } });
};

export const _openapi = {
  GET: {
    summary:
      'Fetch the live encounter snapshot (round, turn, HP, plans) for polling. Sets an ETag; send If-None-Match to get a bodyless 304 when nothing changed.',
    response: EncounterStateResponse
  }
} as const;
