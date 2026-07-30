// Shared dungeon-instance load + wire shaping — the WS5 sibling of
// ./board.ts, and the same discipline: one redaction path per secret,
// shared by the floor REST route, the SSR encounter loader and the poll.

import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import {
  hiddenFog,
  maskTilesForPlayer,
  parseAnnotations
} from '$lib/server/api/board-schemas';
import { parseLinks, type TFloorWire, type TWireFloorLink } from '$lib/server/api/dungeon-schemas';
import { visibleAnnotations, visibleFloorLinks } from '$lib/encounter/board-visibility';
import { decodeRuns } from '$lib/board/rle';
import type { FloorLink } from '$lib/board/dungeon';

export type DungeonInstanceRow = typeof schema.dungeonInstances.$inferSelect;

/** Floor summaries for a *library* dungeon, in floor order — the maps rows
 *  wearing their dungeon membership. */
export async function libraryFloorsOf(dungeonId: string) {
  const rows = await db
    .select({
      mapId: schema.maps.id,
      floorIdx: schema.maps.floorIdx,
      name: schema.maps.name,
      w: schema.maps.w,
      h: schema.maps.h,
      cellFt: schema.maps.cellFt
    })
    .from(schema.maps)
    .where(eq(schema.maps.dungeonId, dungeonId))
    .orderBy(asc(schema.maps.floorIdx));
  return rows.map((f) => ({ ...f, floorIdx: f.floorIdx ?? 0 }));
}
export type InstanceFloorRow = typeof schema.instanceFloors.$inferSelect;

export async function loadInstance(instanceId: string): Promise<DungeonInstanceRow | undefined> {
  const rows = await db
    .select()
    .from(schema.dungeonInstances)
    .where(eq(schema.dungeonInstances.id, instanceId))
    .limit(1);
  return rows[0];
}

export async function loadInstanceFloors(instanceId: string): Promise<InstanceFloorRow[]> {
  return db
    .select()
    .from(schema.instanceFloors)
    .where(eq(schema.instanceFloors.instanceId, instanceId))
    .orderBy(asc(schema.instanceFloors.floorIdx));
}

export async function loadInstanceFloor(
  instanceId: string,
  floorIdx: number
): Promise<InstanceFloorRow | undefined> {
  const rows = await db
    .select()
    .from(schema.instanceFloors)
    .where(
      and(
        eq(schema.instanceFloors.instanceId, instanceId),
        eq(schema.instanceFloors.floorIdx, floorIdx)
      )
    )
    .limit(1);
  return rows[0];
}

/** Copy-on-instantiate: snapshot a library dungeon's floors and links into
 *  a campaign instance. Fog starts fully hidden on every floor; the library
 *  rows are never touched again — editing the dungeon later never mutates a
 *  live crawl. Returns the new instance id. */
export async function instantiateDungeon(
  campaignId: string,
  dungeon: { id: string; name: string; linksJson: string | null },
  floors: Array<{
    floorIdx: number | null;
    name: string;
    w: number;
    h: number;
    cellFt: number;
    tilesJson: string;
    backgroundPath: string | null;
  }>
): Promise<string> {
  const instanceId = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.dungeonInstances).values({
    id: instanceId,
    campaignId,
    dungeonId: dungeon.id,
    name: dungeon.name,
    linksJson: dungeon.linksJson,
    version: 1,
    createdAt: now,
    updatedAt: now
  });
  if (floors.length > 0) {
    await db.insert(schema.instanceFloors).values(
      floors.map((f) => ({
        instanceId,
        floorIdx: f.floorIdx ?? 0,
        name: f.name,
        w: f.w,
        h: f.h,
        cellFt: f.cellFt,
        tilesJson: f.tilesJson,
        revealedJson: hiddenFog(f.w, f.h),
        annotationsJson: null,
        backgroundPath: f.backgroundPath,
        version: 1
      }))
    );
  }
  return instanceId;
}

/** Role-redacted wire shape for one floor — the dungeon sibling of
 *  `boardWire`, same rules: players get fog-masked tiles, no background,
 *  and only the notes they've earned. */
export function floorWire(floor: InstanceFloorRow, isDM: boolean): TFloorWire {
  const annotations = parseAnnotations(floor.annotationsJson);
  return {
    instanceId: floor.instanceId,
    floorIdx: floor.floorIdx,
    name: floor.name,
    w: floor.w,
    h: floor.h,
    cellFt: floor.cellFt,
    tiles: isDM
      ? floor.tilesJson
      : maskTilesForPlayer(floor.tilesJson, floor.revealedJson, floor.w, floor.h),
    revealed: floor.revealedJson,
    background: isDM ? floor.backgroundPath : null,
    annotations: visibleAnnotations(annotations, floor, isDM),
    version: floor.version
  };
}

/** Whether a floor has any revealed cell — the player-facing existence
 *  test. Fails closed on a corrupt mask, like every fog consumer. */
export function floorHasRevealedCell(floor: {
  w: number;
  h: number;
  revealedJson: string;
}): boolean {
  try {
    const fog = decodeRuns(floor.revealedJson, floor.w * floor.h);
    return fog.some((bit) => bit === 1);
  } catch {
    return false;
  }
}

/** The floor list a viewer may see. DM: all. Player: floors with ≥1
 *  revealed cell — the *count* of other floors is information ("there are
 *  three more levels" spoils the crawl as surely as showing their tiles). */
export function visibleFloorList(
  floors: readonly InstanceFloorRow[],
  isDM: boolean
): Array<{ idx: number; name: string }> {
  return floors
    .filter((f) => isDM || floorHasRevealedCell(f))
    .map((f) => ({ idx: f.floorIdx, name: f.name }));
}

/** Role-shaped links for an instance: DM full, players per the
 *  near-endpoint rule (see visibleFloorLinks). */
export function instanceWireLinks(
  instance: Pick<DungeonInstanceRow, 'linksJson'>,
  floors: readonly InstanceFloorRow[],
  isDM: boolean
): TWireFloorLink[] {
  const links: FloorLink[] = parseLinks(instance.linksJson);
  return visibleFloorLinks(
    links,
    floors.map((f) => ({ floorIdx: f.floorIdx, w: f.w, h: f.h, revealedJson: f.revealedJson })),
    isDM
  );
}
