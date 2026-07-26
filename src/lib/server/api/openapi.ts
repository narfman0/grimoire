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
import { ErrorResponse } from './schemas';

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Public types — imported by route files
// ---------------------------------------------------------------------------

/** Extra non-2xx response. Bare numbers get the shared Error schema and a
 *  stock description; the object form overrides either (e.g. the characters
 *  PATCH 409 whose body is the current character, or a bodyless 304). */
export type ErrorSpec = number | { status: number; description?: string; schema?: z.ZodTypeAny };

export interface RouteMethodSpec {
  summary?: string;
  description?: string;
  tags?: string[];
  body?: z.ZodTypeAny;
  response?: z.ZodTypeAny;
  /** Success status code (default 200; use 201 for creates, 204 for deletes). */
  status?: number;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  /** Route needs no session — suppresses the default 401 response. */
  public?: boolean;
  /**
   * Additional error statuses beyond the defaults. Defaults always emitted:
   * 400 when the method declares a body/query/params, and 401 unless
   * `public: true`. Entries here are merged on top (same status wins).
   */
  errors?: ErrorSpec[];
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
// Error responses
// ---------------------------------------------------------------------------

const ERROR_DESCRIPTIONS: Record<number, string> = {
  304: 'Not modified',
  400: 'Validation error (malformed body, params, or query)',
  401: 'Not authenticated',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  423: 'Locked',
  429: 'Too many requests'
};

/** Resolve the full error-response set for one method: defaults + declared. */
function errorSpecsFor(methodSpec: RouteMethodSpec): Map<number, { description: string; schema?: z.ZodTypeAny }> {
  const out = new Map<number, { description: string; schema?: z.ZodTypeAny }>();
  const hasRequest = Boolean(methodSpec.body || methodSpec.query || methodSpec.params);
  if (hasRequest) out.set(400, { description: ERROR_DESCRIPTIONS[400], schema: ErrorResponse });
  if (!methodSpec.public) out.set(401, { description: ERROR_DESCRIPTIONS[401], schema: ErrorResponse });
  for (const e of methodSpec.errors ?? []) {
    const status = typeof e === 'number' ? e : e.status;
    const description =
      (typeof e === 'number' ? undefined : e.description) ??
      ERROR_DESCRIPTIONS[status] ??
      'Error';
    // Bodyless statuses (304) get no content schema; explicit schema wins.
    const schema =
      typeof e === 'number'
        ? status === 304
          ? undefined
          : ErrorResponse
        : (e.schema ?? (status === 304 ? undefined : ErrorResponse));
    out.set(status, { description, schema });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildSpec(
  routes: Record<string, { _openapi?: RouteOpenApi }>
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

  // Every method emits at least one Error-shaped response, so the shared
  // envelope always belongs in components/schemas.
  registerSchema(ErrorResponse);

  for (const [filePath, mod] of Object.entries(routes)) {
    const routeSpec = mod._openapi;
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

      const successStatus = methodSpec.status ?? 200;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responses: Record<number, any> = {
        [successStatus]: {
          description: successStatus === 201 ? 'Created' : successStatus === 204 ? 'No content' : 'OK',
          ...(methodSpec.response && successStatus !== 204
            ? {
                content: {
                  'application/json': { schema: methodSpec.response }
                }
              }
            : {})
        }
      };

      for (const [status, err] of errorSpecsFor(methodSpec)) {
        responses[status] = {
          description: err.description,
          ...(err.schema
            ? { content: { 'application/json': { schema: err.schema } } }
            : {})
        };
      }

      registry.registerPath({
        method,
        path: openApiPath,
        tags,
        summary: methodSpec.summary ?? `${methodUpper} ${openApiPath}`,
        ...(methodSpec.description ? { description: methodSpec.description } : {}),
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
