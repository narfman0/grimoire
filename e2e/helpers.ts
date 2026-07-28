// Shared seeding helpers for the e2e smoke suite.
//
// Mirrors the API recipe in .claude/skills/verifier-encounter/scripts/seed.sh:
// everything is seeded through the real REST surface (signup → campaign →
// encounter → participants), then the browser drives the UI. Usernames are
// unique per run so the suite never depends on DB cleanup — the DB itself is
// throwaway (see playwright.config.ts).

import { request, type APIRequestContext, type APIResponse, type Browser, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-pass-12345';

export function uniqueUsername(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function ok(res: APIResponse, what: string): Promise<Record<string, unknown>> {
  if (!res.ok()) {
    throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export interface ApiUser {
  api: APIRequestContext;
  username: string;
  userId: string;
}

/** Sign up a fresh user via the API; the returned request context carries the
 *  session cookie for subsequent calls. */
export async function signup(baseURL: string, prefix: string): Promise<ApiUser> {
  const api = await request.newContext({ baseURL });
  const username = uniqueUsername(prefix);
  const body = await ok(
    await api.post('/api/auth/signup', {
      data: { username, email: `${username}@e2e.example.com`, password: PASSWORD }
    }),
    `signup ${username}`
  );
  return { api, username, userId: body.id as string };
}

/** Open a browser page authenticated as the given API user (session cookie
 *  copied from the API request context). Caller's test closes it via the
 *  browser fixture teardown.
 *
 *  Service workers are blocked: src/service-worker.ts serves ALL non-/api
 *  GETs (page documents and __data.json included) stale-while-revalidate,
 *  so once the SW claims the page a reload renders the previous cached
 *  state — reload-based assertions would race the cache, not the app. */
export async function newPageAs(browser: Browser, user: ApiUser): Promise<Page> {
  const context = await browser.newContext({
    storageState: await user.api.storageState(),
    serviceWorkers: 'block'
  });
  return context.newPage();
}

export async function createCampaign(dm: ApiUser, name: string) {
  const body = await ok(await dm.api.post('/api/campaigns', { data: { name } }), 'create campaign');
  return { campaignId: body.id as string, code: body.code as string };
}

export async function createLiveEncounter(dm: ApiUser, campaignCode: string, name: string) {
  const created = await ok(
    await dm.api.post('/api/encounters', { data: { campaignCode, name } }),
    'create encounter'
  );
  const encounterId = created.id as string;
  await ok(
    await dm.api.patch(`/api/encounters/${encounterId}`, { data: { status: 'live' } }),
    'promote encounter to live'
  );
  return encounterId;
}

export async function addNpc(
  dm: ApiUser,
  encounterId: string,
  npc: { name: string; initiative?: number; currentHp?: number; maxHp?: number }
): Promise<string> {
  const body = await ok(
    await dm.api.post(`/api/encounters/${encounterId}/participants`, {
      data: { kind: 'npc', ...npc }
    }),
    `add npc ${npc.name}`
  );
  return body.id as string;
}

/** DM-only reveal-flag toggle (identity / vitals / combat / hidden). */
export async function patchReveals(
  dm: ApiUser,
  participantId: string,
  patch: { identity?: boolean; vitals?: boolean; combat?: boolean; hidden?: boolean }
) {
  await ok(
    await dm.api.patch(`/api/participants/${participantId}/reveals`, { data: patch }),
    'patch reveals'
  );
}

/** Append an action-log row the way the DM resolve panel does (same
 *  endpoint, same body). `actionLabel` is the bare action name — the
 *  composite "Actor — Action" form some legacy rows carry is redacted
 *  server-side, see $lib/realtime/action-log. */
export async function submitActionLog(
  user: ApiUser,
  encounterId: string,
  body: {
    participantId: string | null;
    targetParticipantId?: string | null;
    actionId: string;
    actionLabel: string;
    round: number;
    attackRoll?: number;
    damageRoll?: number;
    hit?: string;
    targetHpBefore?: number;
    targetHpAfter?: number;
    notes?: string;
  }
): Promise<string> {
  const res = await ok(
    await user.api.post(`/api/encounters/${encounterId}/log`, { data: body }),
    'submit action log'
  );
  return res.id as string;
}

/** Player requests to join; DM approves the pending membership. */
export async function joinAndApprove(dm: ApiUser, player: ApiUser, campaignCode: string) {
  await ok(await player.api.post(`/api/campaigns/${campaignCode}/join`), 'player join');
  await ok(
    await dm.api.patch(`/api/campaigns/${campaignCode}/members/${player.userId}`, {
      data: { status: 'approved' }
    }),
    'approve member'
  );
}

/** Minimal valid CharacterDocument — same shape as the API unit tests'
 *  minDoc (src/routes/api/characters/__tests__/server.test.ts). The server
 *  replaces `id` with the character's real id on create. */
export function minCharacterDocument(name: string) {
  return {
    id: 'placeholder',
    name,
    classes: [{ slug: 'fighter', level: 1, hpRolledPerLevel: [10] }],
    species: { kind: 'species', slug: 'human', version: 1, choices: {} },
    feats: [],
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficienciesChosen: {},
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 10,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {}
  };
}

export async function createCharacter(
  owner: ApiUser,
  name: string,
  opts: { campaignCode?: string } = {}
) {
  const body = await ok(
    await owner.api.post('/api/characters', {
      data: { name, campaignCode: opts.campaignCode, document: minCharacterDocument(name) }
    }),
    `create character ${name}`
  );
  return { characterId: body.id as string };
}

/** Same slug convention as src/lib/rules/slug.ts (character sheet URLs). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Put a non-PC participant into concentration (same endpoint the encounter
 *  channel's `setConcentration` posts to). */
export async function setConcentration(
  dm: ApiUser,
  encounterId: string,
  participantId: string,
  label: string
) {
  await ok(
    await dm.api.post(
      `/api/encounters/${encounterId}/participants/${participantId}/concentration`,
      { data: { concentrating: { label } } }
    ),
    `set concentration on ${participantId}`
  );
}
