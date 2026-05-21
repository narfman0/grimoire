import { buildSpec } from '$lib/server/api/openapi';
import type { RouteOpenApi } from '$lib/server/api/openapi';
import type { RequestHandler } from './$types';

// Vite resolves this glob at build time and eagerly imports every
// +server.ts module under /src/routes/api/. Each module may export an
// `openapi` const of type RouteOpenApi; buildSpec() collects those into
// an OpenAPI 3.1 document.
const routes = import.meta.glob<{ _openapi?: RouteOpenApi }>(
  '/src/routes/api/**/+server.ts',
  { eager: true }
);

// Build once at module load; the spec is immutable per server process.
const doc = buildSpec(routes);

export const GET: RequestHandler = () =>
  Response.json(doc, { headers: { 'cache-control': 'public, max-age=60' } });
