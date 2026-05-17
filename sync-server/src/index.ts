// Grimoire sync-server — Hocuspocus websocket server.
//
// Brokers Y.Doc updates between players editing the same character sheet
// and persists everything to the shared sqlite file the SvelteKit web
// app uses. Each Y.Doc room name follows `character:<uuid>`.
//
// Auth: clients pass their grimoire_session cookie value as `token` in
// the Hocuspocus connect params. We look the session up in the same
// `sessions` table grimoire's web app reads, verify membership in the
// character's campaign, and attach the user info to the connection
// context.
//
// Persistence: Hocuspocus tracks live Y.Doc state in-memory; we hook
// onStoreDocument (debounced ~3s by Hocuspocus) to write the Y.Doc
// state into characters.yjs_state as a binary blob. On onLoadDocument
// we hydrate from yjs_state if present, else from the structural JSON
// in characters.document.
//
// Note: not using @hocuspocus/extension-sqlite — that puts state in its
// own tables. We persist directly into the existing `characters` table
// so we have one source of truth aligned with the data model.

import Database from 'better-sqlite3';
import {
  Server,
  type onAuthenticatePayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
  type onConnectPayload,
  type onDisconnectPayload
} from '@hocuspocus/server';
import * as Y from 'yjs';

const PORT = Number(process.env.SYNC_PORT ?? 1234);
const DB_PATH = process.env.DATABASE_URL ?? './grimoire.db';

interface AuthContext {
  userId: string;
  username: string;
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const findSession = db.prepare<
  [string, number],
  { user_id: string; username: string }
>(`
  SELECT s.user_id, u.username
    FROM sessions s
    JOIN users u ON u.id = s.user_id
   WHERE s.id = ? AND s.expires_at > ?
   LIMIT 1
`);

const findCharacterCampaign = db.prepare<string, { campaign_id: string }>(`
  SELECT campaign_id FROM characters WHERE id = ? LIMIT 1
`);

const findMembership = db.prepare<[string, string], { role: string }>(`
  SELECT role FROM campaign_members
   WHERE campaign_id = ? AND user_id = ?
   LIMIT 1
`);

function resolveSession(token: string): AuthContext | null {
  const row = findSession.get(token, Date.now());
  if (!row) return null;
  return { userId: row.user_id, username: row.username };
}

function userCanAccessCharacter(userId: string, characterId: string): boolean {
  const charRow = findCharacterCampaign.get(characterId);
  if (!charRow) return false;
  const memberRow = findMembership.get(charRow.campaign_id, userId);
  return memberRow != null;
}

function parseCharacterId(documentName: string): string | null {
  const m = documentName.match(/^character:([0-9a-f-]{36})$/);
  return m ? m[1] : null;
}

const getYjsState = db.prepare<
  string,
  { yjs_state: Buffer | null; document: string | null }
>(`
  SELECT yjs_state, document FROM characters WHERE id = ? LIMIT 1
`);

const saveYjsState = db.prepare<[Buffer, number, string]>(`
  UPDATE characters SET yjs_state = ?, updated_at = ? WHERE id = ?
`);

async function loadDocument({
  documentName
}: onLoadDocumentPayload): Promise<Uint8Array | null> {
  const characterId = parseCharacterId(documentName);
  if (!characterId) return null;
  const row = getYjsState.get(characterId);
  if (row?.yjs_state) return new Uint8Array(row.yjs_state);
  // No prior Y.Doc state: hydrate from the JSON snapshot the web app's
  // PATCH path maintains. For v0 we mirror each top-level field as a
  // JSON-encoded string inside a single Y.Map called "document".
  // Per-field CRDT granularity lands when client-side edit handlers
  // are converted from PATCH to Y.Doc transactions.
  if (row?.document) {
    const doc = new Y.Doc();
    const root = doc.getMap('document');
    const parsed = JSON.parse(row.document) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      root.set(k, JSON.stringify(v));
    }
    return Y.encodeStateAsUpdate(doc);
  }
  return null;
}

async function storeDocument({
  documentName,
  document
}: onStoreDocumentPayload): Promise<void> {
  const characterId = parseCharacterId(documentName);
  if (!characterId) return;
  // Hocuspocus's Document extends Y.Doc — encode the live state.
  const state = Y.encodeStateAsUpdate(document);
  saveYjsState.run(Buffer.from(state), Date.now(), characterId);
}

const server = Server.configure({
  port: PORT,
  async onAuthenticate({ token, documentName }: onAuthenticatePayload) {
    const session = resolveSession(token);
    if (!session) throw new Error('invalid session');
    const characterId = parseCharacterId(documentName);
    if (!characterId) throw new Error('unknown document name');
    if (!userCanAccessCharacter(session.userId, characterId)) {
      throw new Error('not a campaign member');
    }
    return session; // becomes the connection's context
  },

  async onLoadDocument(payload: onLoadDocumentPayload) {
    return loadDocument(payload);
  },

  async onStoreDocument(payload: onStoreDocumentPayload) {
    await storeDocument(payload);
  },

  async onConnect({ documentName, context }: onConnectPayload) {
    const ctx = context as AuthContext | undefined;
    console.log(`[sync] connect → ${documentName} as ${ctx?.username ?? '?'}`);
  },

  async onDisconnect({ documentName, context }: onDisconnectPayload) {
    const ctx = context as AuthContext | undefined;
    console.log(`[sync] disconnect ← ${documentName} (${ctx?.username ?? '?'})`);
  }
});

server.listen().then(() => {
  console.log(`[sync] hocuspocus listening on :${PORT}, db=${DB_PATH}`);
});
