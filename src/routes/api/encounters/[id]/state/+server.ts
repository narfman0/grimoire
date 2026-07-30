import { json, error } from '@sveltejs/kit';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db, schema } from '$lib/server/db';
import { Uuid } from '$lib/server/api/schemas';
import { PlanJson, SpellSlotsJson, salvagePlanJson } from '$lib/server/api/encounter-schemas';
import { readCombatState } from '$lib/encounter/combat-state';
import { parseParams } from '$lib/server/api/validate';
import { getMembershipByCampaignId } from '$lib/server/auth/membership';
import { hpBucket, parseReveals } from '$lib/realtime/reveals';
import { buildLiveParticipantList } from '$lib/realtime/participants';
import { economyFromCharacterDoc, normalizeEconomy } from '$lib/realtime/economy';
import { normalizeTimers, pruneTimers } from '$lib/encounter/condition-timers';
import { normalizeSpentPools } from '$lib/encounter/action-availability';
import { visibleTokenPositions } from '$lib/encounter/board-visibility';
import { monsterDerive } from '$lib/rules/monster-derive';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const Params = z.object({ id: Uuid });

// ---------------------------------------------------------------------------
// Response schema (Zod) — mirrors EncounterSnapshot from encounter-channel.ts
// ---------------------------------------------------------------------------

const ParticipantHpSchema = z.object({
  currentHp: z.number().int().nullable(),
  tempHp: z.number().int().nonnegative(),
  maxHp: z.number().int().nullable(),
  /** Coarse health band. Always present; it is the *only* HP signal a player
   *  gets for a non-PC row whose `vitals` flag is off — the numbers above
   *  come through null in that case. The badge was always the intended
   *  player-facing view, but the exact HP used to ship anyway and the client
   *  bucketed it, so the numbers sat in devtools (and in the board token's
   *  ring) for anyone who looked. */
  hpBucket: z.string(),
  conditions: z.array(z.string()),
  /** Round-scoped duration overlay on `conditions` — the flat list above is
   *  still the source of truth for "is this on". PCs source it from the
   *  character document, everyone else from plan_json. See
   *  $lib/encounter/condition-timers. */
  conditionTimers: z.array(
    z.object({ condition: z.string(), untilRound: z.number().int().nonnegative() })
  ),
  concentrating: z
    .union([
      z.object({ label: z.string(), sinceRound: z.number().int().nonnegative().optional() }),
      z.boolean(),
      z.null()
    ])
    .nullable()
    .optional()
});

const RevealsSchema = z.object({
  identity: z.boolean(),
  vitals: z.boolean(),
  combat: z.boolean(),
  hidden: z.boolean()
});

// Wire shape of LiveParticipant (src/lib/realtime/participants.ts): the
// role-redacted membership/order/name/reveals slice of the participant
// list. Heavy derived data (statblocks, PC stats) stays on SSR page data;
// the client re-fetches page data when this list names a participant it
// has no heavy row for.
const LiveParticipantSchema = z.object({
  id: Uuid,
  kind: z.string(),
  characterId: Uuid.nullable(),
  name: z.string(),
  placeholderName: z.string(),
  initiative: z.number().int().nullable(),
  sortOrder: z.number().int(),
  reveals: RevealsSchema
});

/** Per-participant combat economy: the action / bonus / reaction / movement
 *  flags plus the legendary-action counter. Sourced from the character
 *  document for PCs and from `plan_json.combat` for everyone else, so both
 *  DM tabs (and the acting player) see the same spent state after a reload.
 *  See $lib/realtime/economy. */
const ParticipantEconomySchema = z.object({
  actionUsed: z.boolean(),
  bonusUsed: z.boolean(),
  reactionUsed: z.boolean(),
  movementUsed: z.number().int().nonnegative(),
  legendaryUsed: z.number().int().nonnegative(),
  round: z.number().int().nonnegative().optional(),
  /** DM-tracked NPC spell slots, keyed by level. Encounter-scoped (no
   *  `round` expiry — slots return on a rest, not on a round bump), so the
   *  tally survives reloads and agrees across DM tabs. Non-PC only. */
  spellSlots: SpellSlotsJson.optional()
});

