// Tiny CLI that runs drizzle migrations from ./drizzle against the
// configured DATABASE_URL (defaults to ./grimoire.db). Used by:
//   pnpm migrate            (local dev)
//   docker entrypoint        (containers)
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const DB_PATH = process.env.DATABASE_URL ?? './grimoire.db';
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: './drizzle' });
console.log(`migrations applied → ${DB_PATH}`);
sqlite.close();
