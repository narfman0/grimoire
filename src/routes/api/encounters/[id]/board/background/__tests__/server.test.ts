import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser, seedCampaign, seedEncounter } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';

// The upload writes to the /data volume; the interesting behaviour here is
// the permission shape, the version bump and the stored URL, so the
// filesystem is a spy.
const written: Array<{ path: string; bytes: number }> = [];
const unlinked: string[] = [];
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (path: string, buf: Buffer) => {
    written.push({ path: String(path), bytes: buf.length });
  }),
  unlink: vi.fn(async (path: string) => {
    unlinked.push(String(path));
  })
}));

const { POST, DELETE } = await import('../+server');
const { PUT: ATTACH } = await import('../../+server');

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, name: string) => ({
  id,
  username: name,
  isAdmin: false,
  email: null,
  emailVerified: false
});

async function fixture(db: Db) {
  const dmId = await seedUser(db, { username: 'dm' });
  const playerId = await seedUser(db, { username: 'player' });
  const { campaignId } = await seedCampaign(db, { dmId, playerIds: [playerId] });
  const encounterId = await seedEncounter(db, { campaignId, status: 'live' });
  return { dm: userOf(dmId, 'dm'), player: userOf(playerId, 'player'), encounterId };
}

function upload(name = 'map.png', type = 'image/png', bytes = 32) {
  const fd = new FormData();
  fd.append('background', new File([new Uint8Array(bytes)], name, { type }));
  return fd;
}

const boardOf = async (db: Db, encounterId: string) =>
  (
    await db
      .select()
      .from(schema.encounterBoards)
      .where(eq(schema.encounterBoards.encounterId, encounterId))
  )[0];

async function attachBlank(db: Db, dm: ReturnType<typeof userOf>, encounterId: string) {
  await ATTACH(
    makeEvent({ user: dm, params: { id: encounterId }, body: { w: 4, h: 4 }, method: 'PUT' })
  );
}

describe('/api/encounters/[id]/board/background', () => {
  let db: Db;
  beforeEach(() => {
    db = setupTestDb();
    written.length = 0;
    unlinked.length = 0;
  });

  it('stores the image under an encounter-scoped key and bumps the version', async () => {
    const { dm, encounterId } = await fixture(db);
    await attachBlank(db, dm, encounterId);
    const before = await boardOf(db, encounterId);

    const res = await POST(
      makeEvent({ user: dm, params: { id: encounterId }, formData: upload(), method: 'POST' })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: `/api/map-backgrounds/enc-${encounterId}` });
    // `enc-` prefixed so an encounter background can never collide with a
    // library map's file of the same uuid.
    expect(written[0].path).toBe(`/data/map-backgrounds/enc-${encounterId}.png`);

    const after = await boardOf(db, encounterId);
    expect(after.backgroundPath).toBe(`/api/map-backgrounds/enc-${encounterId}`);
    // The version bump is what makes other tabs refetch the board.
    expect(after.version).toBe(before.version + 1);
  });

  it('removes stale formats so the serve route cannot answer with the old image', async () => {
    const { dm, encounterId } = await fixture(db);
    await attachBlank(db, dm, encounterId);
    await POST(
      makeEvent({
        user: dm,
        params: { id: encounterId },
        formData: upload('map.webp', 'image/webp'),
        method: 'POST'
      })
    );
    expect(written[0].path.endsWith('.webp')).toBe(true);
    expect(unlinked).toEqual([
      `/data/map-backgrounds/enc-${encounterId}.jpg`,
      `/data/map-backgrounds/enc-${encounterId}.jpeg`,
      `/data/map-backgrounds/enc-${encounterId}.png`
    ]);
  });

  it('clears the path and every file on DELETE, bumping the version again', async () => {
    const { dm, encounterId } = await fixture(db);
    await attachBlank(db, dm, encounterId);
    await POST(
      makeEvent({ user: dm, params: { id: encounterId }, formData: upload(), method: 'POST' })
    );
    const afterUpload = await boardOf(db, encounterId);
    unlinked.length = 0;

    const res = await DELETE(
      makeEvent({ user: dm, params: { id: encounterId }, method: 'DELETE' })
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(unlinked).toHaveLength(4); // jpg, jpeg, png, webp
    const after = await boardOf(db, encounterId);
    expect(after.backgroundPath).toBeNull();
    expect(after.version).toBe(afterUpload.version + 1);
  });

  it('rejects a missing field and an unsupported type', async () => {
    const { dm, encounterId } = await fixture(db);
    await attachBlank(db, dm, encounterId);
    await expectHttpError(
      POST(
        makeEvent({ user: dm, params: { id: encounterId }, formData: new FormData(), method: 'POST' })
      ),
      400
    );
    await expectHttpError(
      POST(
        makeEvent({
          user: dm,
          params: { id: encounterId },
          formData: upload('map.gif', 'image/gif'),
          method: 'POST'
        })
      ),
      415
    );
    expect(written).toEqual([]);
  });

  it('is DM-only and needs a board to be attached', async () => {
    const { dm, player, encounterId } = await fixture(db);
    // No board yet — even the DM gets a 404.
    await expectHttpError(
      POST(makeEvent({ user: dm, params: { id: encounterId }, formData: upload(), method: 'POST' })),
      404
    );
    await attachBlank(db, dm, encounterId);
    await expectHttpError(
      POST(
        makeEvent({ user: player, params: { id: encounterId }, formData: upload(), method: 'POST' })
      ),
      403
    );
    await expectHttpError(
      DELETE(makeEvent({ user: player, params: { id: encounterId }, method: 'DELETE' })),
      403
    );
    expect(written).toEqual([]);
  });
});
