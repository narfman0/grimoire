import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '$lib/server/__tests__/test-db';
import { seedUser } from '$lib/server/__tests__/fixtures';
import { makeEvent, expectHttpError } from '$lib/server/__tests__/test-event';
import { PATCH, DELETE } from '../+server';

type Db = ReturnType<typeof setupTestDb>;

const userOf = (id: string, username: string, isAdmin: boolean) =>
  ({ id, username, isAdmin, email: null, emailVerified: false });

describe('admin raw table editor', () => {
  let db: Db;
  beforeEach(() => { db = setupTestDb(); });

  it('rejects non-admin users (403)', async () => {
    const userId = await seedUser(db, { username: 'pleb' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(userId, 'pleb', false),
          params: { table: 'users' },
          body: { rowid: 1, column: 'username', value: 'x' }
        })
      ),
      403
    );
  });

  it('rejects unknown tables (404)', async () => {
    const adminId = await seedUser(db, { username: 'admin' });
    await expectHttpError(
      DELETE(
        makeEvent({
          user: userOf(adminId, 'admin', true),
          params: { table: 'users; DROP TABLE users' },
          body: { rowid: 1 },
          method: 'DELETE'
        })
      ),
      404
    );
  });

  it('lets an admin edit a benign column', async () => {
    const adminId = await seedUser(db, { username: 'admin' });
    await seedUser(db, { username: 'target' }); // rowid 2 in a fresh table
    const res = await PATCH(
      makeEvent({
        user: userOf(adminId, 'admin', true),
        params: { table: 'users' },
        body: { rowid: 2, column: 'username', value: 'renamed' }
      })
    );
    expect(res.status).toBe(200);
  });

  // Regression: the raw editor could rewrite password_hash, is_admin, and
  // membership roles — a stolen admin session became full account takeover
  // of every user. Auth-critical columns are blocked.
  it('blocks auth-critical columns (403)', async () => {
    const adminId = await seedUser(db, { username: 'admin' });
    await seedUser(db, { username: 'victim' });
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(adminId, 'admin', true),
          params: { table: 'users' },
          body: { rowid: 2, column: 'password_hash', value: 'attacker-hash' }
        })
      ),
      403
    );
    await expectHttpError(
      PATCH(
        makeEvent({
          user: userOf(adminId, 'admin', true),
          params: { table: 'users' },
          body: { rowid: 2, column: 'is_admin', value: 1 }
        })
      ),
      403
    );
    // And the row is untouched.
    const rows = await db.select().from(schema.users).where(eq(schema.users.username, 'victim'));
    expect(rows[0].isAdmin).toBe(false);
  });
});
