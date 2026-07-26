// Guards the OpenAPI surface: the route eagerly import.meta.glob's every
// +server.ts under /api, so a single route module with a broken module-level
// export (or an _openapi const referencing an undefined schema) breaks the
// whole spec endpoint. Building the document here catches that at test time.

import { describe, it, expect } from 'vitest';
import { makeEvent } from '$lib/server/__tests__/test-event';
import { GET } from '../+server';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadDoc(): Promise<any> {
  const res = await (GET as any)(makeEvent());
  expect(res.status).toBe(200);
  return res.json();
}

describe('GET /api/openapi.json', () => {
  it('returns a parseable OpenAPI 3.1 document with paths', async () => {
    const doc = await loadDoc();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info?.title).toBe('Grimoire API');
    expect(Object.keys(doc.paths ?? {}).length).toBeGreaterThan(0);
  });

  it('every documented route file contributed its path', async () => {
    const doc = await loadDoc();
    // Spot-check a few paths across resource families.
    for (const p of [
      '/api/characters',
      '/api/characters/{id}',
      '/api/encounters',
      '/api/notes',
      '/api/packs/{slug}',
      '/api/portraits/{id}',
      '/api/characters/{id}/portrait'
    ]) {
      expect(doc.paths[p], `missing path ${p}`).toBeDefined();
    }
  });

  it('registers the shared error envelope in components.schemas', async () => {
    const doc = await loadDoc();
    expect(doc.components?.schemas?.Error).toBeDefined();
    expect(doc.components.schemas.Error.properties?.message?.type).toBe('string');
  });

  it('documents response schemas (characters list references CharacterList)', async () => {
    const doc = await loadDoc();
    const get = doc.paths['/api/characters'].get;
    const schema = get.responses['200'].content['application/json'].schema;
    expect(schema.$ref).toBe('#/components/schemas/CharacterList');
    expect(doc.components.schemas.CharacterList.properties).toHaveProperty('characters');
    expect(doc.components.schemas.CharacterList.properties).toHaveProperty('total');
  });

  it('documents error responses (401 default + declared 409 on character PATCH)', async () => {
    const doc = await loadDoc();
    const patch = doc.paths['/api/characters/{id}'].patch;
    expect(patch.responses['401']).toBeDefined();
    expect(
      patch.responses['401'].content['application/json'].schema.$ref
    ).toBe('#/components/schemas/Error');
    // Declared override: 409 carries the current character, not the error envelope.
    expect(
      patch.responses['409'].content['application/json'].schema.$ref
    ).toBe('#/components/schemas/Character');
  });

  it('documents path and query parameters', async () => {
    const doc = await loadDoc();
    const get = doc.paths['/api/characters/{id}'].get;
    const pathParams = (get.parameters ?? []).filter((p: any) => p.in === 'path');
    expect(pathParams.map((p: any) => p.name)).toContain('id');

    const list = doc.paths['/api/characters'].get;
    const queryParams = (list.parameters ?? []).filter((p: any) => p.in === 'query');
    const names = queryParams.map((p: any) => p.name);
    expect(names).toEqual(expect.arrayContaining(['campaign', 'limit', 'offset']));
  });

  it('suppresses the 401 on public routes', async () => {
    const doc = await loadDoc();
    expect(doc.paths['/api/health'].get.responses['401']).toBeUndefined();
    expect(doc.paths['/api/content'].get.responses['401']).toBeUndefined();
  });
});
