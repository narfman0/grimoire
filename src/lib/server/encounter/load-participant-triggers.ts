// Server-side helper: load a list of (participantId, TriggerDeclaration[])
// for every PC participant in an encounter. Used by the action-log POST
// to evaluate which triggers fire on a freshly-committed action.
//
// Implementation: for each PC participant in the encounter, load the
// character document, run derive() with a campaign-scoped content
// lookup, and pull `derived.triggers`. Monsters don't currently emit
// triggers (monster-derive doesn't surface a triggers field) — when
// they do, extend this helper.
//
// This is purposely a one-off load. derive() is expensive enough that
// we may want to cache it per-encounter eventually; for v0 we accept
// the cost on every action-log POST since these happen at human pace.

import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { derive } from '$lib/rules';
import type { CharacterDocument, TriggerDeclaration } from '$lib/rules/types';
import { buildContentLookup } from '$lib/server/content/lookup';
import type { ParticipantTriggers } from './triggers';

/** Load every PC participant's triggers + their faction id for the
 *  given encounter. Returns the data the action-log trigger consumer
 *  needs (engine-side triggers list + faction context).
 *
 *  Faction id is currently a coarse `'pcs'` / `'monsters'` split keyed
 *  off participant.kind. When the encounter model adds explicit faction
 *  tags (allied NPC monsters, mind-controlled PCs), update this. */
export async function loadEncounterTriggerContext(
  encounterId: string,
  campaignId: string
): Promise<{
  triggers: ParticipantTriggers[];
  factions: Array<{ id: string; factionId: string }>;
}> {
  const partRows = await db
    .select({
      id: schema.participants.id,
      kind: schema.participants.kind,
      characterId: schema.participants.characterId
    })
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, encounterId));

  const factions = partRows.map((p) => ({
    id: p.id,
    factionId: p.kind === 'pc' ? 'pcs' : 'monsters'
  }));

  const pcParticipants = partRows.filter(
    (p): p is typeof p & { characterId: string } => p.kind === 'pc' && !!p.characterId
  );
  if (pcParticipants.length === 0) {
    return { triggers: [], factions };
  }

  const charRows = await db
    .select({
      id: schema.characters.id,
      ownerUserId: schema.characters.ownerUserId,
      document: schema.characters.document
    })
    .from(schema.characters)
    .where(inArray(schema.characters.id, pcParticipants.map((p) => p.characterId)));

  const triggers: ParticipantTriggers[] = [];
  for (const char of charRows) {
    const participant = pcParticipants.find((p) => p.characterId === char.id);
    if (!participant || !char.document) continue;
    try {
      const doc = JSON.parse(char.document) as CharacterDocument;
      const { lookup } = await buildContentLookup(
        char.ownerUserId ?? undefined,
        campaignId
      );
      const d = derive(doc, lookup);
      const decls = (d.triggers ?? []) as TriggerDeclaration[];
      if (decls.length > 0) {
        triggers.push({ participantId: participant.id, declarations: decls });
      }
    } catch {
      // Malformed doc or derive failure — skip this participant. The
      // POST endpoint shouldn't fail because one PC's triggers couldn't
      // be derived.
    }
  }

  return { triggers, factions };
}
