import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  primaryKey
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/** SQL expression for the current timestamp in ms — used as a column DEFAULT
 *  so raw inserts (e.g. admin DB endpoint) auto-fill "created at now". */
const nowMs = sql`(unixepoch('now') * 1000)`;


// Kept intentionally portable: only text/integer/blob, no SQLite-specific
// column types. Migrating to Postgres later means swapping the import
// (drizzle-orm/sqlite-core → drizzle-orm/pg-core), changing `integer` ms
// timestamps to `timestamp`, and blob → bytea. No data-model changes.

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(), // uuid
  code: text('code').notNull().unique(), // short shareable code, e.g. 6-char base32
  name: text('name').notNull(),
  slug: text('slug'), // url-safe campaign name for human-readable URLs; null until assigned
  /** JSON CampaignPermissions overrides. NULL means "all defaults", which is
   *  the permissive behaviour shipped in phase 8a — so this column changes
   *  nothing until a DM tightens something. Only keys the DM has actually
   *  changed are stored; unknown/absent keys fall back to
   *  PERMISSIVE_DEFAULTS, so adding a permission later needs no backfill.
   *  See $lib/server/auth/campaign-permissions. */
  permissionsJson: text('permissions_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
});

export const characters = sqliteTable(
  'characters',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .references(() => campaigns.id), // nullable: standalone characters have no home campaign
    ownerUserId: text('owner_user_id'), // FK to users.id; nullable for legacy/test rows pre-auth
    name: text('name').notNull(),
    slug: text('slug'), // url-safe character name for human-readable URLs; null until assigned
    document: text('document'), // JSON CharacterDocument (rules-engine input); nullable until M2 makes it required
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => ({
    byOwner: index('characters_owner').on(t.ownerUserId),
    // Uniqueness per owner backs the create-time slug allocator (the LIKE
    // scan alone was racy). SQLite allows multiple NULL slugs.
    ownerSlug: uniqueIndex('characters_owner_slug').on(t.ownerUserId, t.slug)
  })
);

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => ({
    byCampaign: index('notes_campaign').on(t.campaignId)
  })
);

// ---------------------------------------------------------------------------
// Content catalog (M1.5) — see docs/content-model.md + docs/content-distribution.md.
//
// `packs` is one row per content pack: the in-repo SRD pack (seeded once
// at first boot) plus the synthetic 'homebrew' pack that every user-owned
// row hangs off. `content` is the row-per-item catalog the rules engine
// and public /api/content read from. SRD rows arrive via the first-boot
// seed; homebrew rows arrive via /api/homebrew/[kind] CRUD and
// /api/homebrew/import bulk upload.
// ---------------------------------------------------------------------------

