// Shared request guards for API handlers. These consolidate the
// login/membership/participant preambles that were previously copy-pasted
// per route (with divergent policies — see the 2026-07-26 authz audit).

import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { getMembershipByCampaignId, type Role } from '$lib/server/auth/membership';
import type { SessionUser } from '$lib/server/auth/sessions';

/** Narrow locals.user or throw the canonical 401. */
export function requireUser(locals: { user: SessionUser | null }): SessionUser {
  if (!locals.user) throw error(401, 'login required');
  return locals.user;
}

export interface ParticipantAccess {
  enc: typeof schema.encounters.$inferSelect;
  part: typeof schema.participants.$inferSelect;
  role: Role;
}

/** Load encounter → membership → participant (scoped to the encounter) or
 *  throw 404/403. With `dmOnly`, non-DM members get a 403 — the default for
 *  participant mutations; player-owned exceptions (turn plans) check
 *  character ownership themselves. */
export async function requireParticipantAccess(
  userId: string,
  encounterId: string,
  participantId: string,
  opts: { dmOnly?: boolean } = {}
): Promise<ParticipantAccess> {
  const rows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);
  const enc = rows[0];
  if (!enc) throw error(404, 'encounter not found');
  const role = await getMembershipByCampaignId(userId, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (opts.dmOnly && role !== 'dm') {
    throw error(403, 'only the DM can update participants');
  }
  const partRows = await db
    .select()
    .from(schema.participants)
    .where(
      and(
        eq(schema.participants.id, participantId),
        eq(schema.participants.encounterId, encounterId)
      )
    )
    .limit(1);
  const part = partRows[0];
  if (!part) throw error(404, 'participant not in this encounter');
  return { enc, part, role };
}
