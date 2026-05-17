import { json } from '@sveltejs/kit';
import { buildOpenApiDocument } from '$lib/server/api/spec';
import type { RequestHandler } from './$types';

// Build once at module load; the spec is immutable per server process.
const doc = buildOpenApiDocument();

export const GET: RequestHandler = () =>
  json(doc, { headers: { 'cache-control': 'public, max-age=60' } });
