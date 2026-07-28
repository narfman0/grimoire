// Shared per-resource serialize() functions for the REST API.
//
// Each collection route and its per-id sibling used to carry a private copy
// of the same serializer; they drifted apart more than once. The canonical
// wire shapes live here — routes import these instead of redefining them.
//
// The encounter *state* route (/api/encounters/[id]/state) intentionally has
// its own serialization and does not use this module.

import type * as schema from '$lib/server/db/schema';

/** Row shape both character routes select — a projection, not $inferSelect,
 *  because the list route deliberately omits slug/portrait columns. */
export interface CharacterRow {
  id: string;
  campaignId: string | null;
  ownerUserId: string | null;
  name: string;
  document: string | null;
  updatedAt: Date;
}

export function serializeCharacter(r: CharacterRow) {
  return {
    id: r.id,
    campaignId: r.campaignId,
    ownerUserId: r.ownerUserId,
    name: r.name,
    document: r.document ? JSON.parse(r.document) : null,
    updatedAt: r.updatedAt.getTime()
  };
}

export function serializeEncounter(r: typeof schema.encounters.$inferSelect) {
  return {
    id: r.id,
    campaignId: r.campaignId,
    name: r.name,
    status: r.status,
    round: r.round,
    activeParticipantId: r.activeParticipantId,
    createdAt: r.createdAt.getTime(),
    endedAt: r.endedAt ? r.endedAt.getTime() : null
  };
}

export function serializeActionLogEntry(r: typeof schema.actionLog.$inferSelect) {
  return {
    id: r.id,
    encounterId: r.encounterId,
    round: r.round,
    participantId: r.participantId,
    targetParticipantId: r.targetParticipantId,
    actionId: r.actionId,
    actionLabel: r.actionLabel,
    submittedByUserId: r.submittedByUserId,
    submitterRole: r.submitterRole,
    isAmendment: r.isAmendment,
    amendsLogId: r.amendsLogId,
    attackRoll: r.attackRoll,
    damageRoll: r.damageRoll,
    hit: r.hit,
    targetHpBefore: r.targetHpBefore,
    targetHpAfter: r.targetHpAfter,
    notes: r.notes,
    /** Flipped to true by the per-viewer redactor in
     *  $lib/realtime/action-log when a field was withheld from a player.
     *  Always false straight out of the serializer. */
    redacted: false,
    createdAt: r.createdAt.getTime()
  };
}

export function serializeNote(r: typeof schema.notes.$inferSelect) {
  return {
    id: r.id,
    campaignId: r.campaignId,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime()
  };
}

/** Pack wire shape. The collection route reports `rowCount` only; the detail
 *  route also breaks the count down per kind — pass `byKind` to include the
 *  `rowCountByKind` key (omitting it keeps the list payload unchanged). */
export function serializePack(
  p: typeof schema.packs.$inferSelect,
  rowCount: number,
  byKind?: Record<string, number>
) {
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    ownerUserId: p.ownerUserId,
    visibility: p.visibility,
    version: p.version,
    edition: p.edition,
    rowCount,
    ...(byKind !== undefined ? { rowCountByKind: byKind } : {}),
    createdAt: p.createdAt.getTime(),
    updatedAt: p.updatedAt ? p.updatedAt.getTime() : null
  };
}
