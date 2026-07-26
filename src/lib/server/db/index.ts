import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DB_PATH = process.env.DATABASE_URL ?? 'grimoire.db';

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
// Wait for concurrent writers (backup jobs, a second local process) instead
// of surfacing instant SQLITE_BUSY errors.
sqlite.pragma('busy_timeout = 10000');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema, sqlite };

export function closeDb(): void {
  sqlite.close();
}
