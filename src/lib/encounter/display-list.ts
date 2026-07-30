// Participant-list assembly for table mode (the /display view).
//
// Table mode is ALWAYS rendered with player redaction, whoever opened it:
// it is a screen in the middle of the table, so the DM projecting it must
// not put their own hidden ambush on the wall. SSR gets that for free by
// calling buildEncounterPageData(..., isDM=false).
//
// The 2s poll can't: GET /api/encounters/[id]/state redacts for the
// *viewer*, so a DM's poll snapshot carries hidden rows and real names, and
// grafting it onto the page straight would leak them ~2s after load. Rather
// than a display-only endpoint or (worse) a third redaction implementation,
// the poll list is pushed back through `buildLiveParticipantList(rows,
// /* isDM */ false)` — the very function the endpoint uses — which drops
// hidden rows and re-applies the "Enemy N" naming by visible position. For
// a player's already-redacted snapshot the second pass is a no-op.

import {
  buildLiveParticipantList,
  type LiveParticipant
} from '$lib/realtime/participants';
import type { ParticipantReveals } from '$lib/realtime/reveals';

/** The slice of a participant table mode renders. Structural subset of both
 *  the SSR page row and (after merging) the poll entry. */
export interface DisplayParticipant {
  id: string;
  name: string;
  kind: string;
  initiative: number | null;
  currentHp: number | null;
  maxHp: number | null;
  tempHp: number;
  /** Server-computed health band. The only HP signal for a row whose vitals
   *  aren't revealed — the numbers above come through null, because they are
   *  redacted before they leave the server rather than merely hidden here. */
  hpBucket?: string | null;
  conditions: string[];
  reveals: ParticipantReveals;
}

/** The poll's per-participant HP entry (EncounterSnapshot['participantHp']
 *  plus the endpoint's `maxHp`, which the channel type doesn't declare). */
export interface DisplayHp {
  currentHp: number | null;
  tempHp: number;
  maxHp?: number | null;
  hpBucket?: string;
  conditions: string[];
}

/** Re-redact a poll participant list down to what a player may see.
 *
 *  The list arrives already sorted by the server (initiative, then dex, then
 *  insertion order). `buildLiveParticipantList` re-sorts, and the wire shape
 *  carries no dex score — so pass a constant dex and the current index as
 *  `sortOrder`, which makes the re-sort a stable no-op over an already
 *  ordered list instead of reshuffling rows that tie on initiative. */
export function redactLiveParticipants(live: LiveParticipant[]): LiveParticipant[] {
  return buildLiveParticipantList(
    live.map((e, i) => ({
      id: e.id,
      kind: e.kind,
      characterId: e.characterId,
      name: e.name,
      reveals: e.reveals,
      initiative: e.initiative,
      dexScore: 0,
      sortOrder: i
    })),
    false
  );
}

/** Merge the SSR rows (authoritative for max HP and the initial HP/condition
 *  seed) with the poll snapshot (authoritative for membership, order, names,
 *  reveal flags and live HP/conditions). Returns rows in display order.
 *
 *  `live === null` means the first poll hasn't landed — the SSR rows are
 *  already player-redacted, so they stand as-is. */
export function mergeDisplayParticipants(
  ssrRows: DisplayParticipant[],
  live: LiveParticipant[] | null,
  hp: Record<string, DisplayHp> = {}
): DisplayParticipant[] {
  const ssrById = new Map(ssrRows.map((p) => [p.id, p]));
  const ordered: Array<{ id: string; base: DisplayParticipant | undefined; entry?: LiveParticipant }> =
    live === null
      ? ssrRows.map((p) => ({ id: p.id, base: p }))
      : redactLiveParticipants(live).map((e) => ({ id: e.id, base: ssrById.get(e.id), entry: e }));

  return ordered.map(({ id, base, entry }) => {
    const h = hp[id];
    return {
      id,
      // The poll name has been through the player namer above; the SSR name
      // through the loader's player branch. Either way it is never a real
      // name the viewer hasn't earned.
      name: entry ? entry.name : base?.name ?? '',
      kind: entry?.kind ?? base?.kind ?? 'npc',
      initiative: entry ? entry.initiative : base?.initiative ?? null,
      currentHp: h ? h.currentHp : base?.currentHp ?? null,
      tempHp: h ? h.tempHp : base?.tempHp ?? 0,
      // PC rows come back from the poll with maxHp null (it needs derive());
      // the SSR row has it.
      maxHp: h?.maxHp ?? base?.maxHp ?? null,
      hpBucket: h?.hpBucket ?? base?.hpBucket ?? null,
      conditions: h ? h.conditions : base?.conditions ?? [],
      reveals: entry?.reveals ??
        base?.reveals ?? { identity: false, vitals: false, combat: false, hidden: false }
    };
  });
}

/** Whether this row's exact HP may be shown. Mirrors the participant row
 *  card's rule minus the DM branch — table mode has no DM branch. */
export function showsExactHp(p: Pick<DisplayParticipant, 'kind' | 'reveals' | 'maxHp'>): boolean {
  return p.maxHp != null && (p.kind === 'pc' || p.reveals.vitals);
}
