import { sqlite } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const tables = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>;

  return {
    tables: tables.map((t) => {
      const row = sqlite
        .prepare(`SELECT count(*) as count FROM "${t.name}"`)
        .get() as { count: number };
      return { name: t.name, rowCount: row.count };
    })
  };
};
