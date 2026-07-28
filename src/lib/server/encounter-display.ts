// Shared load core for the two table-mode routes:
//
//   /c/[code]/encounters/[id]/display
//   /campaigns/[dmUsername]/[slug]/encounters/[id]/display
//
// Table mode is a read-only shared screen — projected, or a tablet in the
// middle of the table. Two decisions live here:
//
//  1. Redaction is the PLAYER path, unconditionally. We call
//     buildEncounterPageData(..., isDM=false) even for the DM, so hidden
//     participants never reach the page and unrevealed vitals arrive as
//     buckets. Reusing the loader wholesale (rather than re-deriving the
//     rules here) is deliberate: the action-log leak came from a second
//     implementation of "what may a player see". A consequence worth
//     knowing: a `staging` encounter 404s here for everyone, because that's
//     what the player branch does — table mode is for a fight in progress.
//
//  2. We then narrow to the handful of fields the display renders. The
//     encounter page's payload carries the whole monster catalogue (the add
//     picker), per-PC derived stats, prepared spells and the action log —
//     none of which table mode shows, and the log in particular is exactly
//     the kind of thing you don't want sitting in a shared screen's page
//     data.

import { buildEncounterPageData } from './encounter-page';
import type { DisplayParticipant } from '$lib/encounter/display-list';

export async function buildEncounterDisplayData(
  campaign: { id: string },
  encounterId: string
) {
  const core = await buildEncounterPageData(campaign, encounterId, false);
  const participants: DisplayParticipant[] = core.participants.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    initiative: p.initiative,
    currentHp: p.currentHp,
    maxHp: p.maxHp,
    tempHp: p.tempHp ?? 0,
    conditions: p.conditions,
    reveals: p.reveals
  }));

  return {
    encounter: {
      id: core.encounter.id,
      name: core.encounter.name,
      status: core.encounter.status,
      round: core.encounter.round,
      activeParticipantId: core.encounter.activeParticipantId
    },
    participants
  };
}

/** What the shared EncounterDisplayPage component consumes: the core slice
 *  plus the route-provided campaign context (each route's PageData is a
 *  structural superset — the campaign object carries code or
 *  dmUsername/slug too, and links are built by the route wrappers). */
export type EncounterDisplayData = Awaited<ReturnType<typeof buildEncounterDisplayData>> & {
  campaign: { name: string };
};
