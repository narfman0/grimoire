import { error, json } from '@sveltejs/kit';
import { sqlite } from '$lib/server/db';
import type { RequestHandler } from './$types';

type ColInfo = { name: string };

function requireAdmin(locals: App.Locals) {
  if (!locals.user) throw error(401, 'login required');
  if (!locals.user.isAdmin) throw error(403, 'admin only');
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

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);
  validateTable(params.table);
  const { rowid, column, value } = (await request.json()) as {
    rowid: number;
    column: string;
    value: unknown;
  };
  const cols = getColumns(params.table);
  if (!cols.includes(column)) throw error(400, 'unknown column');
  sqlite
    .prepare(`UPDATE "${params.table}" SET "${column}" = ? WHERE rowid = ?`)
    .run(value as any, rowid);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);
  validateTable(params.table);
  const { rowid } = (await request.json()) as { rowid: number };
  sqlite.prepare(`DELETE FROM "${params.table}" WHERE rowid = ?`).run(rowid);
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);
  validateTable(params.table);
  const values = (await request.json()) as Record<string, unknown>;
  const cols = getColumns(params.table);
  const entries = Object.entries(values).filter(([k]) => cols.includes(k));
  if (entries.length === 0) throw error(400, 'no valid columns provided');
  const keys = entries.map(([k]) => `"${k}"`).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const vals = entries.map(([, v]) => v);
  const result = sqlite
    .prepare(`INSERT INTO "${params.table}" (${keys}) VALUES (${placeholders})`)
    .run(...(vals as any[]));
  return json({ rowid: Number(result.lastInsertRowid) });
};
