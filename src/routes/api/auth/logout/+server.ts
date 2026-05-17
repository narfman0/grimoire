import { destroySession } from '$lib/server/auth/sessions';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  await destroySession(cookies);
  return new Response(null, { status: 204 });
};
