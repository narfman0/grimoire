// Session log writer. Every character-document write path calls
// `recordCharacterChanges` with the stored JSON before and after; this module
// diffs them ($lib/session-log/diff) and appends rows to `session_log` for
// every campaign the character is linked to.
//
// Two invariants:
//   - Append-only. Corrections are new rows with `amendsLogId`; nothing here
//     updates or deletes.
//   - Logging never breaks the write it describes. The document is already
//     saved by the time we're called; a failure here is logged and swallowed.

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';
import { derive } from '$lib/rules';
import type { CharacterDocument } from '$lib/rules/types';
import { buildContentLookup } from '$lib/server/content/lookup';
import { logger } from '$lib/server/logger';
import {
  describeChange,
  diffCharacterDocs,
  logKindOf,
  needsNames,
  SLUG_NAMES,
  type CharacterChange,
  type NameResolver,
  type RestKind
} from '$lib/session-log/diff';
import { applyPcVitals } from '$lib/server/encounter/pc-vitals';

export interface RecordOptions {
  characterId: string;
  /** Raw stored JSON (characters.document) before and after the write. */
  before: string | null;
  after: string | null;
  actorUserId: string | null;
  /** Client hint from the sheet's rest buttons — folds the rest's many
   *  changes into one "took a long rest" row. */
  reason?: RestKind;
  /** Set when this write is itself a correction of an earlier row. */
  amendsLogId?: string;
}

function parse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function buildNames(
  ownerUserId: string | null,
  campaignId: string,
  doc: Record<string, unknown>
): Promise<NameResolver> {
  try {
    const { lookup } = await buildContentLookup(ownerUserId ?? undefined, campaignId);
    let resources = new Map<string, string>();
    let activations = new Map<string, string>();
    try {
      const d = derive(doc as unknown as CharacterDocument, lookup);
      resources = new Map([
        ...d.resources.map((r) => [r.id, r.name] as const),
        ...(d.classResources ?? []).map((r) => [r.id, r.name] as const)
      ]);
      activations = new Map((d.availableActivations ?? []).map((a) => [a.id, a.name]));
    } catch {
      // derive() throws on malformed docs; slugs are an honest fallback.
    }
    return {
      resource: (id) => resources.get(id) ?? SLUG_NAMES.resource(id),
      activation: (id) => activations.get(id) ?? SLUG_NAMES.activation(id),
      item: (k) =>
        lookup({ kind: k.kind, slug: k.slug, authorUserId: k.authorUserId ?? undefined })?.name ??
        SLUG_NAMES.item(k),
      className: (slug) => lookup({ kind: 'class', slug })?.name ?? SLUG_NAMES.className(slug)
    };
  } catch {
    return SLUG_NAMES;
  }
}

/** The rows a set of changes becomes. Exported for tests. */
export function rowsForChanges(
  who: string,
  changes: CharacterChange[],
  names: NameResolver,
  reason?: RestKind
): Array<{ kind: string; summary: string; detail: unknown }> {
  if (reason) {
    const hp = changes.find((c) => c.kind === 'hp');
    const extra =
      hp && hp.kind === 'hp' && hp.before.currentHp !== hp.after.currentHp
        ? ` (HP ${hp.before.currentHp} → ${hp.after.currentHp})`
        : '';
    return [
      {
        kind: 'rest',
        summary: `${who} took a ${reason === 'long-rest' ? 'long' : 'short'} rest${extra}`,
        detail: { reason, changes: changes.map((c) => ({ ...c, text: describeChange(who, c, names) })) }
      }
    ];
  }
  return changes.map((c) => ({
    kind: logKindOf(c),
    summary: describeChange(who, c, names),
    detail: c
  }));
}

