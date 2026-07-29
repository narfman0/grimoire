import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { getCampaignPermissions } from '$lib/server/auth/campaign-permissions';
import type { Role } from '$lib/server/auth/membership';

/**
 * May this user write vitals (HP, temp HP, conditions) for this participant?
 *
 * The DM always may. A player may when the campaign allows acting for others
 * — the permissive default — or when they own the linked character.
 *
 * Throws 403 rather than returning a boolean so every call site fails the same
 * way and none of them can forget to check the result.
 */
export async function requireVitalsWriteAccess(
  userId: string,
  role: Role,
  campaignId: string,
  participant: { characterId: string | null }
): Promise<void> {
  if (role === 'dm') return;

  // Non-PC rows are DM-only regardless of policy: hidden monsters are
  // redacted out of a player's participant list, and accepting an arbitrary
  // id here would let them probe which creatures exist — and edit their HP.
  if (!participant.characterId) {
    throw error(403, 'players cannot edit vitals for non-PC participants');
  }

  const perms = await getCampaignPermissions(campaignId);
  if (perms.editOthersVitals) return;

  const owned = await db
    .select({ ownerUserId: schema.characters.ownerUserId })
    .from(schema.characters)
    .where(eq(schema.characters.id, participant.characterId))
    .limit(1);
  if (!owned[0] || owned[0].ownerUserId !== userId) {
    throw error(403, 'you do not own this character');
  }
}
