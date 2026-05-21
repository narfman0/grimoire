import { json } from '@sveltejs/kit';
import { PUBLIC_SOURCES } from '$lib/server/api/public-sources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
  json(
    { sources: [...PUBLIC_SOURCES].sort() },
    { headers: { 'cache-control': 'public, max-age=3600' } }
  );

export const _openapi = {
  GET: { summary: 'List available public content sources' }
} as const;