export async function recordCharacterChanges(opts: RecordOptions): Promise<void> {
  try {
    const changes = diffCharacterDocs(parse(opts.before), parse(opts.after));
    if (changes.length === 0) return;

    const links = await db
      .select({ campaignId: schema.campaignCharacters.campaignId })
      .from(schema.campaignCharacters)
      .where(eq(schema.campaignCharacters.characterId, opts.characterId));
    // A standalone character belongs to no table; nothing to log.
    if (links.length === 0) return;

    const [ch] = await db
      .select({ name: schema.characters.name, ownerUserId: schema.characters.ownerUserId })
      .from(schema.characters)
      .where(eq(schema.characters.id, opts.characterId))
      .limit(1);
    const who = ch?.name ?? 'Someone';
    const after = parse(opts.after) as Record<string, unknown>;
    const names = changes.some(needsNames)
      ? await buildNames(ch?.ownerUserId ?? null, links[0].campaignId, after)
      : SLUG_NAMES;
    const rows = rowsForChanges(who, changes, names, opts.reason);

    const now = new Date();
    await db.insert(schema.sessionLog).values(
      links.flatMap((l) =>
        rows.map((r) => ({
          id: randomUUID(),
          campaignId: l.campaignId,
          characterId: opts.characterId,
          kind: r.kind,
          summary: opts.amendsLogId ? `${r.summary} (restored)` : r.summary,
          detailJson: JSON.stringify(r.detail),
          isPrivate: false,
          amendsLogId: opts.amendsLogId ?? null,
          actorUserId: opts.actorUserId,
          createdAt: now
        }))
      )
    );
  } catch (err) {
    logger.error({ err, characterId: opts.characterId }, 'session log: failed to record changes');
  }
}

export async function addNote(opts: {
  campaignId: string;
  actorUserId: string;
  text: string;
  isPrivate: boolean;
  characterId?: string | null;
  amendsLogId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.sessionLog).values({
    id,
    campaignId: opts.campaignId,
    characterId: opts.characterId ?? null,
    kind: 'note',
    summary: opts.text,
    detailJson: null,
    isPrivate: opts.isPrivate,
    amendsLogId: opts.amendsLogId ?? null,
    actorUserId: opts.actorUserId,
    createdAt: new Date()
  });
  return id;
}

async function loadEntry(campaignId: string, logId: string) {
  const [row] = await db
    .select()
    .from(schema.sessionLog)
    .where(and(eq(schema.sessionLog.id, logId), eq(schema.sessionLog.campaignId, campaignId)))
    .limit(1);
  if (!row) throw error(404, 'log entry not found');
  return row;
}

/** Amend a note: a new note row pointing at the original. Keeps the
 *  original's privacy and character — a correction can't quietly publish a
 *  private note. */
export async function amendNote(opts: {
  campaignId: string;
  logId: string;
  actorUserId: string;
  text: string;
}): Promise<string> {
  const row = await loadEntry(opts.campaignId, opts.logId);
  if (row.kind !== 'note') throw error(400, 'only notes can be amended; restore HP instead');
  return addNote({
    campaignId: opts.campaignId,
    actorUserId: opts.actorUserId,
    text: opts.text,
    isPrivate: row.isPrivate,
    characterId: row.characterId,
    amendsLogId: row.id
  });
}

/** DM undo for an HP entry: put the character's HP and temp HP back to what
 *  they were before that entry. Written through the scoped vitals writer,
 *  whose own log hook records the change as an amends row. */
export async function restoreHp(opts: {
  campaignId: string;
  logId: string;
  actorUserId: string;
}): Promise<{ currentHp: number; tempHp: number }> {
  const row = await loadEntry(opts.campaignId, opts.logId);
  if (row.kind !== 'hp' || !row.characterId || !row.detailJson) {
    throw error(400, 'only HP entries can be restored');
  }
  const detail = parse(row.detailJson) as { before?: { currentHp?: unknown; tempHp?: unknown } } | null;
  const before = detail?.before;
  if (typeof before?.currentHp !== 'number' || typeof before?.tempHp !== 'number') {
    throw error(400, 'entry has no HP to restore');
  }
  const linked = await db
    .select({ id: schema.campaignCharacters.characterId })
    .from(schema.campaignCharacters)
    .where(
      and(
        eq(schema.campaignCharacters.campaignId, opts.campaignId),
        eq(schema.campaignCharacters.characterId, row.characterId)
      )
    )
    .limit(1);
  if (linked.length === 0) throw error(409, 'character is no longer in this campaign');
  // A restore that changes nothing would write no amends row and leave no
  // trace of the click — refuse it instead.
  const [cur] = await db
    .select({ document: schema.characters.document })
    .from(schema.characters)
    .where(eq(schema.characters.id, row.characterId))
    .limit(1);
  const doc = parse(cur?.document ?? null);
  if (doc && doc.currentHp === before.currentHp && doc.tempHp === before.tempHp) {
    throw error(409, 'HP is already at that value');
  }
  return applyPcVitals(
    row.characterId,
    { currentHp: before.currentHp, tempHp: before.tempHp },
    { actorUserId: opts.actorUserId, amendsLogId: row.id }
  );
}
