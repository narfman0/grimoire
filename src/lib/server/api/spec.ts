// Central OpenAPI registry. Each route is registered once here against the
// same Zod schemas the handlers validate with — so the spec can't drift from
// runtime behaviour.

import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  Campaign,
  CampaignCode,
  Character,
  CharacterDocument,
  CharacterList,
  ContentKind,
  ContentList,
  ContentRow,
  ContentSummary,
  CreateCampaignRequest,
  CreateCampaignResponse,
  CreateCharacterRequest,
  ErrorResponse,
  JoinCampaignRequest,
  SourceList,
  UpdateCharacterRequest,
  Uuid
} from './schemas';
import {
  ActionLogEntry,
  AddParticipantRequest,
  CreateEncounterRequest,
  Encounter,
  Participant,
  SubmitActionLogRequest,
  UpdateEncounterRequest,
  UpdateParticipantRequest
} from './encounter-schemas';

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
registry.register('CharacterDocument', CharacterDocument);
registry.register('ContentSummary', ContentSummary);
registry.register('ContentRow', ContentRow);
registry.register('ContentList', ContentList);
registry.register('SourceList', SourceList);
registry.register('Error', ErrorResponse);
registry.register('Encounter', Encounter);
registry.register('Participant', Participant);
registry.register('CreateEncounterRequest', CreateEncounterRequest);
registry.register('UpdateEncounterRequest', UpdateEncounterRequest);
registry.register('AddParticipantRequest', AddParticipantRequest);
registry.register('UpdateParticipantRequest', UpdateParticipantRequest);
registry.register('ActionLogEntry', ActionLogEntry);
registry.register('SubmitActionLogRequest', SubmitActionLogRequest);

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
  summary: 'Join the campaign as a player (must be logged in)',
  request: { params: z.object({ code: CampaignCode }) },
  responses: {
    200: { description: 'Joined' },
    401: { description: 'Login required', ...jsonBody(ErrorResponse) },
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
// Content (public catalog)
// ---------------------------------------------------------------------------

const SlugParam = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/)
  .openapi({ description: 'Content slug', example: 'wizard' });

registry.registerPath({
  method: 'get',
  path: '/api/content',
  tags: ['content'],
  summary: 'List public catalog rows',
  request: {
    query: z.object({
      kind: ContentKind.optional(),
      source: z.string().optional().openapi({ description: 'Filter to a public source slug' }),
      limit: z.coerce.number().int().positive().max(500).default(100).optional(),
      offset: z.coerce.number().int().nonnegative().default(0).optional(),
      include: z.enum(['data']).optional().openapi({ description: 'Include full row data, not just summary' })
    })
  },
  responses: {
    200: { description: 'OK', ...jsonBody(ContentList) },
    400: errorResponses[400]
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/content/{kind}/{slug}',
  tags: ['content'],
  summary: 'Fetch the latest public version of a content row',
  request: { params: z.object({ kind: ContentKind, slug: SlugParam }) },
  responses: {
    200: { description: 'OK', ...jsonBody(ContentRow) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/content/{kind}/{slug}/v{version}',
  tags: ['content'],
  summary: 'Fetch a pinned version of a content row',
  request: {
    params: z.object({
      kind: ContentKind,
      slug: SlugParam,
      version: z.coerce.number().int().positive()
    })
  },
  responses: {
    200: { description: 'OK', ...jsonBody(ContentRow) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/content/sources',
  tags: ['content'],
  summary: 'List the public source slugs available on this server',
  responses: {
    200: { description: 'OK', ...jsonBody(SourceList) }
  }
});

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

const EncounterList = z.object({ encounters: z.array(Encounter) }).openapi('EncounterList');
const ParticipantList = z.object({ participants: z.array(Participant) }).openapi('ParticipantList');
const ActionLogList = z.object({ entries: z.array(ActionLogEntry) }).openapi('ActionLogList');
registry.register('EncounterList', EncounterList);
registry.register('ParticipantList', ParticipantList);
registry.register('ActionLogList', ActionLogList);

registry.registerPath({
  method: 'post',
  path: '/api/encounters',
  tags: ['encounters'],
  summary: 'Create an encounter under a campaign (DM only)',
  request: { body: { required: true, ...jsonBody(CreateEncounterRequest) } },
  responses: {
    200: { description: 'Created', ...jsonBody(Encounter) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/encounters/{id}',
  tags: ['encounters'],
  summary: 'Fetch an encounter with its participants',
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: { description: 'OK', ...jsonBody(Encounter.merge(ParticipantList)) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'patch',
  path: '/api/encounters/{id}',
  tags: ['encounters'],
  summary: 'Update an encounter (DM only). Status state machine: staging → live → ended.',
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, ...jsonBody(UpdateEncounterRequest) }
  },
  responses: {
    200: { description: 'OK', ...jsonBody(Encounter) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'delete',
  path: '/api/encounters/{id}',
  tags: ['encounters'],
  summary: 'Delete an encounter (DM only). Cascades to participants and log entries.',
  request: { params: z.object({ id: Uuid }) },
  responses: {
    204: { description: 'Deleted' },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/encounters/{id}/participants',
  tags: ['encounters'],
  summary: 'Add a participant to an encounter (DM only)',
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, ...jsonBody(AddParticipantRequest) }
  },
  responses: {
    200: { description: 'Added', ...jsonBody(Participant) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'patch',
  path: '/api/participants/{id}',
  tags: ['encounters'],
  summary: 'Update a participant (initiative, HP, conditions). DM only.',
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, ...jsonBody(UpdateParticipantRequest) }
  },
  responses: {
    200: { description: 'OK', ...jsonBody(Participant) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'delete',
  path: '/api/participants/{id}',
  tags: ['encounters'],
  summary: 'Remove a participant from an encounter (DM only)',
  request: { params: z.object({ id: Uuid }) },
  responses: {
    204: { description: 'Removed' },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/encounters/{id}/log',
  tags: ['encounters'],
  summary: 'Read the action log for an encounter (chronological)',
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: { description: 'OK', ...jsonBody(ActionLogList) },
    400: errorResponses[400],
    404: errorResponses[404]
  }
});

registry.registerPath({
  method: 'post',
  path: '/api/encounters/{id}/log',
  tags: ['encounters'],
  summary: 'Append a resolution to the action log. Amendments require DM; players may only act for characters they own.',
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, ...jsonBody(SubmitActionLogRequest) }
  },
  responses: {
    201: { description: 'Created', ...jsonBody(ActionLogEntry) },
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
      { name: 'characters', description: 'Per-campaign character sheets (metadata)' },
      { name: 'content', description: 'Public game-content catalog (SRD 5.2)' },
      {
        name: 'encounters',
        description:
          'Combat scenes: participants, initiative, turn state, append-only action log.'
      }
    ]
  });
}
