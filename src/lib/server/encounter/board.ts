// Shared board load + wire shaping for the board REST route and the SSR
// encounter loader — one redaction path for tile data, mirroring how
// buildLiveParticipantList is the one path for the participant list.

import { eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { maskTilesForPlayer } from '$lib/server/api/board-schemas';

export type EncounterBoardRow = typeof schema.encounterBoards.$inferSelect;

export async function loadEncounterBoard(encounterId: string): Promise<EncounterBoardRow | undefined> {
  const rows = await db
    .select()
    .from(schema.encounterBoards)
    .where(eq(schema.encounterBoards.encounterId, encounterId))
    .limit(1);
  return rows[0];
}

export interface BoardWireShape {
  encounterId: string;
  sourceMapId: string | null;
  w: number;
  h: number;
  cellFt: number;
  tiles: string;
  revealed: string;
  background: string | null;
  version: number;
}

/** Role-redacted wire shape: players get unrevealed cells masked to void
 *  and never the background URL (it would leak the layout under the fog). */
export function boardWire(board: EncounterBoardRow, isDM: boolean): BoardWireShape {
  return {
    encounterId: board.encounterId,
    sourceMapId: board.sourceMapId,
    w: board.w,
    h: board.h,
    cellFt: board.cellFt,
    tiles: isDM
      ? board.tilesJson
      : maskTilesForPlayer(board.tilesJson, board.revealedJson, board.w, board.h),
    revealed: board.revealedJson,
    background: isDM ? board.backgroundPath : null,
    version: board.version
  };
}
