// Encounter difficulty rating.
//
// The math lives in $lib/rules/encounter-difficulty (pure, tested, 2014 DMG
// budgeting). This route only assembles its two inputs from the database:
// the party's character levels and the monster roster's CR/XP.
//
// Why a dedicated endpoint rather than a field on the encounter page load:
// the page loader (src/lib/server/encounter-page.ts) is a shared, heavily
// contended file, and the rating is DM-only advisory data the page can fetch
// lazily. Wiring it into the page is a follow-up.
//
// DM only: the rating is computed over the *full* roster, hidden monsters
// included, so handing it to players would leak the shape of an ambush the
// reveal flags are specifically hiding.

import { json, error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { Uuid } from '$lib/server/api/schemas';
import { EncounterDifficulty } from '$lib/server/api/responses';
import { parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { logger } from '$lib/server/logger';
import {
  encounterDifficulty,
  type DifficultyMonsterInput
} from '$lib/rules/encounter-difficulty';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

/** Pull `cr` / `xp` out of a raw statblock payload. Both are optional and
 *  both shapes ("1/4" vs 0.25, missing xp) are handled downstream by
 *  encounterDifficulty. */
function crXpFrom(data: unknown): { cr: number | string | null; xp: number | null } {
  if (!data || typeof data !== 'object') return { cr: null, xp: null };
  const d = data as { cr?: unknown; xp?: unknown };
  return {
    cr: typeof d.cr === 'number' || typeof d.cr === 'string' ? d.cr : null,
    xp: typeof d.xp === 'number' ? d.xp : null
  };
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = requireUser(locals);
  const { id } = parseParams(params, Params);

  const encRows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, id))
    .limit(1);
  const enc = encRows[0];
  if (!enc) throw error(404, 'encounter not found');

  const role = await getMembershipByCampaignId(user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can see the difficulty rating');

  const partRows = await db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, enc.id));

  // ---- Party: total character level per linked PC ------------------------
  const charIds = Array.from(
    new Set(partRows.map((p) => p.characterId).filter((c): c is string => !!c))
  );
  const partyLevels: number[] = [];
  if (charIds.length > 0) {
    // Characters belong to campaigns through campaign_characters, never the
    // characters.campaignId soft pointer.
    const charRows = await db
      .select({ id: schema.characters.id, document: schema.characters.document })
      .from(schema.characters)
      .innerJoin(
        schema.campaignCharacters,
        eq(schema.campaignCharacters.characterId, schema.characters.id)
      )
      .where(
        and(
          eq(schema.campaignCharacters.campaignId, enc.campaignId),
          inArray(schema.characters.id, charIds)
        )
      );
    for (const r of charRows) {
      if (!r.document) continue;
      try {
        const doc = JSON.parse(r.document) as { classes?: Array<{ level?: number }> };
        const total = (doc.classes ?? []).reduce((s, c) => s + (c.level ?? 0), 0);
        if (total > 0) partyLevels.push(total);
      } catch (err) {
        logger.warn({ err, characterId: r.id, encounterId: enc.id }, 'unparseable character document; excluded from the encounter budget');
      }
    }
  }

  // ---- Roster: CR/XP per non-PC participant ------------------------------
  const slugs = Array.from(
    new Set(
      partRows
        .filter((p) => p.kind !== 'pc')
        .map((p) => p.statblockSlug)
        .filter((s): s is string => !!s)
    )
  );
  const bySlug = new Map<string, { cr: number | string | null; xp: number | null }>();
  if (slugs.length > 0) {
    const rows = await db
      .select({ slug: schema.content.slug, data: schema.content.data })
      .from(schema.content)
      .where(and(eq(schema.content.kind, 'monster'), inArray(schema.content.slug, slugs)));
    for (const r of rows) {
      try {
        bySlug.set(r.slug, crXpFrom(JSON.parse(r.data as string)));
      } catch (err) {
        logger.warn({ err, slug: r.slug }, 'unparseable monster content row; excluded from the encounter budget');
      }
    }
  }

  const monsters: DifficultyMonsterInput[] = partRows
    .filter((p) => p.kind !== 'pc')
    .map((p) => {
      // Pack statblock first, then the inline ad-hoc JSON for homebrew NPCs.
      let source = p.statblockSlug ? bySlug.get(p.statblockSlug) : undefined;
      if (!source && p.statblockJson) {
        try {
          source = crXpFrom(JSON.parse(p.statblockJson));
        } catch (err) {
          logger.warn({ err, participantId: p.id }, 'unparseable inline statblock; participant counted as unrated');
        }
      }
      return { name: p.name, cr: source?.cr ?? null, xp: source?.xp ?? null };
    });

  const result = encounterDifficulty({ partyLevels, monsters });
  return json({ ...result, partyLevels });
};

export const _openapi: RouteOpenApi = {
  GET: {
    summary: 'Encounter difficulty rating against the linked party (DM only)',
    description:
      'Adjusted XP, party thresholds and the resulting easy/medium/hard/deadly band, using the 2014 DMG encounter-building tables.',
    params: Params,
    response: EncounterDifficulty,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
};