export const packs = sqliteTable(
  'packs',
  {
    slug: text('slug').primaryKey(),                                  // matches meta.json `slug`
    name: text('name').notNull(),
    version: text('version').notNull(),                               // informational
    defaultSource: text('default_source').notNull(),                  // applied to rows that omit `source`
    loadedAt: integer('loaded_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    author: text('author'),
    /** Rules edition this pack targets ('5e', '5.5e', …). Drives the browse
     *  edition filter and (later) campaign-scoped pickers. Nullable because
     *  legacy packs may not declare one yet. */
    edition: text('edition'),
    /** Free-text description shown in the pack browse / detail UI. Null for
     *  the system `homebrew` bucket and legacy rows that pre-date the column. */
    description: text('description'),
    /** Author of this pack as a first-class user. NULL = system pack
     *  (SRD and the synthetic `homebrew` bucket). User-created packs from
     *  /api/homebrew/import or POST /api/packs stamp the caller's id here. */
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Same model as content.visibility:
     *    'private'  — only the owner sees the pack and its rows
     *    'unlisted' — URL-shareable; hidden from browse
     *    'public'   — surfaced in /packs and /homebrew/browse
     *  The SRD pack is 'public'; the synthetic 'homebrew' bucket is 'private'. */
    visibility: text('visibility').notNull().default('private'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
  },
  (t) => ({
    byOwner: index('packs_owner').on(t.ownerUserId),
    byVisibility: index('packs_visibility').on(t.visibility)
  })
);

export const content = sqliteTable(
  'content',
  {
    id: text('id').primaryKey(),                                    // internal UUID
    kind: text('kind').notNull(),                                   // 'species'|'class'|'subclass'|'feat'|'item'|'spell'|'feature'|'condition'|'background'|'subspecies'
    slug: text('slug').notNull(),                                   // url-safe identifier
    version: integer('version').notNull(),                          // monotonic per (kind, slug)
    source: text('source').notNull(),                               // 'srd-5.2', 'homebrew', etc.
    scopeId: text('scope_id'),                                      // null = global; campaign UUID for per-campaign rows
    /** Author of this row when it was created in-app (homebrew). NULL for
     *  pack-loaded rows (SRD, grimoire-packs). Owner-scoped rows are filtered
     *  by user when populating pickers; non-owners can still resolve a row to
     *  render a sheet that already references it. */
    ownerUserId: text('owner_user_id'),
    packSlug: text('pack_slug')
      .notNull()
      .references(() => packs.slug),
    name: text('name').notNull(),
    data: text('data').notNull(),                                   // JSON serialized to TEXT (portable)
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    /** Stamped on every homebrew edit; null for pack-loaded rows that have
     *  never been touched in-app. */
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    /** 'private' = only the owner sees it (default for new homebrew).
     *  'unlisted' = anyone with the URL can view, hidden from browse index.
     *  'public' = surfaced in /homebrew/browse. Pack-loaded rows are
     *  backfilled to 'public' since their existing distribution model is
     *  effectively public. */
    visibility: text('visibility').notNull().default('private'),
    /** Null = unpublished draft (mutable). Non-null = published (immutable;
     *  PATCH spawns a new draft row at version+1). Pack-loaded rows are
     *  backfilled to their createdAt so subscribers never see them as drafts.
     *  Drafts are visible only to their owner; subscribers resolve to the
     *  latest published version (or their pinnedVersion) via buildContentLookup. */
    publishedAt: integer('published_at', { mode: 'timestamp_ms' })
  },
  (t) => ({
    // (kind, slug, version, scope_id, owner_user_id) is the row identity.
    // NULL scope_id + NULL owner = global pack content; one row per
    // (kind, slug, version). NULL scope_id + non-NULL owner = per-user
    // homebrew, distinct per author.
    identity: uniqueIndex('content_identity').on(
      t.kind,
      t.slug,
      t.version,
      t.scopeId,
      t.ownerUserId
    ),
    byKindSlug: index('content_lookup').on(t.kind, t.slug),
    byPack: index('content_pack').on(t.packSlug),
    bySource: index('content_source').on(t.source),
    byOwner: index('content_owner').on(t.ownerUserId),
    byVisibility: index('content_visibility').on(t.visibility)
  })
);

// ---------------------------------------------------------------------------
// Auth (3a) — see docs/...
//
// `users` is one row per registered account. Username doubles as the public
// handle; the display-name cookie that used to identify players is gone.
// `sessions` holds opaque session ids resolved server-side by the cookie.
// `campaign_members` is the join table; role distinguishes DM from players.
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  email: text('email').unique(),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
  emailVerifyToken: text('email_verify_token'),
  emailVerifyTokenExpiresAt: integer('email_verify_token_expires_at', { mode: 'timestamp_ms' }),
  passwordResetToken: text('password_reset_token'),
  passwordResetTokenExpiresAt: integer('password_reset_token_expires_at', { mode: 'timestamp_ms' }),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
});

export const authLog = sqliteTable(
  'auth_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
  },
  (t) => ({
    byUser: index('auth_log_user').on(t.userId, t.createdAt),
    byAction: index('auth_log_action').on(t.action, t.createdAt)
  })
);

export type AuthLogEntry = typeof authLog.$inferSelect;
export type NewAuthLogEntry = typeof authLog.$inferInsert;

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
});

