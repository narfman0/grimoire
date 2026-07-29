// Manual initiative reordering.
//
// THE INTERACTION, AND WHY.
//
// `sortOrder` alone cannot express a manual order: the list is sorted by
// initiative first (see initiativeCompare in $lib/realtime/participants), so
// dragging a 12 above a 15 while only touching sortOrder would visibly do
// nothing — the comparator would put it straight back. So a drop writes
// BOTH:
//
//   1. the dragged row's `initiative`, set to the initiative of the row it
//      now sits directly below (or, when dropped at the top, the row now
//      directly below it). That lands it in the right initiative band, and
//      it is the same thing a DM does by hand today — "you go right after
//      the dragon, call it a 24 too".
//   2. a dense `sortOrder` (0..n-1) over the whole list, which the
//      comparator consults before the dex tiebreak, so the exact dropped
//      order survives a re-sort.
//
// Nothing is stored as a hidden "manual override" layer, which is the point:
// there is no invisible state for a later action to silently discard. The
// consequences are all visible in the initiative column, and specifically:
//
//   - "Roll initiative (NPCs)" only fills rows whose initiative is null. A
//     dragged row always has one, so a later roll can never move it.
//   - Editing a row's initiative by hand afterwards is a deliberate
//     re-placement and does override the drag — as it should.
//   - Dragging an unrolled row up into the rolled part of the list gives it
//     a real initiative (it has to, to sort there). It stops being "not
//     rolled yet"; the number appears in its cell so the DM can see it.

export interface ReorderRow {
  id: string;
  initiative: number | null;
  sortOrder: number;
}

export interface ReorderPatch {
  id: string;
  /** Present only for the dragged row. */
  initiative?: number | null;
  sortOrder: number;
}

/** Move `fromIndex` to `toIndex` within a list already in display order and
 *  return the minimal set of writes. Returns an empty list when the move is
 *  a no-op or the indices are out of range, so a stray drop costs nothing.
 *
 *  The result is deliberately expressed as whole-list patches: the caller
 *  sends them in one bulk request, because a per-row loop leaves the list
 *  visibly inconsistent (and, if it fails halfway, permanently so). */
export function reorderInitiative(
  rows: ReadonlyArray<ReorderRow>,
  fromIndex: number,
  toIndex: number
): ReorderPatch[] {
  if (fromIndex < 0 || fromIndex >= rows.length) return [];
  if (toIndex < 0 || toIndex >= rows.length) return [];
  if (fromIndex === toIndex) return [];

  const next = [...rows];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  // The dragged row adopts the initiative of its new upstairs neighbour so
  // the sequence stays non-increasing; dropped at the top it adopts the one
  // below instead (tying with the new runner-up, and winning on sortOrder).
  const above = toIndex > 0 ? next[toIndex - 1] : null;
  const below = toIndex + 1 < next.length ? next[toIndex + 1] : null;
  const adoptedInitiative = above ? above.initiative : (below?.initiative ?? moved.initiative);

  const patches: ReorderPatch[] = [];
  next.forEach((row, index) => {
    const isMoved = row.id === moved.id;
    const initiativeChanged = isMoved && adoptedInitiative !== row.initiative;
    if (row.sortOrder === index && !initiativeChanged) return;
    patches.push({
      id: row.id,
      sortOrder: index,
      ...(initiativeChanged ? { initiative: adoptedInitiative } : {})
    });
  });
  return patches;
}

/** Apply patches to a row list — the optimistic client-side mirror of what
 *  the bulk endpoint does, and what the tests assert the comparator against. */
export function applyReorderPatches<T extends ReorderRow>(
  rows: ReadonlyArray<T>,
  patches: ReadonlyArray<ReorderPatch>
): T[] {
  const byId = new Map(patches.map((p) => [p.id, p]));
  return rows.map((r) => {
    const patch = byId.get(r.id);
    if (!patch) return r;
    return {
      ...r,
      sortOrder: patch.sortOrder,
      ...(patch.initiative !== undefined ? { initiative: patch.initiative } : {})
    };
  });
}
