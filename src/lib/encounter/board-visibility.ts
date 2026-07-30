// Which token positions a viewer may see. Shared by the /state poll and the
// SSR encounter loader — same rule as buildLiveParticipantList: never write
// a second (or third) redaction path for the same secret.
//
// DM: every placed token. Player: hidden participants must already be
// filtered from `rows` by the caller (both callers filter on reveals), and
// any token whose footprint sits entirely in unrevealed fog is dropped —
// "where is the hidden thing" must not leak through coordinates.

import { decodeRuns } from '$lib/board/rle';

export interface TokenPositionRow {
  id: string;
  posX: number | null;
  posY: number | null;
  sizeCells: number;
}

export interface FogBoard {
  w: number;
  h: number;
  revealedJson: string;
}

export interface TokenPosition {
  x: number;
  y: number;
  sizeCells: number;
}

export function visibleTokenPositions(
  rows: readonly TokenPositionRow[],
  board: FogBoard | null | undefined,
  isDM: boolean
): Record<string, TokenPosition> {
  const fog = board && !isDM ? safeDecode(board.revealedJson, board.w * board.h) : null;
  const out: Record<string, TokenPosition> = {};
  for (const p of rows) {
    if (p.posX === null || p.posY === null) continue;
    const size = Math.max(1, p.sizeCells);
    if (fog && board) {
      let anyRevealed = false;
      for (let dy = 0; dy < size && !anyRevealed; dy++) {
        for (let dx = 0; dx < size && !anyRevealed; dx++) {
          const x = p.posX + dx;
          const y = p.posY + dy;
          if (x < board.w && y < board.h && fog[y * board.w + x] === 1) anyRevealed = true;
        }
      }
      if (!anyRevealed) continue;
    }
    out[p.id] = { x: p.posX, y: p.posY, sizeCells: size };
  }
  return out;
}

export interface CellNote {
  note: string;
  dmOnly?: boolean;
}

/** Which cell notes a viewer may read.
 *
 *  DM: all of them. Player: notes the DM didn't mark `dmOnly`, on cells the
 *  fog has revealed. Both halves matter — a `dmOnly` note is the DM's own
 *  prep ("the lever is a trap"), and a note on a fogged cell is a tell in
 *  itself: "10 ft ledge" arriving for a room the party hasn't entered says
 *  there's a room.
 *
 *  Same shape and the same fail-closed posture as `visibleTokenPositions`
 *  above, and the same reason for living here: the board GET redacts for the
 *  requesting viewer, but table mode renders the player lens even for a DM,
 *  so it re-applies this client-side rather than growing a second rule. */
export function visibleAnnotations(
  annotations: Record<string, CellNote> | null | undefined,
  board: FogBoard | null | undefined,
  isDM: boolean
): Record<string, CellNote> {
  if (!annotations) return {};
  const keys = Object.keys(annotations);
  if (keys.length === 0) return {};
  if (isDM) return { ...annotations };
  if (!board) return {};
  const fog = safeDecode(board.revealedJson, board.w * board.h);
  const out: Record<string, CellNote> = {};
  for (const key of keys) {
    const entry = annotations[key];
    if (entry.dmOnly) continue;
    const [x, y] = key.split(',').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
    if (x < 0 || y < 0 || x >= board.w || y >= board.h) continue;
    if (fog[y * board.w + x] !== 1) continue;
    out[key] = { note: entry.note };
  }
  return out;
}

export interface VisibleFloorLink {
  id: string;
  kind: string;
  costFt: number;
  oneWay?: boolean;
  a: { floorIdx: number; x: number; y: number };
  /** Null for a player who hasn't revealed the far end — the stairs they
   *  found "lead somewhere" until they see where. */
  b: { floorIdx: number; x: number; y: number } | null;
}

/** Which floor links a viewer may see, and how much of each.
 *
 *  DM: everything. Player: a link ships only when at least one endpoint
 *  sits on a revealed cell; the revealed endpoint is normalized into `a`
 *  and the far end ships only if it too is revealed. Both endpoints
 *  fogged → the link doesn't exist yet, because a portal's position is a
 *  tell exactly like a note's ("stairs here" says there's a here).
 *
 *  Same fail-closed posture as everything else in this module: a floor
 *  whose fog mask can't be read reveals nothing. */
export function visibleFloorLinks(
  links: readonly VisibleFloorLink[] | readonly (Omit<VisibleFloorLink, 'b'> & {
    b: { floorIdx: number; x: number; y: number };
  })[],
  floors: readonly (FogBoard & { floorIdx: number })[],
  isDM: boolean
): VisibleFloorLink[] {
  if (isDM) return links.map((l) => ({ ...l }));
  const fogByFloor = new Map<number, { w: number; h: number; fog: Uint16Array }>();
  for (const f of floors) {
    fogByFloor.set(f.floorIdx, { w: f.w, h: f.h, fog: safeDecode(f.revealedJson, f.w * f.h) });
  }
  const revealed = (e: { floorIdx: number; x: number; y: number }): boolean => {
    const f = fogByFloor.get(e.floorIdx);
    if (!f) return false;
    if (e.x < 0 || e.y < 0 || e.x >= f.w || e.y >= f.h) return false;
    return f.fog[e.y * f.w + e.x] === 1;
  };
  const out: VisibleFloorLink[] = [];
  for (const l of links) {
    if (!l.b) continue; // defensive: inputs are full links server-side
    const aSeen = revealed(l.a);
    const bSeen = revealed(l.b);
    if (!aSeen && !bSeen) continue;
    const near = aSeen ? l.a : l.b;
    const far = aSeen ? l.b : l.a;
    out.push({
      id: l.id,
      kind: l.kind,
      costFt: l.costFt,
      ...(l.oneWay ? { oneWay: true } : {}),
      a: near,
      b: aSeen && bSeen ? far : null
    });
  }
  return out;
}

/** A corrupt fog row must fail closed (nothing visible), not open. */
function safeDecode(encoded: string, len: number): Uint16Array {
  try {
    return decodeRuns(encoded, len);
  } catch {
    return new Uint16Array(len); // all zeros = all hidden
  }
}