/** Live spend counters for one PC participant — the character document's
 *  `resourcesSpent`, keyed by resource pool id.
 *
 *  Why this is on the poll and the rest of the pool isn't: the planner's
 *  "2/5 Ki left" needs `max` (and the pool's name, and what each action
 *  costs), all of which require the full `Derived` and therefore stay on
 *  SSR page data. The only part that moves mid-combat is the spend counter,
 *  and that's a plain integer already sitting on the character document
 *  this handler loads and parses anyway — no extra query, no derive, and
 *  the ETag already covers it via max(characters.updated_at). The client
 *  recombines the two in `withLiveResources`
 *  ($lib/encounter/action-availability). Present for every PC participant
 *  (empty when nothing is spent), absent for everyone else. */
const ParticipantResourcesSchema = z.record(z.string(), z.number().int().nonnegative());

/** Token position for participants placed on the board. `sizeCells` rides
 *  along so the client can draw the footprint without an SSR pass. Players
 *  only receive entries whose token is on a revealed cell (see below). */
const ParticipantPositionSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  sizeCells: z.number().int().min(1)
});

const EncounterStateResponse = z.object({
  round: z.number().int().nonnegative(),
  status: z.enum(['staging', 'live', 'ended']),
  activeParticipantId: Uuid.nullable(),
  participants: z.array(LiveParticipantSchema),
  plans: z.record(z.string(), PlanJson.nullable()),
  participantHp: z.record(z.string(), ParticipantHpSchema),
  participantEconomy: z.record(z.string(), ParticipantEconomySchema),
  /** DM lair markers, keyed by participant id. Projected because the marker
   *  moved off plan_json into combat_state_json (migration 0009) and the UI
   *  used to read `plans[id].lair` raw. */
  participantLair: z.record(z.string(), z.boolean()),
  participantResources: z.record(z.string(), ParticipantResourcesSchema),
  positions: z.record(z.string(), ParticipantPositionSchema),
  /** encounter_boards.version, or null when no board is attached. The
   *  client refetches GET .../board only when this bumps — the 2s poll
   *  stays a few bytes. */
  boardVersion: z.number().int().nullable()
});

export type TEncounterStateResponse = z.infer<typeof EncounterStateResponse>;

