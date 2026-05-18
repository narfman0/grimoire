// Grimoire sync-server — Hocuspocus websocket server.
//
// Brokers Y.Doc updates between players editing the same character sheet
// (or watching the same live encounter) and persists everything to the
// shared sqlite file the SvelteKit web app uses.
//
// Rooms:
//   character:<uuid>  — one Y.Doc per character (M2)
//   encounter:<uuid>  — one Y.Doc per encounter (M3.3+)
//
// Auth: clients pass their grimoire_session cookie value as `token` in
// the Hocuspocus connect params. We resolve the session, then check
// membership in the relevant campaign for the requested room.
//
// Persistence: Hocuspocus tracks live Y.Doc state in-memory; onStoreDocument
// (debounced ~3s) writes binary Y.Doc state into the owning row's
// `yjs_state` column. For characters we also decode back to the
// `document` JSON column so SSR/API/rules-engine stay in sync. For
// encounters we mirror the live keys (round, activeParticipantId) into
// the encounters table so cold reads + REST PATCH fallbacks see the
// authoritative state.

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

// ---------------------------------------------------------------------------
// Session / membership lookups (shared)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Character room (M2)
// ---------------------------------------------------------------------------

const findCharacterCampaign = db.prepare<string, { campaign_id: string }>(`
  SELECT campaign_id FROM characters WHERE id = ? LIMIT 1
`);

const getCharacterYjsState = db.prepare<
  string,
  { yjs_state: Buffer | null; document: string | null }
>(`
  SELECT yjs_state, document FROM characters WHERE id = ? LIMIT 1
`);

const saveCharacterYjsState = db.prepare<[Buffer, string, number, string]>(`
  UPDATE characters SET yjs_state = ?, document = ?, updated_at = ? WHERE id = ?
`);

function parseCharacterId(documentName: string): string | null {
  const m = documentName.match(/^character:([0-9a-f-]{36})$/);
  return m ? m[1] : null;
}

function userCanAccessCharacter(userId: string, characterId: string): boolean {
  const charRow = findCharacterCampaign.get(characterId);
  if (!charRow) return false;
  return findMembership.get(charRow.campaign_id, userId) != null;
}

