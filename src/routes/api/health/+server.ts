import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  await db.run(sql`SELECT 1`);
  return json({ status: 'ok' });
};

export const _openapi = {
  GET: { summary: 'Health check — returns ok if the database is reachable' }
} as const;
