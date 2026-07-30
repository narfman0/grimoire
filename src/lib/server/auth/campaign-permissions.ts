import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';

// Per-campaign table permissions.
//
// Grimoire used to gate every mutation on ownership: only the character's
// owner could log its actions or broadcast its plan, and PC vitals could not
// be written by anyone at all (the participants HP/conditions routes returned
// 400 for PC rows, so not even the DM could apply damage server-side).
//
// That is the wrong default for a table of friends. The requested model is
// **permissive by default** — anyone in the campaign can roll, act, or adjust
// HP for anyone else — with the DM able to tighten it per campaign.
//
// Membership stays the outer boundary. `requireEncounter` /
// `requireParticipantAccess` still 403 non-members, and "permissive" always
// means *within an approved campaign*, never public.
//
// Deliberately NOT covered: `PATCH /api/characters/[id]`, the full character
// document write, which stays owner-or-DM. Letting the table adjust each
// other's HP mid-fight is a different decision from letting anyone rewrite
// another player's class, feats and inventory, and nothing in the request
// implies the second. Widening that is a one-line addition here and should be
// an explicit choice.
//
// Overrides live in `campaigns.permissions_json` (migration 0009). NULL means
// "all defaults", so the column changed nothing on the day it landed and needs
// no backfill; only keys a DM has actually flipped are stored, so adding a
// permission later also needs no backfill. Every call site reads the policy
// through this module, so the column landing touched only this file.

// Scope: these permissions govern who may act on **player characters**. Non-PC
// participants stay DM-only regardless, and that is a redaction boundary
// rather than an ownership one — hidden monsters are redacted out of a
// player's participant list, so letting a player address an arbitrary
// participant id would let them probe which creatures exist. "Anyone can roll
// for any player" does not imply "any player can run the monsters".

export interface CampaignPermissions {
  /** Submit action-log entries / resolve actions for a PC the actor doesn't
   *  own. */
  actForOthers: boolean;
  /** Adjust another PC's HP, temp HP and conditions. PC vitals live on the
   *  character document, so this is a scoped document write (see
   *  $lib/server/encounter/pc-vitals). */
  editOthersVitals: boolean;
  /** Broadcast or clear another PC's plan. */
  planForOthers: boolean;
}

export const PERMISSIVE_DEFAULTS: Readonly<CampaignPermissions> = Object.freeze({
  actForOthers: true,
  editOthersVitals: true,
  planForOthers: true
});

/** Parse a stored overrides blob over the defaults. Unknown keys are ignored
 *  and non-boolean values are discarded rather than coerced — a corrupt or
 *  hand-edited column must not be able to *remove* a capability by accident,
 *  so anything we can't read falls back to allow. */
export function mergePermissions(raw: string | null | undefined): CampaignPermissions {
  const merged: CampaignPermissions = { ...PERMISSIVE_DEFAULTS };
  if (!raw) return merged;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return merged;
  }
  if (!parsed || typeof parsed !== 'object') return merged;
  for (const key of Object.keys(merged) as Array<keyof CampaignPermissions>) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === 'boolean') merged[key] = value;
  }
  return merged;
}

/** The effective permissions for a campaign. */
export async function getCampaignPermissions(
  campaignId: string
): Promise<CampaignPermissions> {
  const rows = await db
    .select({ permissionsJson: schema.campaigns.permissionsJson })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  // A campaign that doesn't exist can't be acted on anyway — the membership
  // check upstream will have thrown. Defaults keep this total.
  return mergePermissions(rows[0]?.permissionsJson);
}
