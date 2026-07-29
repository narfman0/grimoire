import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';

// Scoped writes to a PC's combat vitals.
//
// PC HP and conditions live inside `characters.document`, not on the
// participants row, which is why the participant HP/conditions endpoints used
// to reject PC rows outright — there was no server path for *anyone*, DM
// included, to damage a PC. (ResolvePanel still says so in its footer: "PC HP
// changes happen on the target player's sheet.")
//
// The obvious fix — letting those endpoints call the character PATCH — would
// hand whoever can apply damage the ability to rewrite the whole sheet. This
// module exists to keep that from happening: it touches exactly four fields
// and copies the rest of the document through untouched. Authorisation is the
// caller's job (see campaign-permissions.ts); this is the *mechanism*, and it
// is deliberately incapable of doing more than it says.

/** The only fields a vitals write may change. */
export interface PcVitalsPatch {
  currentHp?: number;
  tempHp?: number;
  conditions?: string[];
  /** Cleared automatically when currentHp rises above 0. */
  deathSaves?: { successes: number; failures: number } | null;
}

interface CharacterRow {
  id: string;
  document: string | null;
  updatedAt: Date;
}

async function loadCharacter(characterId: string): Promise<CharacterRow | null> {
  const rows = await db
    .select({
      id: schema.characters.id,
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .where(eq(schema.characters.id, characterId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Apply a vitals patch to a character document. Returns the resulting
 * `{ currentHp, tempHp }` so the caller can record a before/after snapshot on
 * the action log.
 */
export async function applyPcVitals(
  characterId: string,
  patch: PcVitalsPatch
): Promise<{ currentHp: number; tempHp: number }> {
  const row = await loadCharacter(characterId);
  if (!row) throw error(404, 'character not found');
  if (!row.document) throw error(409, 'character has no document to update');

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(row.document) as Record<string, unknown>;
  } catch {
    // Refuse rather than overwrite: a document we can't parse is one we can't
    // safely copy through, and clobbering it would destroy the character.
    throw error(409, 'character document is not valid JSON');
  }

  const next = { ...doc };
  if (patch.currentHp !== undefined) next.currentHp = patch.currentHp;
  if (patch.tempHp !== undefined) next.tempHp = patch.tempHp;
  if (patch.conditions !== undefined) next.conditions = patch.conditions;
  if (patch.deathSaves !== undefined) {
    if (patch.deathSaves === null) delete next.deathSaves;
    else next.deathSaves = patch.deathSaves;
  }
  // Coming back above 0 HP ends death saves, the same rule the sheet applies
  // when a player heals themselves.
  if (typeof next.currentHp === 'number' && next.currentHp > 0) delete next.deathSaves;

  // Monotonic, matching the characters PATCH route: the sheet's poll uses
  // updatedAt to decide whether it holds stale state, so it must move forward
  // even when two writes land in the same millisecond.
  const now = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));

  await db
    .update(schema.characters)
    .set({ document: JSON.stringify(next), updatedAt: now })
    .where(eq(schema.characters.id, characterId));

  return {
    currentHp: typeof next.currentHp === 'number' ? next.currentHp : 0,
    tempHp: typeof next.tempHp === 'number' ? next.tempHp : 0
  };
}
