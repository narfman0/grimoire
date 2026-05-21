// Convention-based OpenAPI spec builder.
//
// Each +server.ts route that wants to appear in the spec exports an `openapi`
// const of type RouteOpenApi. The GET /api/openapi.json handler globs all
// route files and calls buildSpec() to aggregate them into an OpenAPI 3.0
// document — no hand-written central registry required.
//
// The export is deliberately a plain object (not a class / singleton) so
// tree-shaking can drop it from production bundles that only import the
// request-handler exports.

import { z } from 'zod';
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Public types — imported by route files
// ---------------------------------------------------------------------------

export interface RouteMethodSpec {
  summary?: string;
  tags?: string[];
  body?: z.ZodTypeAny;
  response?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
}

/** Map of HTTP method names (uppercase) to their spec. */
export type RouteOpenApi = Partial<
  Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', RouteMethodSpec>
>;

// ---------------------------------------------------------------------------
// SvelteKit file-path → OpenAPI path
// ---------------------------------------------------------------------------

/**
 * Convert a SvelteKit route file path like
 *   /src/routes/api/encounters/[id]/log/[logId]/+server.ts
 * into an OpenAPI path like
 *   /api/encounters/{id}/log/{logId}
 */
function filePathToOpenApiPath(filePath: string): string {
  // Strip everything up to and including /routes, then /+server.ts
  const match = filePath.match(/\/routes(\/api\/.+?)\/\+server\.ts$/);
  if (!match) return filePath;
  // Replace [param] with {param}
  return match[1].replace(/\[([^\]]+)\]/g, '{$1}');
}

/**
 * Derive a default tag from the first segment after /api/.
 * e.g. /api/encounters/{id}/log → encounters
 */
function defaultTag(openApiPath: string): string {
  const parts = openApiPath.split('/').filter(Boolean);
  // parts[0] = 'api', parts[1] = first segment
  return parts[1] ?? 'misc';
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildSpec(
  routes: Record<string, { openapi?: RouteOpenApi }>
): object {
  const registry = new OpenAPIRegistry();
  const registeredNames = new Set<string>();

  function registerSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
    // If the schema has an openapi name (registered via .openapi('Name')), make
    // sure it ends up in components/schemas. The registry deduplicates by name.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (schema as any)._def?.openapi?.metadata;
    const name: string | undefined = meta?.ref ?? meta?.title;
    if (name && !registeredNames.has(name)) {
      registeredNames.add(name);
      registry.register(name, schema);
    }
    return schema;
  }

  for (const [filePath, mod] of Object.entries(routes)) {
    const routeSpec = mod.openapi;
    if (!routeSpec) continue;

    const openApiPath = filePathToOpenApiPath(filePath);
    const tag = defaultTag(openApiPath);

    for (const [methodUpper, methodSpec] of Object.entries(routeSpec)) {
      if (!methodSpec) continue;
      const method = methodUpper.toLowerCase() as
        | 'get'
        | 'post'
        | 'put'
        | 'patch'
        | 'delete';

      const tags = methodSpec.tags ?? [tag];

      // Register referenced schemas so they appear in components/schemas
      if (methodSpec.body) registerSchema(methodSpec.body);
      if (methodSpec.response) registerSchema(methodSpec.response);
      if (methodSpec.params) registerSchema(methodSpec.params);
      if (methodSpec.query) registerSchema(methodSpec.query);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const requestDef: Record<string, any> = {};
      if (methodSpec.params) requestDef.params = methodSpec.params;
      if (methodSpec.query) requestDef.query = methodSpec.query;
      if (methodSpec.body) {
        requestDef.body = {
          required: true,
          content: { 'application/json': { schema: methodSpec.body } }
        };
      }

      const responses = {
        200: {
          description: 'OK',
          ...(methodSpec.response
            ? {
                content: {
                  'application/json': { schema: methodSpec.response }
                }
              }
            : {})
        }
      };

      registry.registerPath({
        method,
        path: openApiPath,
        tags,
        summary: methodSpec.summary ?? `${methodUpper} ${openApiPath}`,
        request: requestDef,
        responses
      });
    }
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Grimoire API',
      version: '0.0.1',
      description:
        'REST API for the Grimoire collaborative D&D 5e campaign manager. ' +
        'Real-time updates are delivered via short-polling the /api/encounters/{id}/state endpoint.'
    },
    servers: [{ url: '/', description: 'This server' }]
  });
}
