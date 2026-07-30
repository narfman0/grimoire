import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { getCampaignPermissions } from '$lib/server/auth/campaign-permissions';
import type { CampaignPermissions } from '$lib/server/auth/campaign-permissions';
import type { Role } from '$lib/server/auth/membership';

/**
 * May this user write player-character state on this participant?
 *
 * One gate for every per-participant player write, differing only in which
 * campaign permission it consults:
 *
 *   editOthersVitals — HP, temp HP, conditions (the character document's
 *     vitals; see $lib/server/encounter/pc-vitals)
 *   planForOthers    — turn plans, token positions and the combat economy,
 *     which are all "what this creature is doing", not "how hurt it is".
 *     The combat-state route used to read `editOthersVitals` instead, so one
 *     user-visible concept answered to two switches.
 *
 * The DM always may. A player may when the campaign allows acting for others
 * — the permissive default — or when they own the linked character.
 *
 * Non-PC rows are DM-only whatever the policy, and that is a *redaction*
 * boundary rather than an ownership one: hidden monsters are redacted out of a
 * player's participant list, so accepting an arbitrary participant id here
 * would let them probe which creatures exist. The check is on `kind`, not on
 * `characterId` alone — an npc/monster row that happens to carry a character
 * link used to fall through to the ownership path and become player-writable,
 * which re-opened exactly that probe.
 *
 * Throws 403 rather than returning a boolean so every call site fails the same
 * way and none of them can forget to check the result.
 */
export async function requireParticipantWriteAccess(
  userId: string,
  role: Role,
  campaignId: string,
  participant: { kind: string; characterId: string | null },
  permission: keyof CampaignPermissions,
  what: string
): Promise<void> {
  if (role === 'dm') return;

  if (participant.kind !== 'pc' || !participant.characterId) {
    throw error(403, `players cannot ${what} for non-PC participants`);
  }

  const perms = await getCampaignPermissions(campaignId);
  if (perms[permission]) return;

  const owned = await db
    .select({ ownerUserId: schema.characters.ownerUserId })
    .from(schema.characters)
    .where(eq(schema.characters.id, participant.characterId))
    .limit(1);
  if (!owned[0] || owned[0].ownerUserId !== userId) {
    throw error(403, 'you do not own this character');
  }
}

/** Vitals writes: HP, temp HP, conditions. */
export async function requireVitalsWriteAccess(
  userId: string,
  role: Role,
  campaignId: string,
  participant: { kind: string; characterId: string | null }
): Promise<void> {
  await requireParticipantWriteAccess(
    userId,
    role,
    campaignId,
    participant,
    'editOthersVitals',
    'edit vitals'
  );
}

/** Plan, position and combat-economy writes. */
export async function requirePlanWriteAccess(
  userId: string,
  role: Role,
  campaignId: string,
  participant: { kind: string; characterId: string | null },
  what: string
): Promise<void> {
  await requireParticipantWriteAccess(
    userId,
    role,
    campaignId,
    participant,
    'planForOthers',
    what
  );
}
