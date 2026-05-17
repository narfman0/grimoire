// Central OpenAPI registry. Each route is registered once here against the
// same Zod schemas the handlers validate with — so the spec can't drift from
// runtime behaviour.

import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  Campaign,
  CampaignCode,
  Character,
  CharacterList,
  CreateCampaignRequest,
  CreateCampaignResponse,
  CreateCharacterRequest,
  ErrorResponse,
  JoinCampaignRequest,
  UpdateCharacterRequest,
  Uuid
} from './schemas';

const registry = new OpenAPIRegistry();

// Register reusable schemas under components/schemas
registry.register('Campaign', Campaign);
registry.register('Character', Character);
registry.register('CharacterList', CharacterList);
registry.register('CreateCampaignRequest', CreateCampaignRequest);
registry.register('CreateCampaignResponse', CreateCampaignResponse);
registry.register('JoinCampaignRequest', JoinCampaignRequest);
registry.register('CreateCharacterRequest', CreateCharacterRequest);
registry.register('UpdateCharacterRequest', UpdateCharacterRequest);
registry.register('Error', ErrorResponse);

const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { 'application/json': { schema } }
});

const errorResponses = {
  400: { description: 'Bad request', ...jsonBody(ErrorResponse) },
  404: { description: 'Not found', ...jsonBody(ErrorResponse) }
};

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

registry.registerPath({
  method: 'post',
  path: '/api/campaigns',
  tags: ['campaigns'],
  summary: 'Create a campaign',
  request: { body: { required: true, ...jsonBody(CreateCampaignRequest) } },
  responses: {
    200: { description: 'Created', ...jsonBody(CreateCampaignResponse) },
    400: errorResponses[400]
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/campaigns/{code}',
  tags: ['campaigns'],
  summary: 'Fetch a campaign by its shareable code',
  request: { params: z.object({ code: CampaignCode }) },
  responses: {
    200: { description: 'OK', ...jsonBody(Campaign) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/campaigns/{code}/join',
  tags: ['campaigns'],
  summary: 'Set the caller’s display-name cookie for a campaign',
  request: {
    params: z.object({ code: CampaignCode }),
    body: { required: true, ...jsonBody(JoinCampaignRequest) }
  },
  responses: {
    204: { description: 'Joined; display-name cookie set' },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: '/api/characters',
  tags: ['characters'],
  summary: 'List characters, optionally filtered by campaign code',
  request: {
    query: z.object({
      campaign: CampaignCode.optional().openapi({ description: 'Campaign code to filter by' })
    })
  },
  responses: {
    200: { description: 'OK', ...jsonBody(CharacterList) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/characters',
  tags: ['characters'],
  summary: 'Create a character in a campaign',
  request: { body: { required: true, ...jsonBody(CreateCharacterRequest) } },
  responses: {
    200: { description: 'Created', ...jsonBody(Character) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/characters/{id}',
  tags: ['characters'],
  summary: 'Fetch a character by ID',
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: { description: 'OK', ...jsonBody(Character) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'patch',
  path: '/api/characters/{id}',
  tags: ['characters'],
  summary: 'Update a character',
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, ...jsonBody(UpdateCharacterRequest) }
  },
  responses: {
    200: { description: 'Updated', ...jsonBody(Character) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'delete',
  path: '/api/characters/{id}',
  tags: ['characters'],
  summary: 'Delete a character',
  request: { params: z.object({ id: Uuid }) },
  responses: {
    204: { description: 'Deleted' },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Grimoire API',
      version: '0.0.1',
      description:
        'REST API for the Grimoire collaborative D&D 5e campaign manager. ' +
        'Real-time character sheet edits use a separate Hocuspocus (Y.js) websocket server and are not covered here.'
    },
    servers: [{ url: '/', description: 'This server' }],
    tags: [
      { name: 'campaigns', description: 'Create, fetch, and join campaigns' },
      { name: 'characters', description: 'Per-campaign character sheets (metadata)' }
    ]
  });
}
