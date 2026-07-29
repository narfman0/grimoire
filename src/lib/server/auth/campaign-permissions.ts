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
// The per-campaign override needs a `campaigns.permissions_json` column, which
// is migration-gated (see docs/proposals/dice-roller.md phase 8b). Until then
// this returns the defaults for every campaign — which is exactly the
// behaviour the override's "absent means defaults" semantics will preserve, so
// the migration is a no-op on the day it lands. Call sites read the policy
// through this module from the start, so wiring the column changes only what
// happens inside `getCampaignPermissions`.

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

/**
 * The effective permissions for a campaign.
 *
 * Async and taking a campaign id even though it currently consults nothing:
 * the signature is the one phase 8b needs, so adding the column later touches
 * this function and nothing else.
 */
export async function getCampaignPermissions(
  _campaignId: string
): Promise<CampaignPermissions> {
  return { ...PERMISSIVE_DEFAULTS };
}
