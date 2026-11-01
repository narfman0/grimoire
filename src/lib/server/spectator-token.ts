// Spectator links — the no-login, read-only /watch/[token] view of a campaign.
//
// Storage: the token rides in `campaigns.permissions_json` under the
// `spectatorToken` key rather than in a column of its own. That is a
// deliberate trade: a new column means a migration, migrations can't go
// straight to master, and the reason this feature exists is a player whose
// phone died mid-session. The blob is already the campaign's "who may see
// and do what" settings, `mergePermissions` ignores keys it doesn't know,
// and the campaign PATCH preserves them (see preserveExtraSettings). If the
// campaign ever grows a settings table, move it there.
//
// Revocation is the whole point of storing it at all: regenerate replaces
// the token (old links 404 on their next poll), revoke deletes it.
//
// The token is 128 random bits, hex-encoded. Hex matters beyond taste: the
// lookup below prefilters with LIKE, and hex can't contain `%` or `_`.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';

const KEY = 'spectatorToken';
export const SPECTATOR_TOKEN_RE = /^[0-9a-f]{32}$/;

function parseBlob(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The spectator token stored in a permissions blob, or null. */
export function readSpectatorToken(raw: string | null | undefined): string | null {
  const v = parseBlob(raw)[KEY];
  return typeof v === 'string' && SPECTATOR_TOKEN_RE.test(v) ? v : null;
}

/** Keys of the stored blob that aren't table permissions — today only the
 *  spectator token. The campaign PATCH rewrites the blob from the resolved
 *  permissions object, which knows nothing about these, so it must carry
 *  them across or changing a permission would silently revoke the link. */
export function preserveExtraSettings(
  raw: string | null | undefined,
  permissions: Record<string, unknown>
): string {
  const token = readSpectatorToken(raw);
  return JSON.stringify(token ? { ...permissions, [KEY]: token } : permissions);
}

async function loadBlob(campaignId: string): Promise<string | null> {
  const rows = await db
    .select({ permissionsJson: schema.campaigns.permissionsJson })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  return rows[0]?.permissionsJson ?? null;
}

async function writeToken(campaignId: string, token: string | null): Promise<void> {
  const blob = parseBlob(await loadBlob(campaignId));
  if (token) blob[KEY] = token;
  else delete blob[KEY];
  // An empty blob goes back to NULL — "all defaults", the same as a campaign
  // that never touched its settings.
  const next = Object.keys(blob).length > 0 ? JSON.stringify(blob) : null;
  await db
    .update(schema.campaigns)
    .set({ permissionsJson: next })
    .where(eq(schema.campaigns.id, campaignId));
}

export async function getSpectatorToken(campaignId: string): Promise<string | null> {
  return readSpectatorToken(await loadBlob(campaignId));
}

/** Issue a fresh token, replacing (and so revoking) any previous one. */
export async function rotateSpectatorToken(campaignId: string): Promise<string> {
  const token = randomBytes(16).toString('hex');
  await writeToken(campaignId, token);
  return token;
}

export async function revokeSpectatorToken(campaignId: string): Promise<void> {
  await writeToken(campaignId, null);
}

/** Resolve a token to its campaign. Malformed tokens never reach the DB. */
export async function findCampaignBySpectatorToken(
  token: string
): Promise<{ id: string; code: string; name: string } | null> {
  if (!SPECTATOR_TOKEN_RE.test(token)) return null;
  const rows = await db
    .select({
      id: schema.campaigns.id,
      code: schema.campaigns.code,
      name: schema.campaigns.name,
      permissionsJson: schema.campaigns.permissionsJson
    })
    .from(schema.campaigns)
    .where(like(schema.campaigns.permissionsJson, `%${token}%`));
  // The LIKE is only a prefilter; the parsed value is the authority.
  const want = Buffer.from(token);
  for (const r of rows) {
    const stored = readSpectatorToken(r.permissionsJson);
    if (stored && timingSafeEqual(Buffer.from(stored), want)) {
      return { id: r.id, code: r.code, name: r.name };
    }
  }
  return null;
}
