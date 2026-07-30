// Fog masking over the RLE tile layer. Isomorphic on purpose: the server
// applies it before a player response leaves the load layer, and the
// table-mode display re-applies it client-side so a DM-authenticated shared
// screen still renders the player view.

import { decodeRuns, encodeRuns } from './rle';
import { VOID_TILE_ID } from './tileset';

/** Mask unrevealed tile codes to void. Throws on grid/string mismatch —
 *  callers validate or catch. */
export function maskTilesForPlayer(
  tiles: string,
  revealed: string,
  w: number,
  h: number
): string {
  const tileArr = decodeRuns(tiles, w * h);
  const fog = decodeRuns(revealed, w * h);
  const out = new Array<number>(w * h);
  for (let i = 0; i < out.length; i++) {
    out[i] = fog[i] === 1 ? tileArr[i] : VOID_TILE_ID;
  }
  return encodeRuns(out);
}
