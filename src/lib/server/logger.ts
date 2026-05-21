import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: { service: 'grimoire' },
  transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined
});

export function requestLogger(requestId: string, userId?: string) {
  return logger.child({ requestId, ...(userId ? { userId } : {}) });
}
