// Party dashboard — the one payload behind both the spectator view
// (/watch/[token], no login) and the table view (/c/[code]/table).
//
// PLAYER LENS, UNCONDITIONALLY. There is no isDM parameter on purpose: the
// spectator view is anonymous, and the table view is a tablet lying in the
// middle of the table, so neither may ever carry a hidden monster, a real
// name the DM hasn't revealed, or exact vitals the DM hasn't revealed. Every
// redaction decision is delegated to the functions the encounter poll and
// the log route already use, rather than re-implemented here:
//
//   participant membership/order/names → buildLiveParticipantList(.., false)
//   vitals                             → projectVitals({ isDM: false })
//   action log rows                    → redactActionLog(.., false)
//
// Party data (HP, AC, slots, inventory) is what any approved co-member can
// already read off a linked character's sheet (requireCharacterViewAccess),
// so it's shown in full — minus item description prose, which we never
// render.

import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { derive } from '$lib/rules';
import type { CharacterDocument, ContentRef, Derived } from '$lib/rules/types';
import { buildContentLookup } from '$lib/server/content/lookup';
import { buildLiveParticipantList } from '$lib/realtime/participants';
import { parseReveals, projectVitals } from '$lib/realtime/reveals';
import { buildRedactionMap, redactActionLog } from '$lib/realtime/action-log';
import { serializeActionLogEntry } from '$lib/server/serializers';
import { loadMonsterDex, participantDex } from '$lib/server/encounter/participant-dex';
import { describeCombatEntry } from '$lib/dashboard/describe';
import { logger } from '$lib/server/logger';
import type {
  DashboardCombatant,
  DashboardEncounter,
  DashboardPartyMember,
  PartyDashboard,
  TimelineEntry
} from '$lib/dashboard/types';

/** How many log entries the dashboard carries. */
export const DASHBOARD_LOG_LIMIT = 30;

interface LoadedCharacter {
  id: string;
  name: string;
  ownerUserId: string | null;
  doc: CharacterDocument | null;
  derived: Derived | null;
  lookup: ((ref: ContentRef) => { name: string } | undefined) | null;
}

function parseDoc(id: string, raw: string | null): CharacterDocument | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CharacterDocument;
  } catch (err) {
    logger.warn({ err, characterId: id }, 'party dashboard: malformed character document');
    return null;
  }
}

async function loadCharacters(
  ids: string[],
  campaignId: string
): Promise<Map<string, LoadedCharacter>> {
  const out = new Map<string, LoadedCharacter>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: schema.characters.id,
      name: schema.characters.name,
      ownerUserId: schema.characters.ownerUserId,
      document: schema.characters.document
    })
    .from(schema.characters)
    .where(inArray(schema.characters.id, ids));
  for (const r of rows) {
    const doc = parseDoc(r.id, r.document);
    let derived: Derived | null = null;
    let lookup: LoadedCharacter['lookup'] = null;
    if (doc) {
      try {
        const built = await buildContentLookup(r.ownerUserId ?? undefined, campaignId);
        lookup = built.lookup;
        derived = derive(doc, built.lookup);
      } catch (err) {
        // derive() throws on malformed docs — keep the doc-level fields.
        logger.warn({ err, characterId: r.id }, 'party dashboard: derive failed');
      }
    }
    out.set(r.id, { id: r.id, name: r.name, ownerUserId: r.ownerUserId, doc, derived, lookup });
  }
  return out;
}

function concentrationLabel(c: unknown): string | null {
  if (c && typeof c === 'object' && typeof (c as { label?: unknown }).label === 'string') {
    return (c as { label: string }).label;
  }
  return null;
}