export const GET: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401, 'login required');
  const { id } = parseParams(params, Params);

  const encRows = await db
    .select({ campaignId: schema.encounters.campaignId, round: schema.encounters.round, status: schema.encounters.status, activeParticipantId: schema.encounters.activeParticipantId })
    .from(schema.encounters)
    .where(eq(schema.encounters.id, id))
    .limit(1);
  const enc = encRows[0];
  if (!enc) throw error(404, 'encounter not found');

  const role = await getMembershipByCampaignId(locals.user.id, enc.campaignId);
  if (!role) throw error(403, 'not a member of this campaign');

  const allRows = await db
    .select({
      id: schema.participants.id,
      kind: schema.participants.kind,
      characterId: schema.participants.characterId,
      name: schema.participants.name,
      initiative: schema.participants.initiative,
      sortOrder: schema.participants.sortOrder,
      statblockSlug: schema.participants.statblockSlug,
      statblockJson: schema.participants.statblockJson,
      currentHp: schema.participants.currentHp,
      maxHp: schema.participants.maxHp,
      tempHp: schema.participants.tempHp,
      conditionsJson: schema.participants.conditionsJson,
      planJson: schema.participants.planJson,
      combatStateJson: schema.participants.combatStateJson,
      concentratingJson: schema.participants.concentratingJson,
      revealsJson: schema.participants.revealsJson,
      posX: schema.participants.posX,
      posY: schema.participants.posY,
      sizeCells: schema.participants.sizeCells
    })
    .from(schema.participants)
    .where(eq(schema.participants.encounterId, id));

  // Board change token + fog mask. One indexed read; the version folds into
  // the ETag below (fog flips change which positions a player may see, and
  // the client uses the version to decide when to refetch the board route).
  const boardRows = await db
    .select({
      w: schema.encounterBoards.w,
      h: schema.encounterBoards.h,
      revealedJson: schema.encounterBoards.revealedJson,
      version: schema.encounterBoards.version
    })
    .from(schema.encounterBoards)
    .where(eq(schema.encounterBoards.encounterId, id))
    .limit(1);
  const board = boardRows[0];

  // Players never receive hidden participants — the SSR loader filters them
  // out of the page data, and this poll endpoint must apply the same
  // redaction or an open devtools tab reveals the ambush (id, HP, plan).
  const partRows =
    role === 'dm'
      ? allRows
      : allRows.filter((p) => p.kind === 'pc' || !parseReveals(p.revealsJson).hidden);

  // PC HP / temp / conditions / concentration live on the character document,
  // not on the participants row. Loading them per-poll keeps the poll
  // snapshot consistent with the doc — without this, a stale or default
  // value on the participants row would silently override the doc's real
  // values in the client's liveHpMap and the UI would snap back after
  // every mutation. Mirrors the SSR backfill in +page.server.ts.
  const pcCharIds = partRows
    .filter((p) => p.kind === 'pc' && p.characterId)
    .map((p) => p.characterId as string);

  // --- change-token short-circuit (ETag / If-None-Match) -------------------
  // The expensive part of this poll is loading + JSON-parsing character
  // documents (and the per-participant JSON columns). Everything the
  // response depends on is derivable from cheap already-indexed reads:
  //   - encounters.round / activeParticipantId (fetched above for auth),
  //   - the role-filtered participants rows (fetched above; every non-PC
  //     mutation — HP, plan, conditions, concentration, reveals, add /
  //     remove — changes one of the hashed columns),
  //   - max(characters.updated_at) over PC participants (every PC doc
  //     mutation bumps updated_at via PATCH /api/characters),
  //   - the viewer's role — reveals redaction is role-dependent, so a DM
  //     token must never validate a player's cached variant (and hashing
  //     the post-filter rows means hidden-participant churn doesn't even
  //     invalidate player caches).
  // If the client's If-None-Match matches, return 304 before touching the
  // character documents.
  let pcDocsUpdatedMax = 0;
  if (pcCharIds.length > 0) {
    const [agg] = await db
      .select({ max: sql<number | null>`max(${schema.characters.updatedAt})` })
      .from(schema.characters)
      .where(inArray(schema.characters.id, pcCharIds));
    pcDocsUpdatedMax = Number(agg?.max ?? 0);
  }
  const token = createHash('sha1')
    .update(
      JSON.stringify([
        role,
        enc.round,
        enc.status,
        enc.activeParticipantId ?? null,
        pcDocsUpdatedMax,
        board?.version ?? null,
        // Sort for a deterministic hash — SQLite row order is unspecified.
        [...partRows].sort((a, b) => (a.id < b.id ? -1 : 1))
      ])
    )
    .digest('hex');
  const etag = `"${token}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }

  const charDocs = new Map<string, Record<string, unknown>>();
  /** Live character name by character.id — PC rows in the wire list track
   *  sheet renames without a participants-table re-sync (same rule as the
   *  SSR loader's charNameById). */
  const charNames = new Map<string, string>();
  if (pcCharIds.length > 0) {
    const rows = await db
      .select({ id: schema.characters.id, name: schema.characters.name, document: schema.characters.document })
      .from(schema.characters)
      .where(inArray(schema.characters.id, pcCharIds));
    for (const r of rows) {
      charNames.set(r.id, r.name);
      if (!r.document) continue;
      try {
        charDocs.set(r.id, JSON.parse(r.document) as Record<string, unknown>);
      } catch (err) {
        // best-effort: skip malformed doc, but leave a trail
        logger.warn({ err, encounterId: id, characterId: r.id }, 'state poll: malformed character document');
      }
    }
  }

  // Dex per participant for the initiative tiebreaker — mirrors the SSR
  // loader's dexForParticipant so both surfaces sort identically. Runs
  // post-304 only; the token already covers every input (rows incl.
  // statblock columns, char docs via updated_at, static monster content).
  const monsterSlugs = Array.from(
    new Set(partRows.map((p) => p.statblockSlug).filter((s): s is string => !!s))
  );
  const monsterDex = new Map<string, number>();
  if (monsterSlugs.length > 0) {
    const rows = await db
      .select({ slug: schema.content.slug, data: schema.content.data })
      .from(schema.content)
      .where(and(eq(schema.content.kind, 'monster'), inArray(schema.content.slug, monsterSlugs)));
    for (const r of rows) {
      try {
        const derived = monsterDerive(JSON.parse(r.data as string) as Record<string, unknown>);
        monsterDex.set(r.slug, derived.abilityScores.dex);
      } catch (err) {
        logger.warn({ err, encounterId: id, slug: r.slug }, 'state poll: malformed monster content');
      }
    }
  }
  function dexForParticipant(p: (typeof partRows)[number]): number {
    if (p.characterId) {
      const dex = (charDocs.get(p.characterId)?.abilityScores as { dex?: number } | undefined)?.dex;
      if (typeof dex === 'number') return dex;
      return 10;
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

  const participants = buildLiveParticipantList(
    partRows.map((p) => ({
      id: p.id,
      kind: p.kind,
      characterId: p.characterId,
      name:
        p.kind === 'pc' && p.characterId ? charNames.get(p.characterId) ?? p.name : p.name,
      initiative: p.initiative,
      dexScore: dexForParticipant(p),
      sortOrder: p.sortOrder,
      reveals: parseReveals(p.revealsJson)
    })),
    role === 'dm'
  );

  const plans: Record<string, z.infer<typeof PlanJson> | null> = {};
  const participantHp: Record<string, z.infer<typeof ParticipantHpSchema>> = {};
  const participantEconomy: Record<string, z.infer<typeof ParticipantEconomySchema>> = {};
  const participantLair: Record<string, boolean> = {};
  const participantResources: Record<string, z.infer<typeof ParticipantResourcesSchema>> = {};

  for (const p of partRows) {
    // Combat state (migration 0009). Prefers the dedicated column and falls
    // back to the legacy plan_json keys for one release, so a fight that is
    // live at the instant of deploy doesn't lose its counters mid-session.
    // Note this is read *outside* the plan try/catch on purpose: the whole
    // point of the column is that a malformed plan can no longer zero a
    // creature's economy, timers and lair marker.
    const combatState = readCombatState(p.combatStateJson, p.planJson);

    // Plans
    if (p.planJson) {
      try {
        // Degrades per key rather than all-or-nothing: one invalid field
        // (an over-long `notes`, a counter an older build wrote
        // differently) must not silently zero this creature's economy,
        // spell slots, condition timers and lair marker for every poller.
        const parsed = salvagePlanJson(JSON.parse(p.planJson), (issues) =>
          logger.warn(
            { encounterId: id, participantId: p.id, issues },
            'state poll: plan_json failed validation, salvaged per key'
          )
        );
        if (parsed) plans[p.id] = parsed;
        // Movement redacts with the token: a creature whose position is
        // withheld from this viewer (fog) must not leak its coordinates
        // through the plan instead. `positions` is computed below from the
        // same fog mask, so strip here and re-check after the loop.
        // (Handled after `positions` exists — see the pass below.)
      } catch (err) {
        // best-effort: drop unparseable plan, but leave a trail
        logger.warn({ err, encounterId: id, participantId: p.id }, 'state poll: malformed plan_json');
      }
    }

    // PC HP / temp / conditions / concentration come from the char doc.
    // For a stub PC (linked character has no document yet), HP stays null
    // — the participants row is intentionally not the source of truth for
    // PC HP, and the SSR data has the row of authority for the UI.
    const isPc = p.kind === 'pc' && !!p.characterId;
    const doc = isPc ? charDocs.get(p.characterId as string) : undefined;

    let conditions: string[] = [];
    if (isPc) {
      const c = doc?.conditions;
      if (Array.isArray(c)) conditions = c as string[];
    } else {
      try {
        const parsed = JSON.parse(p.conditionsJson);
        if (Array.isArray(parsed)) conditions = parsed as string[];
      } catch (err) {
        // best-effort: drop malformed conditions, but leave a trail
        logger.warn({ err, encounterId: id, participantId: p.id }, 'state poll: malformed conditions_json');
      }
    }

    let concentrating: { label: string; sinceRound?: number } | null = null;
    if (isPc) {
      const c = doc?.concentrating;
      if (c && typeof c === 'object' && 'label' in c) {
        concentrating = c as { label: string; sinceRound?: number };
      }
    } else if (p.concentratingJson) {
      try {
        concentrating = JSON.parse(p.concentratingJson);
      } catch (err) {
        // best-effort: drop malformed concentration, but leave a trail
        logger.warn({ err, encounterId: id, participantId: p.id }, 'state poll: malformed concentrating_json');
      }
    }

    let currentHp: number | null;
    let tempHp: number;
    let maxHp: number | null;
    if (isPc) {
      currentHp = doc && typeof doc.currentHp === 'number' ? (doc.currentHp as number) : null;
      tempHp = doc && typeof doc.tempHp === 'number' ? (doc.tempHp as number) : 0;
      // maxHp requires running derive(); the client already has it via SSR
      // (data.participants[].maxHp), so omit here.
      maxHp = null;
    } else {
      currentHp = p.currentHp ?? null;
      tempHp = p.tempHp ?? 0;
      maxHp = p.maxHp ?? null;
    }

    // Condition duration overlay. Pruned against the live condition list so
    // a timer for a condition somebody already removed never reaches the
    // client (and so never raises an expiry prompt for a condition nobody
    // has).
    const conditionTimers = pruneTimers(
      normalizeTimers(isPc ? doc?.conditionTimers : combatState.conditionTimers),
      conditions
    );

    // Vitals redaction. The DM sees everything; players see exact numbers for
    // their own party and for any non-PC row the DM has revealed, and the
    // bucket alone for the rest. Computed here, once, from the real numbers —
    // the same discipline as the fog and token-position redactions.
    const bucket = hpBucket(currentHp, maxHp);
    const revealVitals = role === 'dm' || isPc || parseReveals(p.revealsJson).vitals;
    participantHp[p.id] = {
      currentHp: revealVitals ? currentHp : null,
      tempHp: revealVitals ? tempHp : 0,
      maxHp: revealVitals ? maxHp : null,
      hpBucket: bucket,
      conditions,
      conditionTimers,
      concentrating
    };

    // Combat economy: PCs read the character document's *UsedThisRound
    // fields (the same ones the character sheet writes); non-PCs read the
    // `combat` slot on combat_state_json. Always emitted so a cleared
    // is distinguishable from one the poll simply skipped.
    participantEconomy[p.id] = isPc
      ? economyFromCharacterDoc(doc)
      : normalizeEconomy(combatState.combat);
    // DM-only: "which creature is legendary/lairing here" is prep, and the
    // only UI that reads it is DM-gated — don't name the dragon to players.
    if (role === 'dm' && combatState.lair === true) participantLair[p.id] = true;

    // Resource spend counters (PCs only — the pools come from derive()).
    // Lets the planner's "2/5 Ki left" track a mid-combat spend on the
    // character sheet without waiting for an invalidateAll. Always emitted
    // for a PC, even when empty: "spent nothing" (a rest just refilled the
    // pool) has to be distinguishable from "this poll carried no counters",
    // or a restored pool would keep reading the stale SSR number. Same rule
    // as participantEconomy above.
    if (isPc) {
      participantResources[p.id] = normalizeSpentPools(doc?.resourcesSpent) ?? {};
    }
  }

  // Token positions — shared redaction path with the SSR loader. Hidden
  // participants were already dropped from partRows above.
  const positions = visibleTokenPositions(partRows, board, role === 'dm');

  // Fog redaction for planned movement: a viewer who may not see a token's
  // position may not see where it intends to go either. Same visibility set
  // as the token itself.
  if (role !== 'dm') {
    for (const [pid, plan] of Object.entries(plans)) {
      if (plan && (plan.moveTo || plan.path) && !positions[pid]) {
        const { moveTo: _m, path: _p, ...rest } = plan;
        plans[pid] = rest;
      }
    }
  }

  const body: TEncounterStateResponse = {
    round: enc.round,
    status: enc.status as TEncounterStateResponse['status'],
    activeParticipantId: enc.activeParticipantId ?? null,
    participants,
    plans,
    participantHp,
    participantEconomy,
    participantLair,
    participantResources,
    positions,
    boardVersion: board?.version ?? null
  };

  return json(body, { headers: { etag } });
};

export const _openapi = {
  GET: {
    summary:
      'Fetch the live encounter snapshot (round, status, turn, redacted participant list, HP, plans, combat economy, PC resource spend) for polling',
    description:
      'The 200 response carries an `ETag` header derived from the encounter state. ' +
      'Pollers should echo it back via `If-None-Match`; when nothing changed the server ' +
      'answers a bodyless 304 with the same `ETag`, keeping the 2s poll loop cheap.',
    params: Params,
    response: EncounterStateResponse,
    errors: [
      { status: 304, description: 'Not modified — If-None-Match matched the current ETag' },
      403,
      404
    ]
  }
} as const;
