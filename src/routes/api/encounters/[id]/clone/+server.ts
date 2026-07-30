// Encounter clone — "run it again".
//
// Route shape: a sub-resource action on the source encounter rather than an
// optional `cloneFromEncounterId` on POST /api/encounters. Two reasons:
// every other encounter-scoped action in this API is already an `[id]/…`
// sub-route (participants, log, state, reveals), and the create endpoint
// authorizes by `campaignCode` from the body while a clone authorizes off
// the *source encounter's* campaign — folding them together would mean one
// handler with two mutually exclusive bodies and two auth paths.
//
// WHAT CARRIES OVER (prep): the participant roster — monsters with their
// statblock pointer / inline JSON / placeholder name / max HP, PC links,
// sort order — plus the DM's encounter notes. That is the stuff the DM
// built, and rebuilding it by hand is the whole reason this endpoint exists.
//
// WHAT RESETS (per-run state):
//  - currentHp back to maxHp, temp HP to 0, conditions cleared,
//    concentration cleared, turn plans cleared.
//  - initiative cleared. RAW you roll initiative at the start of each
//    combat, and the clone lands in `staging` with round 0 and no active
//    participant — carrying a stale initiative order into a fresh fight
//    would silently skip that roll and desync from the round counter we
//    just zeroed.
//  - reveals reset to defaultRevealsFor(kind) — PCs visible, monsters/NPCs
//    fully hidden. Reveal flags are *mid-combat discovery state*: they get
//    flipped as the party identifies creatures and sees HP. A re-run starts
//    over, so inheriting them would spoil the ambush the DM set up, and
//    re-hiding a monster after the fact is the one direction that cannot
//    un-leak information. Re-revealing is one click per monster.
//  - action log is NOT copied. It is the record of the previous run.
//  - status back to `staging` (the pre-start value POST /api/encounters
//    uses), round 0, activeParticipantId null, endedAt null.

import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '$lib/server/db';
import { readCombatState } from '$lib/encounter/combat-state';
import { CloneEncounterRequest, Encounter } from '$lib/server/api/encounter-schemas';
import { Uuid } from '$lib/server/api/schemas';
import { parseOptionalJson, parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { requireUser } from '$lib/server/auth/guards';
import { defaultRevealsFor } from '$lib/realtime/reveals';
import { handleDbError } from '$lib/server/db/errors';
import { logger } from '$lib/server/logger';
import { serializeEncounter } from '$lib/server/serializers';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

/** `<name> (copy)`, trimmed to the 120-char column/schema limit. */
function copyName(sourceName: string): string {
  const suffix = ' (copy)';
  const head = sourceName.slice(0, 120 - suffix.length);
  return `${head}${suffix}`;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const user = requireUser(locals);
  const { id: sourceId } = parseParams(params, Params);
  const body = await parseOptionalJson(request, CloneEncounterRequest);

  const srcRows = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, sourceId))
    .limit(1);
  const src = srcRows[0];
  if (!src) throw error(404, 'encounter not found');

  // Same authorization shape as the other encounter writes: membership in
  // the source encounter's campaign, DM role. The clone lands in that same
  // campaign, so there is no cross-campaign escape hatch here.
  const role = await getMembershipByCampaignId(user.id, src.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');
  if (role !== 'dm') throw error(403, 'only the DM can clone encounters');

  const srcParts = await db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, src.id));

  const newId = crypto.randomUUID();
  const now = new Date();
  const row = {
    id: newId,
    campaignId: src.campaignId,
    name: body.name ?? copyName(src.name),
    status: 'staging',
    round: 0,
    activeParticipantId: null,
    // Prep, not per-run state — the DM's notes describe the setup.
    notesJson: src.notesJson ?? null,
    // The dungeon instance is prep too — the clone continues the same
    // crawl, fog and all; "fresh dungeon" is an explicit instance action.
    dungeonInstanceId: src.dungeonInstanceId ?? null,
    createdAt: now,
    endedAt: null
  };

  await db
    .insert(schema.encounters)
    .values(row)
    .catch((err) => handleDbError(err, 'clone encounter'));

  if (srcParts.length > 0) {
    await db
      .insert(schema.participants)
      .values(
        srcParts.map((p) => ({
          id: crypto.randomUUID(),
          encounterId: newId,
          // A PC whose character was since deleted has characterId null
          // already (ON DELETE SET NULL); nothing extra to guard.
          characterId: p.characterId,
          name: p.name,
          kind: p.kind,
          statblockSlug: p.statblockSlug,
          statblockJson: p.statblockJson,
          initiative: null,
          // PCs keep null HP on this table (it lives on the character
          // document); maxHp is null for them, so this reads through
          // correctly without a kind check.
          currentHp: p.maxHp ?? null,
          maxHp: p.maxHp,
          tempHp: 0,
          conditionsJson: '[]',
          planJson: null,
          // Ephemera reset, prep kept: "this fight has a lair" is something
          // the DM built, exactly like the roster and the notes the clone
          // already carries. It used to ride plan_json and was lost here.
          combatStateJson: readCombatState(p.combatStateJson, p.planJson).lair
            ? JSON.stringify({ lair: true })
            : null,
          concentratingJson: null,
          revealsJson: JSON.stringify(defaultRevealsFor(p.kind)),
          sortOrder: p.sortOrder
        }))
      )
      .catch((err) => handleDbError(err, 'clone encounter participants'));
  }

  logger.info(
    {
      userId: user.id,
      campaignId: src.campaignId,
      sourceEncounterId: src.id,
      encounterId: newId,
      participantCount: srcParts.length
    },
    'cloned encounter'
  );

  return json(serializeEncounter(row), { status: 201 });
};

export const _openapi: RouteOpenApi = {
  POST: {
    summary: 'Clone an encounter with its roster, reset for a fresh run (DM only)',
    description:
      'Copies participants (statblocks, PC links, max HP, order) and DM notes into a new staging encounter. Per-run state — HP, conditions, initiative, plans, concentration, reveals, the action log, round and status — is reset. Monsters start hidden again.',
    params: Params,
    body: CloneEncounterRequest,
    response: Encounter,
    status: 201,
    errors: [{ status: 403, description: 'DM only' }, 404]
  }
};
