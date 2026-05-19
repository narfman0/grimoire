import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  primaryKey
} from 'drizzle-orm/sqlite-core';

// Kept intentionally portable: only text/integer/blob, no SQLite-specific
// column types. Migrating to Postgres later means swapping the import
// (drizzle-orm/sqlite-core → drizzle-orm/pg-core), changing `integer` ms
// timestamps to `timestamp`, and blob → bytea. No data-model changes.

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(), // uuid
  code: text('code').notNull().unique(), // short shareable code, e.g. 6-char base32
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  ownerUserId: text('owner_user_id'), // FK to users.id; nullable for legacy/test rows pre-auth
  name: text('name').notNull(),
  document: text('document'), // JSON CharacterDocument (rules-engine input); nullable until M2 makes it required
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

// ---------------------------------------------------------------------------
// Content catalog (M1.5) — see docs/content-model.md + docs/pack-loader.md.
//
// `packs` is one row per pack directory loaded from ./content-packs/ or
// $GRIMOIRE_PACKS_DIR. `content` is the row-per-item catalog the rules
// engine and public /api/content read from. Both are populated by the
// boot-time pack loader; not directly mutated by app code.
// ---------------------------------------------------------------------------

export const packs = sqliteTable('packs', {
  slug: text('slug').primaryKey(),                                  // matches meta.json `slug`
  name: text('name').notNull(),
  version: text('version').notNull(),                               // informational
  defaultSource: text('default_source').notNull(),                  // applied to rows that omit `source`
  loadedAt: integer('loaded_at', { mode: 'timestamp_ms' }).notNull(),
  author: text('author'),
  /** Rules edition this pack targets ('5e', '5.5e', …). Drives the browse
   *  edition filter and (later) campaign-scoped pickers. Nullable because
   *  legacy packs may not declare one yet. */
  edition: text('edition')
});

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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
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
  email: text('email'), // nullable; required before public-deploy email verification
  /** Platform admin flag. Granted via SQL today (no UI). Used for moderation
   *  surfaces (/admin/reports). One bit is enough for v1; promote to a role
   *  table when we need multiple permission tiers. */
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
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
    joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.campaignId, t.userId] })
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
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.campaignId, t.characterId] })
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
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp_ms' })
});

export const participants = sqliteTable('participants', {
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
  /** Non-PC concentration target — `{ label, sinceRound? }` JSON or null. PC
   *  concentration lives on the character document, not here. */
  concentratingJson: text('concentrating_json'),
  /** Per-participant DM reveal flags. Shape:
   *    { identity: bool, vitals: bool, combat: bool, hidden: bool }
   *  PCs default to all-true; monster/npc default to all-false. Server
   *  load layers filter player-facing data based on these flags. See
   *  $lib/realtime/reveals.ts. */
  revealsJson: text('reveals_json').notNull().default('{}'),
  sortOrder: integer('sort_order').notNull().default(0)
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
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
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => ({
    byUser: index('notifications_by_user').on(t.userId, t.readAt),
    byCreated: index('notifications_by_created').on(t.userId, t.createdAt)
  })
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
