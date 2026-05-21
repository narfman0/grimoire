import { error } from '@sveltejs/kit';
import { sqlite } from '$lib/server/db';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 50;

type ColInfo = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number };

export const load: PageServerLoad = async ({ params, url }) => {
  const { table } = params;

  const exists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
  if (!exists) throw error(404, `Table "${table}" not found`);

  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as ColInfo[];
  const { count } = sqlite
    .prepare(`SELECT count(*) as count FROM "${table}"`)
    .get() as { count: number };
  const rows = sqlite
    .prepare(`SELECT rowid, * FROM "${table}" LIMIT ? OFFSET ?`)
    .all(PAGE_SIZE, page * PAGE_SIZE) as Array<Record<string, unknown>>;

  return {
    tableName: table,
    columns,
    rows,
    total: count,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.ceil(count / PAGE_SIZE)
  };
};
