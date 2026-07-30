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

/** A corrupt fog row must fail closed (nothing visible), not open. */
function safeDecode(encoded: string, len: number): Uint16Array {
  try {
    return decodeRuns(encoded, len);
  } catch {
    return new Uint16Array(len); // all zeros = all hidden
  }
}
