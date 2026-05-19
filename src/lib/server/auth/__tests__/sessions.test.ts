import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, schema } from '../../__tests__/test-db';
import {
  createSession,
  destroySession,
  loadUserFromCookie,
  SESSION_COOKIE
} from '../sessions';
import type { Cookies } from '@sveltejs/kit';

/** Tiny in-memory Cookies impl that mimics SvelteKit's Cookies API. We
 *  only need .get / .set / .delete on a single cookie. */
function makeCookies(): Cookies & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: (name: string) => store.get(name),
    set: vi.fn((name: string, value: string) => store.set(name, value)),
    delete: vi.fn((name: string) => store.delete(name)),
    serialize: vi.fn(() => ''),
    getAll: vi.fn(() => [])
  } as unknown as Cookies & { _store: Map<string, string> };
}

async function seedUser(db: ReturnType<typeof setupTestDb>) {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    username: 'alice',
    passwordHash: 'salt:hash',
    isAdmin: false,
    createdAt: new Date()
  });
  return id;
}

describe('sessions', () => {
  let db: ReturnType<typeof setupTestDb>;
  beforeEach(() => {
    db = setupTestDb();
  });

  // Locks the create → read happy path. A regression in cookie name or
  // the DB join silently logs every user out.
  it('createSession writes a row + sets the cookie + loadUserFromCookie returns the user', async () => {
    const userId = await seedUser(db);
    const cookies = makeCookies();

    const sessionId = await createSession(userId, cookies);
    expect(cookies._store.get(SESSION_COOKIE)).toBe(sessionId);

    const rows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(userId);

    const user = await loadUserFromCookie(cookies);
    expect(user).toEqual({ id: userId, username: 'alice', isAdmin: false });
  });

  it('loadUserFromCookie returns null when there is no cookie', async () => {
    expect(await loadUserFromCookie(makeCookies())).toBeNull();
  });

  // Locks: expired sessions are treated as logged-out + the cookie is
  // proactively cleared.
  it('loadUserFromCookie returns null and clears the cookie when the session has expired', async () => {
    const userId = await seedUser(db);
    const cookies = makeCookies();
    const expiredId = crypto.randomUUID();
    await db.insert(schema.sessions).values({
      id: expiredId,
      userId,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date()
    });
    cookies._store.set(SESSION_COOKIE, expiredId);

    const user = await loadUserFromCookie(cookies);
    expect(user).toBeNull();
    expect(cookies.delete).toHaveBeenCalledWith(SESSION_COOKIE, { path: '/' });
  });

  // Locks the destroySession flow — both the DB row and the cookie go.
  it('destroySession deletes the DB row and clears the cookie', async () => {
    const userId = await seedUser(db);
    const cookies = makeCookies();
    const sessionId = await createSession(userId, cookies);

    await destroySession(cookies);
    expect(cookies.delete).toHaveBeenCalledWith(SESSION_COOKIE, { path: '/' });
    const rows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
    expect(rows.length).toBe(0);
  });

  it('destroySession is a no-op when there is no cookie', async () => {
    const cookies = makeCookies();
    await destroySession(cookies);
    expect(cookies.delete).toHaveBeenCalled();
  });
});
