import { and, eq, gt, lt, ne } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { db, schema } from '$lib/server/db';

export const SESSION_COOKIE = 'grimoire_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(userId: string, cookies: Cookies): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ id, userId, expiresAt, createdAt: now });
  cookies.set(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  });
  return id;
}

export async function destroySession(cookies: Cookies): Promise<void> {
  const id = cookies.get(SESSION_COOKIE);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  if (!id) return;
  await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export async function destroyAllSessionsExcept(userId: string, exceptId: string): Promise<void> {
  await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, exceptId)));
}

export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}

export interface SessionUser {
  id: string;
  username: string;
  isAdmin: boolean;
  email: string | null;
  emailVerified: boolean;
}

export async function loadUserFromCookie(cookies: Cookies): Promise<SessionUser | null> {
  const id = cookies.get(SESSION_COOKIE);
  if (!id) return null;
  const now = new Date();
  const rows = await db
    .select({
      userId: schema.sessions.userId,
      username: schema.users.username,
      isAdmin: schema.users.isAdmin,
      email: schema.users.email,
      emailVerifiedAt: schema.users.emailVerifiedAt
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, now)))
    .limit(1);
  if (rows.length === 0) {
    cookies.delete(SESSION_COOKIE, { path: '/' });
    return null;
  }
  return {
    id: rows[0].userId,
    username: rows[0].username,
    isAdmin: rows[0].isAdmin,
    email: rows[0].email,
    emailVerified: rows[0].emailVerifiedAt !== null
  };
}