function partyMember(c: LoadedCharacter): DashboardPartyMember {
  const { doc, derived, lookup } = c;
  const nameOf = (kind: string, slug: string, authorUserId?: string | null) =>
    lookup?.({ kind, slug, authorUserId: authorUserId ?? undefined })?.name ?? slug;
  if (!doc) {
    return {
      id: c.id,
      name: c.name,
      portrait: null,
      classLine: '',
      level: 0,
      hasSheet: false,
      currentHp: null,
      maxHp: null,
      tempHp: 0,
      ac: null,
      conditions: [],
      concentrating: null,
      deathSaves: null,
      spellSlots: [],
      resources: [],
      inventory: []
    };
  }
  const classes = Array.isArray(doc.classes) ? doc.classes : [];
  const stats = derived?.stats;
  const resources = [
    ...(derived?.classResources ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      current: r.current,
      max: r.max
    })),
    ...(derived?.availableActivations ?? [])
      .filter((a) => a.usesMax != null && a.usesMax > 0)
      .map((a) => ({
        id: `activation:${a.id}`,
        name: a.name,
        current: a.usesRemaining ?? (a.usesMax as number),
        max: a.usesMax as number
      }))
  ];
  return {
    id: c.id,
    name: c.name,
    portrait: typeof doc.portrait === 'string' ? doc.portrait : null,
    classLine: classes.map((k) => `${nameOf('class', k.slug)} ${k.level}`).join(' / '),
    level: classes.reduce((s, k) => s + (k.level ?? 0), 0),
    hasSheet: true,
    currentHp: typeof doc.currentHp === 'number' ? doc.currentHp : null,
    maxHp: stats?.hp.max ?? null,
    tempHp: typeof doc.tempHp === 'number' ? doc.tempHp : 0,
    ac: stats?.ac ?? null,
    conditions: Array.isArray(doc.conditions) ? doc.conditions : [],
    concentrating: concentrationLabel(doc.concentrating),
    deathSaves:
      doc.deathSaves && (doc.deathSaves.successes > 0 || doc.deathSaves.failures > 0)
        ? { successes: doc.deathSaves.successes, failures: doc.deathSaves.failures }
        : null,
    spellSlots: Object.entries(stats?.spellSlots ?? {})
      .map(([lvl, s]) => ({ level: Number(lvl), max: s.max, used: s.used }))
      .filter((s) => s.max > 0)
      .sort((a, b) => a.level - b.level),
    resources,
    inventory: (Array.isArray(doc.inventory) ? doc.inventory : []).map((slot) => ({
      name: nameOf(slot.contentKind, slot.contentSlug, slot.authorUserId),
      equipped: !!slot.equipped,
      attuned: !!slot.attuned,
      charges: typeof slot.charges === 'number' ? slot.charges : null
    }))
  };
}

interface ParticipantRow {
  id: string;
  encounterId: string;
  kind: string;
  characterId: string | null;
  name: string;
  initiative: number | null;
  sortOrder: number;
  statblockSlug: string | null;
  statblockJson: string | null;
  currentHp: number | null;
  maxHp: number | null;
  tempHp: number;
  conditionsJson: string;
  concentratingJson: string | null;
  revealsJson: string;
}

async function loadParticipants(encounterIds: string[]): Promise<ParticipantRow[]> {
  if (encounterIds.length === 0) return [];
  return db
    .select({
      id: schema.participants.id,
      encounterId: schema.participants.encounterId,
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
      concentratingJson: schema.participants.concentratingJson,
      revealsJson: schema.participants.revealsJson
    })
    .from(schema.participants)
    .where(inArray(schema.participants.encounterId, encounterIds));
}

/** Player-visible labels for one encounter's participants, keyed by id.
 *  Hidden rows are absent. Same function, same dex tiebreak as the poll, so
 *  "Enemy 2" here is "Enemy 2" on every player's encounter screen. */
