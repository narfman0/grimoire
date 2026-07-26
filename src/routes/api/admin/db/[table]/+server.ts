import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { sqlite } from '$lib/server/db';
import { parseJson } from '$lib/server/api/validate';
import { invalidateContentCache } from '$lib/server/content/cache';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

type ColInfo = { name: string };

// Auth-critical columns the raw table editor must never touch — password
// hashes go through the change-password flow, roles/status through the
// membership endpoints, admin promotion through ADMIN_USERNAME at boot.
const BLOCKED_COLUMNS: Record<string, string[]> = {
  users: ['password_hash', 'is_admin', 'password_reset_token', 'email_verify_token'],
  campaign_members: ['role', 'status']
};

const PatchRequest = z.object({
  rowid: z.number().int(),
  column: z.string().min(1),
  value: z.unknown()
});
const DeleteRequest = z.object({ rowid: z.number().int() });
const InsertRequest = z.record(z.string(), z.unknown());

function requireAdmin(locals: App.Locals) {
  if (!locals.user) throw error(401, 'login required');
  if (!locals.user.isAdmin) throw error(403, 'admin only');
  return locals.user;
}

function validateTable(name: string) {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  if (!row) throw error(404, `Table "${name}" not found`);
}

function getColumns(tableName: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info("${tableName}")`).all() as ColInfo[]).map(
    (c) => c.name
  );
}

function assertColumnAllowed(table: string, column: string) {
  if (BLOCKED_COLUMNS[table]?.includes(column)) {
    throw error(403, `column "${column}" cannot be edited through the raw table editor`);
  }
}

/** The raw editor can touch the content/packs tables — flush the pack
 *  lookup cache when it does. */
function maybeInvalidateContent(table: string) {
  if (table === 'content' || table === 'packs') invalidateContentCache();
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const admin = requireAdmin(locals);
  validateTable(params.table);
  const { rowid, column, value } = await parseJson(request, PatchRequest);
  const cols = getColumns(params.table);
  if (!cols.includes(column)) throw error(400, 'unknown column');
  assertColumnAllowed(params.table, column);
  sqlite
    .prepare(`UPDATE "${params.table}" SET "${column}" = ? WHERE rowid = ?`)
    .run(value as string | number | null, rowid);
  maybeInvalidateContent(params.table);
  logger.info(
    { userId: admin.id, table: params.table, column, rowid },
    'admin raw table edit'
  );
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
  const admin = requireAdmin(locals);
  validateTable(params.table);
  const { rowid } = await parseJson(request, DeleteRequest);
  sqlite.prepare(`DELETE FROM "${params.table}" WHERE rowid = ?`).run(rowid);
  maybeInvalidateContent(params.table);
  logger.info({ userId: admin.id, table: params.table, rowid }, 'admin raw table delete');
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const admin = requireAdmin(locals);
  validateTable(params.table);
  const values = await parseJson(request, InsertRequest);
  const cols = getColumns(params.table);
  const entries = Object.entries(values).filter(([k]) => cols.includes(k));
  if (entries.length === 0) throw error(400, 'no valid columns provided');
  for (const [k] of entries) assertColumnAllowed(params.table, k);
  const keys = entries.map(([k]) => `"${k}"`).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const vals = entries.map(([, v]) => v);
  const result = sqlite
    .prepare(`INSERT INTO "${params.table}" (${keys}) VALUES (${placeholders})`)
    .run(...(vals as (string | number | null)[]));
  maybeInvalidateContent(params.table);
  logger.info({ userId: admin.id, table: params.table }, 'admin raw table insert');
  return json({ rowid: Number(result.lastInsertRowid) });
};

export const _openapi = {
  PATCH: { summary: 'Admin: edit one cell of a table row', body: PatchRequest },
  DELETE: { summary: 'Admin: delete a table row by rowid', body: DeleteRequest },
  POST: { summary: 'Admin: insert a row into a table' }
} as const;
