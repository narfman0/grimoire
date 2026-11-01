// Dex score per participant — the initiative tiebreaker fed to
// initiativeCompare ($lib/realtime/participants). Every surface that orders
// a participant list for a viewer must agree on it, or the "Enemy N"
// placeholder numbering (assigned by visible position) drifts between them.
// Shared by the encounter poll and the party dashboard.

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { monsterDerive } from '$lib/rules/monster-derive';
import { logger } from '$lib/server/logger';

/** Dex by monster content slug, for the slugs given. Malformed rows are
 *  skipped (they fall back to 10 in participantDex). */
export async function loadMonsterDex(slugs: Iterable<string>): Promise<Map<string, number>> {
  const unique = Array.from(new Set(slugs));
  const out = new Map<string, number>();
  if (unique.length === 0) return out;
  const rows = await db
    .select({ slug: schema.content.slug, data: schema.content.data })
    .from(schema.content)
    .where(and(eq(schema.content.kind, 'monster'), inArray(schema.content.slug, unique)));
  for (const r of rows) {
    try {
      const derived = monsterDerive(JSON.parse(r.data as string) as Record<string, unknown>);
      out.set(r.slug, derived.abilityScores.dex);
    } catch (err) {
      logger.warn({ err, slug: r.slug }, 'participant dex: malformed monster content');
    }
  }
  return out;
}

export function participantDex(
  p: { characterId: string | null; statblockSlug: string | null; statblockJson: string | null },
  charDocs: Map<string, Record<string, unknown>>,
  monsterDex: Map<string, number>
): number {
  if (p.characterId) {
    const dex = (charDocs.get(p.characterId)?.abilityScores as { dex?: number } | undefined)?.dex;
    return typeof dex === 'number' ? dex : 10;
  }
  if (p.statblockSlug) return monsterDex.get(p.statblockSlug) ?? 10;
  if (p.statblockJson) {
    try {
      const d = JSON.parse(p.statblockJson) as { abilityScores?: { dex?: number } };
      return d.abilityScores?.dex ?? 10;
    } catch {
      // fall through
    }
  }
  return 10;
}