function playerLabels(
  rows: ParticipantRow[],
  chars: Map<string, LoadedCharacter>,
  monsterDex: Map<string, number>
): Map<string, { name: string; characterId: string | null }> {
  const docs = new Map<string, Record<string, unknown>>();
  for (const [id, c] of chars) if (c.doc) docs.set(id, c.doc as unknown as Record<string, unknown>);
  const list = buildLiveParticipantList(
    rows.map((p) => ({
      id: p.id,
      kind: p.kind,
      characterId: p.characterId,
      name: p.kind === 'pc' && p.characterId ? chars.get(p.characterId)?.name ?? p.name : p.name,
      initiative: p.initiative,
      dexScore: participantDex(p, docs, monsterDex),
      sortOrder: p.sortOrder,
      reveals: parseReveals(p.revealsJson)
    })),
    false
  );
  return new Map(list.map((e) => [e.id, { name: e.name, characterId: e.characterId }]));
}

function parseStringArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** JSON response with a content-hash ETag; a matching If-None-Match gets a
 *  bodyless 304. The dashboard is rebuilt on every poll (a handful of
 *  derive() calls — cheap next to the cached pack map), so this saves the
 *  wire, not the CPU; a cheap change token like the encounter poll's is a
 *  possible follow-up if it ever shows up in profiles. */