async function loadCharacterDocument(characterId: string): Promise<Uint8Array | null> {
  const row = getCharacterYjsState.get(characterId);
  if (row?.yjs_state) return new Uint8Array(row.yjs_state);
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

/**
 * Decode the character Y.Doc back into CharacterDocument JSON. v0 stores
 * each top-level field as a JSON-encoded string under root Y.Map "document".
 */
function decodeCharacterDocumentJson(doc: Y.Doc, characterId: string): string {
  const root = doc.getMap('document');
  const out: Record<string, unknown> = {};
  for (const [k, v] of root.entries()) {
    if (typeof v === 'string') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  out.id = characterId;
  return JSON.stringify(out);
}

async function storeCharacterDocument(characterId: string, document: Y.Doc): Promise<void> {
  const state = Y.encodeStateAsUpdate(document);
  const docJson = decodeCharacterDocumentJson(document, characterId);
  saveCharacterYjsState.run(Buffer.from(state), docJson, Date.now(), characterId);
}

// ---------------------------------------------------------------------------
// Encounter room (M3.3)
//
// Y.Doc shape v0: a root Y.Map called "encounter" with two keys:
//   round (number)            — current round counter (0 = pre-combat)
//   activeParticipantId       — id of the participant whose turn it is, or null
//
// We hydrate from the encounters row when no state exists, and on every
// store-flush we mirror the two live keys back into the row so REST
// reads + SSR + the staging→live→ended state machine stay in sync.
// Per-participant HP/conditions stay on the participants table for M3.3;
// promoting those into the Y.Doc lands with M3.4+.
// ---------------------------------------------------------------------------

const findEncounterCampaign = db.prepare<string, { campaign_id: string }>(`
  SELECT campaign_id FROM encounters WHERE id = ? LIMIT 1
`);

const getEncounterYjsState = db.prepare<
  string,
  { yjs_state: Buffer | null; round: number; active_participant_id: string | null }
>(`
  SELECT yjs_state, round, active_participant_id FROM encounters WHERE id = ? LIMIT 1
`);

const saveEncounterYjsState = db.prepare<[Buffer, number, string | null, string]>(`
  UPDATE encounters SET yjs_state = ?, round = ?, active_participant_id = ? WHERE id = ?
`);

// M3.5a: per-participant HP/conditions mirror. We hydrate from these rows on
// first connect, and on each store-flush we write the live Y.Doc values back
// so SSR + REST stay authoritative.
const listParticipants = db.prepare<
  string,
  {
    id: string;
    kind: string;
    current_hp: number | null;
    max_hp: number | null;
    temp_hp: number;
    conditions_json: string;
  }
>(`
  SELECT id, kind, current_hp, max_hp, temp_hp, conditions_json
    FROM participants WHERE encounter_id = ?
`);

const saveParticipantHp = db.prepare<
  [number | null, number, string, string]
>(`
  UPDATE participants
     SET current_hp = ?, temp_hp = ?, conditions_json = ?
   WHERE id = ?
`);

function parseEncounterId(documentName: string): string | null {
  const m = documentName.match(/^encounter:([0-9a-f-]{36})$/);
  return m ? m[1] : null;
}

function userCanAccessEncounter(userId: string, encounterId: string): boolean {
  const encRow = findEncounterCampaign.get(encounterId);
  if (!encRow) return false;
  return findMembership.get(encRow.campaign_id, userId) != null;
}

async function loadEncounterDocument(encounterId: string): Promise<Uint8Array | null> {
  const row = getEncounterYjsState.get(encounterId);
  if (!row) return null;
  if (row.yjs_state) return new Uint8Array(row.yjs_state);
  // Seed from the row's current state — first connection ever. Also seed
  // every participant's HP/conditions so the live channel sees them
  // immediately (M3.5a).
  const doc = new Y.Doc();
  const root = doc.getMap('encounter');
  root.set('round', row.round);
  root.set('activeParticipantId', row.active_participant_id);
  const hpMap = doc.getMap('participantHp');
  for (const p of listParticipants.all(encounterId)) {
    let conditions: string[];
    try {
      const parsed = JSON.parse(p.conditions_json);
      conditions = Array.isArray(parsed) ? parsed : [];
    } catch {
      conditions = [];
    }
    hpMap.set(
      p.id,
      JSON.stringify({
        currentHp: p.current_hp,
        tempHp: p.temp_hp,
        conditions
      })
    );
  }
  return Y.encodeStateAsUpdate(doc);
}

async function storeEncounterDocument(encounterId: string, document: Y.Doc): Promise<void> {
  const state = Y.encodeStateAsUpdate(document);
  const root = document.getMap('encounter');
  const round = Number(root.get('round') ?? 0);
  const activeParticipantId = (root.get('activeParticipantId') as string | null | undefined) ?? null;
  saveEncounterYjsState.run(Buffer.from(state), round, activeParticipantId, encounterId);

  // Mirror participant HP/conditions back to the participants table so SSR
  // and REST reads see the live values. PC participants have currentHp=null
  // on the row (their HP lives on the character document); we still mirror
  // tempHp + conditions for them when the live channel updates those.
  const hpMap = document.getMap('participantHp');
  for (const [pid, raw] of hpMap.entries()) {
    if (typeof raw !== 'string') continue;
    try {
      const blob = JSON.parse(raw) as {
        currentHp: number | null;
        tempHp: number;
        conditions: string[];
      };
      saveParticipantHp.run(
        blob.currentHp,
        blob.tempHp,
        JSON.stringify(blob.conditions ?? []),
        pid
      );
    } catch {
      // ignore malformed
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

type RoomKind = 'character' | 'encounter';

function classifyRoom(documentName: string): { kind: RoomKind; id: string } | null {
  const c = parseCharacterId(documentName);
  if (c) return { kind: 'character', id: c };
  const e = parseEncounterId(documentName);
  if (e) return { kind: 'encounter', id: e };
  return null;
}

const server = Server.configure({
  port: PORT,
  async onAuthenticate({ token, documentName }: onAuthenticatePayload) {
    const session = resolveSession(token);
    if (!session) throw new Error('invalid session');
    const room = classifyRoom(documentName);
    if (!room) throw new Error('unknown document name');
    const ok =
      room.kind === 'character'
        ? userCanAccessCharacter(session.userId, room.id)
        : userCanAccessEncounter(session.userId, room.id);
    if (!ok) throw new Error('not a campaign member');
    return session;
  },

  async onLoadDocument({ documentName }: onLoadDocumentPayload) {
    const room = classifyRoom(documentName);
    if (!room) return null;
    return room.kind === 'character'
      ? loadCharacterDocument(room.id)
      : loadEncounterDocument(room.id);
  },

  async onStoreDocument({ documentName, document }: onStoreDocumentPayload) {
    const room = classifyRoom(documentName);
    if (!room) return;
    if (room.kind === 'character') {
      await storeCharacterDocument(room.id, document);
    } else {
      await storeEncounterDocument(room.id, document);
    }
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