export const campaignMembers = sqliteTable(
  'campaign_members',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'dm' | 'player'
    status: text('status').notNull().default('approved'), // 'pending' | 'approved' | 'rejected'
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
  },
  (t) => ({
    pk: primaryKey({ columns: [t.campaignId, t.userId] }),
    // "campaigns this user belongs to" — the membership list query.
    byUser: index('campaign_members_user').on(t.userId)
  })
);

// ---------------------------------------------------------------------------
// campaign_characters (Phase 1) — M:N link between campaigns and characters.
//
// Replaces the implicit "characters.campaignId = one campaign" relationship
// with an explicit join so a PC can live in multiple campaigns. The
// `characters.campaignId` column stays as a soft "home campaign" pointer for
// now — Phase 4 may relax / repurpose it.
// ---------------------------------------------------------------------------

export const campaignCharacters = sqliteTable(
  'campaign_characters',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    /** 'player' = the owner is playing it here.  'guest' = borrowed for
     *  one-shots, retired-character cameos, etc.  Free-text below those
     *  two for now; UI shows it verbatim. */
    role: text('role').notNull().default('player'),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
  },
  (t) => ({
    pk: primaryKey({ columns: [t.campaignId, t.characterId] }),
    // "campaigns this character is linked to" — the character-access join.
    byCharacter: index('campaign_characters_character').on(t.characterId)
  })
);

// ---------------------------------------------------------------------------
// Encounters (M3.1) — combat scenes with participants.
//
// An encounter is owned by a campaign and progresses through three states:
//   `staging` — DM is building it (adding participants, prepping monsters)
//   `live`    — combat is running (initiative rolled, round counter active)
//   `ended`   — combat finished; read-only history.
//
// Many can exist per campaign; the DM keeps an inventory of prepped
// encounters and promotes one to `live` when combat starts. Multiple
// encounters can be `live` simultaneously (per-encounter state, not
// per-campaign) — the UI surfaces a "current live" for each player based
// on which encounters they're participants in.
//
// Participants link PCs (via character_id, live HP through that doc) or
// monsters (via statblock_slug pointing at a content row of kind
// 'monster') or ad-hoc NPCs (statblock_json inline). Initiative is
// DM-entered for v0; players can suggest a value but the DM accepts.
// ---------------------------------------------------------------------------

export const encounters = sqliteTable('encounters', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull(), // 'staging' | 'live' | 'ended'
  round: integer('round').notNull().default(0), // 0 pre-combat, 1+ active round
  activeParticipantId: text('active_participant_id'),
  notesJson: text('notes_json'), // arbitrary DM notes
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  endedAt: integer('ended_at', { mode: 'timestamp_ms' })
});