export function dashboardResponse(request: Request, body: PartyDashboard): Response {
  const text = JSON.stringify(body);
  const etag = `"${createHash('sha1').update(text).digest('hex')}"`;
  const headers = {
    etag,
    'cache-control': 'private, no-cache',
    'x-robots-tag': 'noindex'
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(text, { headers: { ...headers, 'content-type': 'application/json' } });
}

export async function buildPartyDashboard(campaign: {
  id: string;
  name: string;
}): Promise<PartyDashboard> {
  // Party: linked via the join table, never the campaignId soft pointer.
  const partyRows = await db
    .select({ id: schema.characters.id, name: schema.characters.name })
    .from(schema.characters)
    .innerJoin(
      schema.campaignCharacters,
      eq(schema.campaignCharacters.characterId, schema.characters.id)
    )
    .where(eq(schema.campaignCharacters.campaignId, campaign.id));
  const partyIds = partyRows.map((r) => r.id);

  // The live encounter, if any — most recently created wins when several are
  // live (split party). Staging encounters are DM prep and never shown.
  const [live] = await db
    .select({
      id: schema.encounters.id,
      name: schema.encounters.name,
      status: schema.encounters.status,
      round: schema.encounters.round,
      activeParticipantId: schema.encounters.activeParticipantId
    })
    .from(schema.encounters)
    .where(and(eq(schema.encounters.campaignId, campaign.id), eq(schema.encounters.status, 'live')))
    .orderBy(desc(schema.encounters.createdAt))
    .limit(1);

  // Recent combat log across the campaign's encounters.
  const logRows = await db
    .select({ log: schema.actionLog, encounterName: schema.encounters.name })
    .from(schema.actionLog)
    .innerJoin(schema.encounters, eq(schema.encounters.id, schema.actionLog.encounterId))
    .where(eq(schema.encounters.campaignId, campaign.id))
    .orderBy(desc(schema.actionLog.createdAt))
    .limit(DASHBOARD_LOG_LIMIT);

  const encounterIds = Array.from(
    new Set([...(live ? [live.id] : []), ...logRows.map((r) => r.log.encounterId)])
  );
  const participants = await loadParticipants(encounterIds);

  const charIds = Array.from(
    new Set([
      ...partyIds,
      ...participants.filter((p) => p.characterId).map((p) => p.characterId as string)
    ])
  );
  const chars = await loadCharacters(charIds, campaign.id);
  const monsterDex = await loadMonsterDex(
    participants.map((p) => p.statblockSlug).filter((s): s is string => !!s)
  );

  const byEncounter = new Map<string, ParticipantRow[]>();
  for (const p of participants) {
    const list = byEncounter.get(p.encounterId) ?? [];
    list.push(p);
    byEncounter.set(p.encounterId, list);
  }

  // ---- party --------------------------------------------------------------
  const party = partyRows
    .map((r) => chars.get(r.id))
    .filter((c): c is LoadedCharacter => !!c)
    .map(partyMember)
    .sort((a, b) => a.name.localeCompare(b.name));

  // ---- encounter strip ----------------------------------------------------
  let encounter: DashboardEncounter | null = null;
  if (live) {
    const rows = byEncounter.get(live.id) ?? [];
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const labels = playerLabels(rows, chars, monsterDex);
    const combatants: DashboardCombatant[] = [];
    for (const [id, label] of labels) {
      const p = rowById.get(id);
      if (!p) continue;
      const isPc = p.kind === 'pc' && !!p.characterId;
      const c = isPc ? chars.get(p.characterId as string) : undefined;
      const hp = isPc
        ? {
            currentHp: typeof c?.doc?.currentHp === 'number' ? c.doc.currentHp : null,
            tempHp: typeof c?.doc?.tempHp === 'number' ? c.doc.tempHp : 0,
            maxHp: c?.derived?.stats.hp.max ?? null
          }
        : { currentHp: p.currentHp, tempHp: p.tempHp ?? 0, maxHp: p.maxHp };
      let concentrating: string | null = null;
      if (isPc) concentrating = concentrationLabel(c?.doc?.concentrating);
      else if (p.concentratingJson) {
        try {
          concentrating = concentrationLabel(JSON.parse(p.concentratingJson));
        } catch {
          concentrating = null;
        }
      }
      combatants.push({
        id,
        name: label.name,
        kind: p.kind,
        characterId: p.characterId,
        initiative: p.initiative,
        ...projectVitals(hp, { isDM: false, isPc, reveals: parseReveals(p.revealsJson) }),
        conditions: isPc
          ? Array.isArray(c?.doc?.conditions)
            ? (c?.doc?.conditions as string[])
            : []
          : parseStringArray(p.conditionsJson),
        concentrating
      });
    }
    encounter = {
      id: live.id,
      name: live.name,
      status: live.status,
      round: live.round,
      // A hidden creature's turn must not be pointed at; the strip shows no
      // current turn rather than an arrow at an empty slot.
      activeParticipantId:
        live.activeParticipantId && labels.has(live.activeParticipantId)
          ? live.activeParticipantId
          : null,
      combatants
    };
  }

  // ---- log ----------------------------------------------------------------
  const labelsByEncounter = new Map<string, Map<string, { name: string; characterId: string | null }>>();
  const redactionByEncounter = new Map<string, ReturnType<typeof buildRedactionMap>>();
  for (const [encId, rows] of byEncounter) {
    labelsByEncounter.set(encId, playerLabels(rows, chars, monsterDex));
    redactionByEncounter.set(
      encId,
      buildRedactionMap(
        rows.map((p) => ({
          id: p.id,
          kind: p.kind,
          name: p.name,
          reveals: parseReveals(p.revealsJson)
        }))
      )
    );
  }
  const log: TimelineEntry[] = logRows.map(({ log: row, encounterName }) => {
    const [entry] = redactActionLog(
      [serializeActionLogEntry(row)],
      redactionByEncounter.get(row.encounterId) ?? new Map(),
      false
    );
    const labels = labelsByEncounter.get(row.encounterId) ?? new Map();
    const actor = entry.participantId ? labels.get(entry.participantId) ?? null : null;
    const target = entry.targetParticipantId ? labels.get(entry.targetParticipantId) ?? null : null;
    return {
      id: entry.id,
      at: entry.createdAt,
      source: 'combat',
      characterIds: [actor?.characterId, target?.characterId].filter((x): x is string => !!x),
      summary: describeCombatEntry({
        actor: actor?.name ?? null,
        target: target?.name ?? null,
        actionLabel: entry.actionLabel,
        hit: entry.hit,
        damageRoll: entry.damageRoll
      }),
      encounterName,
      round: entry.round,
      hpBefore: entry.targetHpBefore,
      hpAfter: entry.targetHpAfter,
      redacted: entry.redacted === true
    };
  });

  return { campaign: { name: campaign.name }, party, encounter, log };
}
