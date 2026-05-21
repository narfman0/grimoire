import { error } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';

function isSqliteError(err: unknown): err is Error & { code: string } {
  return err instanceof Error && 'code' in err && typeof (err as { code: unknown }).code === 'string';
}

export function handleDbError(err: unknown, context?: string): never {
  if (isSqliteError(err)) {
    logger.error({ err, code: err.code, context }, 'database error');
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw error(409, 'resource already exists');
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') throw error(409, 'referenced resource does not exist');
    if (err.code.startsWith('SQLITE_')) throw error(503, 'database temporarily unavailable');
  }
  throw err;
}