export const participants = sqliteTable(
  'participants',
  {
  id: text('id').primaryKey(),
  encounterId: text('encounter_id')
    .notNull()
    .references(() => encounters.id, { onDelete: 'cascade' }),
  /** For PCs: link to characters.id; HP/conditions read live from there. Null otherwise. */
  characterId: text('character_id').references(() => characters.id, { onDelete: 'set null' }),
  /** Display name. For PCs this may shadow character.name. */
  name: text('name').notNull(),
  kind: text('kind').notNull(), // 'pc' | 'npc' | 'monster'
  /** For `monster` kind that exists in a content pack: pointer to content.slug (kind='monster'). */
  statblockSlug: text('statblock_slug'),
  /** For ad-hoc NPCs or monsters not in any pack: inline JSON statblock. */
  statblockJson: text('statblock_json'),
  /** DM-entered initiative roll; null = not rolled yet. */
  initiative: integer('initiative'),
  /** Hit-point tracking. For PCs these stay null and the engine reads from the character doc. */
  currentHp: integer('current_hp'),
  maxHp: integer('max_hp'),
  tempHp: integer('temp_hp').notNull().default(0),
  conditionsJson: text('conditions_json').notNull().default('[]'),
  /** Player's broadcast turn plan as JSON, or NULL if no plan. Server is the
   *  source of truth; the live channel re-broadcasts to viewers. Shape mirrors
   *  the TurnPlan type in $lib/realtime/encounter-channel.ts. */
  planJson: text('plan_json'),
  /** Encounter-scoped, non-PC combat state: action economy + legendary uses,
   *  round-scoped condition timers, NPC spell slots, and the DM's lair
   *  marker.
   *
   *  Distinct from `plan_json`, which is the player's per-turn declared
   *  *intent* and is cleared every turn. These four rode plan_json until now,
   *  which made `DELETE .../plan` destroy them: the endpoint is documented as
   *  "clear the turn plan", and the preservation logic lived only in the
   *  browser client — so any second client, or any curl against the
   *  documented API, got the destructive behaviour. A column cannot be wiped
   *  by a route that has no business touching it.
   *
   *  NULL reads as "nothing spent" through the existing normalizeEconomy /
   *  normalizeTimers fallbacks. PCs keep the equivalent state on their
   *  character document. */
  combatStateJson: text('combat_state_json'),
  /** Non-PC concentration target — `{ label, sinceRound? }` JSON or null. PC
   *  concentration lives on the character document, not here. */
  concentratingJson: text('concentrating_json'),
  /** Per-participant DM reveal flags. Shape:
   *    { identity: bool, vitals: bool, combat: bool, hidden: bool }
   *  PCs default to all-true; monster/npc default to all-false. Server
   *  load layers filter player-facing data based on these flags. See
   *  $lib/realtime/reveals.ts. */
    revealsJson: text('reveals_json').notNull().default('{}'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Board position in cells (top-left anchor of the token footprint).
     *  Null = untracked; a board-less encounter behaves exactly as before
     *  these columns existed. See docs/ws3-boards-plan.md §B. */
    posX: integer('pos_x'),
    posY: integer('pos_y'),
    /** Token footprint edge in cells (Large = 2, Huge = 3, …). */
    sizeCells: integer('size_cells').notNull().default(1)
  },
  (t) => ({
    // WHERE clause of the 2-second /state poll and every encounter load.
    byEncounter: index('participants_encounter').on(t.encounterId)
  })
);

/** A user's reusable map library. Tiles are the RLE string defined by
 *  $lib/board/rle over the $lib/board/tileset wire codes. */
export const maps = sqliteTable(
  'maps',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    w: integer('w').notNull(),
    h: integer('h').notNull(),
    cellFt: integer('cell_ft').notNull().default(5),
    tilesJson: text('tiles_json').notNull(),
    /** Optional uploaded background image path under /data (served via
     *  /api/map-backgrounds/[id]); null when none. */
    backgroundPath: text('background_path'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => ({
    byOwner: index('maps_owner').on(t.ownerUserId)
  })
);

/** The per-encounter board instance. Copy-on-attach: attaching a library map
 *  snapshots its tiles here, so mid-fight edits (a door opens, a wall
 *  crumbles) never mutate the library original. `revealedJson` is the fog
 *  mask — an RLE bitmask (1 = revealed) over the same grid; `version`
 *  increments on every tiles/fog write so the 2s poll can carry a cheap
 *  change token instead of the board itself. */
export const encounterBoards = sqliteTable('encounter_boards', {
  encounterId: text('encounter_id')
    .primaryKey()
    .references(() => encounters.id, { onDelete: 'cascade' }),
  /** Library map this board was attached from; informational only. */
  sourceMapId: text('source_map_id').references(() => maps.id, { onDelete: 'set null' }),
  w: integer('w').notNull(),
  h: integer('h').notNull(),
  cellFt: integer('cell_ft').notNull().default(5),
  tilesJson: text('tiles_json').notNull(),
  backgroundPath: text('background_path'),
  revealedJson: text('revealed_json').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type Pack = typeof packs.$inferSelect;
export type NewPack = typeof packs.$inferInsert;
export type ContentRow = typeof content.$inferSelect;
export type NewContentRow = typeof content.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type CampaignMember = typeof campaignMembers.$inferSelect;
export type CampaignCharacter = typeof campaignCharacters.$inferSelect;
export type NewCampaignCharacter = typeof campaignCharacters.$inferInsert;
export type NewCampaignMember = typeof campaignMembers.$inferInsert;
// ---------------------------------------------------------------------------
// Action log (M3.5b) — append-only audit trail for what happened in combat.
//
// Every player- or DM-initiated resolution of a turn writes one row here.
// Amendments (DM corrects a player's declared roll, retroactively reverts
// damage, etc.) are *new* rows with `amends_log_id` pointing back at the
// original. We never mutate prior rows. UI renders the most recent
// non-amended entry per (logical action) plus any amendments inline so the
// fight has a complete trail of what was said and what got adjudicated.
// ---------------------------------------------------------------------------

export const actionLog = sqliteTable(
  'action_log',
  {
    id: text('id').primaryKey(),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    /** Acting participant (null only for system/system-style entries). */
    participantId: text('participant_id').references(() => participants.id, { onDelete: 'set null' }),
    /** Target participant — null for self / no-target actions. */
    targetParticipantId: text('target_participant_id').references(() => participants.id, {
      onDelete: 'set null'
    }),
    /** Action slug from derived.actions[].id; opaque here. */
    actionId: text('action_id').notNull(),
    /** Display label cached at submit time (e.g. "Longsword (Action)"). */
    actionLabel: text('action_label').notNull(),
    /** The user who hit submit (player or DM). */
    submittedByUserId: text('submitted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    submitterRole: text('submitter_role').notNull(), // 'player' | 'dm'
    /** True when this row amends a prior entry. */
    isAmendment: integer('is_amendment', { mode: 'boolean' }).notNull().default(false),
    amendsLogId: text('amends_log_id'),
    /** Player-declared roll values; null when not declared. */
    attackRoll: integer('attack_roll'),
    damageRoll: integer('damage_roll'),
    /** Outcome the submitter declared (or DM amended to). */
    hit: text('hit'), // 'hit' | 'miss' | 'crit' | 'fumble' | null
    /** Snapshot of target HP before/after for revertability. Null if no HP
     *  change happened (utility actions, missed attacks, etc.). */
    targetHpBefore: integer('target_hp_before'),
    targetHpAfter: integer('target_hp_after'),
    notes: text('notes'),
    /** JSON per-die detail for the rolls above, when they were rolled in-app
     *  rather than typed. `attackRoll`/`damageRoll` stay the authoritative
     *  totals; this is the "how" — which faces came up, which were dropped by
     *  advantage, which were floored by Great Weapon Fighting. Null for typed
     *  rolls and every row written before the dice roller.
     *
     *  SECURITY: this describes the actor's behaviour, so it MUST be blanked
     *  for a hidden actor — see HIDDEN_ACTOR_BLANKS in
     *  $lib/realtime/action-log. The redaction interface fails closed by
     *  construction now, but the reason it does is this column. */
    rollDetailJson: text('roll_detail_json'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
  },
  (t) => ({
    byEncounter: index('action_log_encounter').on(t.encounterId, t.createdAt),
    byAmends: index('action_log_amends').on(t.amendsLogId)
  })
);

export type Encounter = typeof encounters.$inferSelect;
export type NewEncounter = typeof encounters.$inferInsert;
export type Participant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;
export type MapRow = typeof maps.$inferSelect;
export type NewMapRow = typeof maps.$inferInsert;
export type EncounterBoard = typeof encounterBoards.$inferSelect;
export type NewEncounterBoard = typeof encounterBoards.$inferInsert;
export type ActionLogEntry = typeof actionLog.$inferSelect;
export type NewActionLogEntry = typeof actionLog.$inferInsert;

// ---------------------------------------------------------------------------
// Homebrew marketplace — cross-user sharing of content rows.
//
// `homebrew_subscriptions`: per-user live-link to another author's row.
// `(user_id, content_kind, content_slug, author_user_id)` is the primary key.
// `buildContentLookup` merges every subscribed author's rows into the lookup
// for the subscribing user so derive() can resolve a character's ContentRef.
//
// `content_reports`: open/closed report queue. Admins (`users.is_admin`)
// read from /admin/reports and either hide the row (sets
// `content.visibility = 'private'`) or dismiss the report.
// ---------------------------------------------------------------------------

export const homebrewSubscriptions = sqliteTable(
  'homebrew_subscriptions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentKind: text('content_kind').notNull(),
    contentSlug: text('content_slug').notNull(),
    /** Author whose row this subscription tracks. Slug+kind+author uniquely
     *  identifies a homebrew row (cf. `content.owner_user_id`). */
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Subscriber-controlled version pin. Null = "track latest published"
     *  (legacy default). Non-null = pinned to that version regardless of new
     *  author publishes; subscriber upgrades explicitly via PATCH. */
    pinnedVersion: integer('pinned_version'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.contentKind, t.contentSlug, t.authorUserId] }),
    byUser: index('homebrew_subscriptions_by_user').on(t.userId),
    byAuthor: index('homebrew_subscriptions_by_author').on(t.authorUserId)
  })
);

export const contentReports = sqliteTable(
  'content_reports',
  {
    id: text('id').primaryKey(),
    contentId: text('content_id')
      .notNull()
      .references(() => content.id, { onDelete: 'cascade' }),
    reporterUserId: text('reporter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Free-text reason from the reporter. API caps at 1000 chars. */
    reason: text('reason').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    /** Null while the report is open. */
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    resolverUserId: text('resolver_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    /** 'hidden' = admin set the content back to private; 'dismissed' = no
     *  action taken. Null until resolved. */
    resolution: text('resolution')
  },
  (t) => ({
    byOpen: index('content_reports_open').on(t.resolvedAt),
    byContent: index('content_reports_content').on(t.contentId)
  })
);

export type HomebrewSubscription = typeof homebrewSubscriptions.$inferSelect;
export type NewHomebrewSubscription = typeof homebrewSubscriptions.$inferInsert;
export type ContentReport = typeof contentReports.$inferSelect;
export type NewContentReport = typeof contentReports.$inferInsert;

// ---------------------------------------------------------------------------
// Notifications — in-app inbox surfaced as a bell in the global header.
//
// v1 only fans out on `homebrew_version_published`: when an author publishes a
// new version of a row, /api/homebrew/[kind]/[slug]/publish inserts one row
// here per subscriber whose pinnedVersion differs from the new toVersion.
// Future event types (takedown, author-delete, etc.) widen `type` without
// schema changes.
// ---------------------------------------------------------------------------

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'homebrew_version_published' is the only emitter in v1. */
    type: text('type').notNull(),
    contentKind: text('content_kind').notNull(),
    contentSlug: text('content_slug').notNull(),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Version the subscriber was on before this notification fired. Null when
     *  the pin was tracking latest (NULL pinnedVersion). */
    fromVersion: integer('from_version'),
    /** Version the author just published. */
    toVersion: integer('to_version').notNull(),
    /** Null = unread; populated when the subscriber dismisses or clicks through. */
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
  },
  (t) => ({
    byUser: index('notifications_by_user').on(t.userId, t.readAt),
    byCreated: index('notifications_by_created').on(t.userId, t.createdAt)
  })
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// ---------------------------------------------------------------------------
// Campaign content grants — per-campaign opt-in for packs and homebrew authors.
//
// `grant_type` is 'pack' or 'author'.
// `grant_key` is the pack slug (for pack grants) or user id (for author grants).
//
// Author grants: all characters in the campaign see that author's published
// homebrew in pickers, regardless of whether the character owner subscribed.
// Pack grants: recorded for UI bookkeeping; the lookup layer may use them for
// restriction in a future pass (currently all pack content is globally visible).
// ---------------------------------------------------------------------------

export const campaignContentGrants = sqliteTable(
  'campaign_content_grants',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** 'pack' | 'author' */
    grantType: text('grant_type').notNull(),
    /** pack slug when grantType='pack'; user id when grantType='author' */
    grantKey: text('grant_key').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
  },
  (t) => ({
    byCampaign: index('campaign_content_grants_by_campaign').on(t.campaignId),
    unique: uniqueIndex('campaign_content_grants_unique').on(t.campaignId, t.grantType, t.grantKey)
  })
);

export type CampaignContentGrant = typeof campaignContentGrants.$inferSelect;
export type NewCampaignContentGrant = typeof campaignContentGrants.$inferInsert;
