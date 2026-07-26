// Pure participant-list primitives shared by the SSR loader
// (src/lib/server/encounter-page.ts) and the live poll endpoint
// (GET /api/encounters/[id]/state), and consumed client-side by the
// encounter channel's snapshot.
//
// The redaction contract lives here so both server surfaces produce
// byte-identical names/order for a given viewer role: players never see a
// hidden participant, and an unrevealed non-PC is labeled "Enemy N" by its
// *visible position* in initiative order — stable as reveals flip, and the
// same N whether the row arrived via SSR or via the poll.

import type { ParticipantReveals } from './reveals';

/** Lightweight participant entry carried by the /state poll. Enough for the
 *  client to reconcile list membership, order, names, and reveal flags
 *  without an SSR pass; heavy derived data (statblocks, PC stats) stays
 *  SSR-only and the client re-fetches page data when it sees an entry it
 *  has no heavy row for. */
export interface LiveParticipant {
  id: string;
  kind: string;
  characterId: string | null;
  /** Redacted for non-DM viewers when identity is unrevealed. */
  name: string;
  /** What the viewer should label this row ("Enemy 2" until identity). */
  placeholderName: string;
  initiative: number | null;
  sortOrder: number;
  reveals: ParticipantReveals;
}

export interface InitiativeSortable {
  initiative: number | null;
  dexScore: number;
  sortOrder: number;
}

/** Initiative order: highest roll first, dex score breaks ties, insertion
 *  order (sortOrder) breaks dex ties. Unrolled initiative sinks to the
 *  bottom. */
export function initiativeCompare(a: InitiativeSortable, b: InitiativeSortable): number {
  return (
    (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity) ||
    b.dexScore - a.dexScore ||
    a.sortOrder - b.sortOrder
  );
}

/** Stateful "Enemy N" namer for the player view. Call once per assembled
 *  list, in visible initiative order: non-PC rows without identity revealed
 *  consume the next number; everything else keeps its real name. */
export function makePlaceholderNamer(): (r: {
  kind: string;
  name: string;
  reveals: ParticipantReveals;
}) => string {
  let idx = 0;
  return (r) => (r.kind !== 'pc' && !r.reveals.identity ? `Enemy ${++idx}` : r.name);
}

export interface LiteParticipantRow extends InitiativeSortable {
  id: string;
  kind: string;
  characterId: string | null;
  name: string;
  reveals: ParticipantReveals;
}

/** Sort, filter, and redact raw rows into the poll's wire list for the
 *  given viewer role. DM sees everything unredacted; players lose hidden
 *  rows entirely and unrevealed non-PC names become "Enemy N". */
export function buildLiveParticipantList(
  rows: LiteParticipantRow[],
  isDM: boolean
): LiveParticipant[] {
  const sorted = [...rows].sort(initiativeCompare);
  const visible = isDM ? sorted : sorted.filter((r) => r.kind === 'pc' || !r.reveals.hidden);
  const nameFor = makePlaceholderNamer();
  return visible.map((r) => {
    const label = isDM ? r.name : nameFor(r);
    return {
      id: r.id,
      kind: r.kind,
      characterId: r.characterId,
      name: label,
      placeholderName: label,
      initiative: r.initiative,
      sortOrder: r.sortOrder,
      reveals: r.reveals
    };
  });
}
