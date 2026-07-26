// GET /api/ai/status — are AI features configured on this deployment?
// The UI uses this to decide whether to render AI entry points ("Import
// map", "Scan statblock", …). Never exposes the key, only presence.

import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth/guards';
import { AI_MODEL, isAiEnabled } from '$lib/server/ai/client';
import { AiStatus } from '$lib/server/api/responses';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  requireUser(locals);
  const enabled = isAiEnabled();
  return json({ enabled, model: enabled ? AI_MODEL : null });
};

export const _openapi: RouteOpenApi = {
  GET: {
    summary: 'AI feature availability — enabled flag plus the model in use',
    response: AiStatus
  }
};
