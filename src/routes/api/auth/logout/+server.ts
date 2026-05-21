import { destroySession } from '$lib/server/auth/sessions';
import type { RequestHandler } from './$types';

export const _openapi = {
  POST: { summary: 'Log out (destroy current session)' }
} as const;

export const POST: RequestHandler = async ({ cookies }) => {
  await destroySession(cookies);
  return new Response(null, { status: 204 });
};
