// Zod response schemas — the documented wire shapes for GET/mutation
// responses. These mirror the serializers in src/lib/server/serializers.ts
// (and the small inline serialize() helpers in individual routes); when a
// serializer changes shape, update the matching schema here.
//
// Request schemas live in ./schemas.ts and ./encounter-schemas.ts; this
// module is response-only so routes can import it without dragging in the
// whole request surface.

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { Uuid, TimestampMs } from './schemas';
import { Encounter, Participant, ActionLogEntry } from './encounter-schemas';

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Shared envelopes
// ---------------------------------------------------------------------------

/** Standard mutation acknowledgement — `{ ok: true }`. */
export const OkResponse = z.object({ ok: z.literal(true) }).openapi('OkResponse');

/** Create responses that only hand back the new row's id. */
export const IdResponse = z.object({ id: Uuid }).openapi('IdResponse');

const PaginationFields = {
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative()
};

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

export const EncounterList = z
  .object({ encounters: z.array(Encounter), ...PaginationFields })
  .openapi('EncounterList');

/** GET /api/encounters/[id] — encounter plus raw participant rows. */
export const EncounterDetail = Encounter.extend({
  participants: z.array(Participant)
}).openapi('EncounterDetail');

export const ActionLogList = z
  .object({ entries: z.array(ActionLogEntry), ...PaginationFields })
  .openapi('ActionLogList');

/** POST /api/encounters/[id]/log — the stored entry plus any reaction
 *  opportunities the submission triggered. */
export const ActionLogSubmitResponse = ActionLogEntry.extend({
  triggerOpportunities: z.array(z.record(z.string(), z.unknown()))
}).openapi('ActionLogSubmitResponse');

export const RevealsResponse = z
  .object({ reveals: z.record(z.string(), z.boolean()) })
  .openapi('RevealsResponse');

/** Bulk mutation acknowledgement — how many participant rows were written. */
export const UpdatedCountResponse = z
  .object({ ok: z.literal(true), updated: z.number().int().nonnegative() })
  .openapi('UpdatedCountResponse');

/** GET /api/encounters/[id]/difficulty — mirrors EncounterDifficultyResult
 *  from $lib/rules/encounter-difficulty (2014 DMG budgeting math). */
export const EncounterDifficulty = z
  .object({
    edition: z.literal('2014'),
    partySize: z.number().int().nonnegative(),
    monsterCount: z.number().int().nonnegative(),
    baseXp: z.number().int().nonnegative(),
    xpPerCharacter: z.number().int().nonnegative(),
    multiplier: z.number().positive(),
    adjustedXp: z.number().int().nonnegative(),
    thresholds: z.object({
      easy: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      hard: z.number().int().nonnegative(),
      deadly: z.number().int().nonnegative()
    }),
    rating: z.enum(['trivial', 'easy', 'medium', 'hard', 'deadly', 'unknown']),
    /** Roster entries we could not price — the estimate is incomplete when
     *  this is non-empty. */
    unrated: z.array(z.string()),
    /** Per-character total levels that fed the thresholds, for display. */
    partyLevels: z.array(z.number().int().positive())
  })
  .openapi('EncounterDifficulty');

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const Note = z
  .object({
    id: Uuid,
    campaignId: Uuid,
    title: z.string(),
    body: z.string(),
    createdAt: TimestampMs,
    updatedAt: TimestampMs
  })
  .openapi('Note');

export const NoteList = z
  .object({ notes: z.array(Note), ...PaginationFields })
  .openapi('NoteList');

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export const Pack = z
  .object({
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    ownerUserId: Uuid.nullable(),
    visibility: z.string(),
    version: z.string(),
    edition: z.string().nullable(),
    rowCount: z.number().int().nonnegative(),
    /** Only present on the pack detail route. */
    rowCountByKind: z.record(z.string(), z.number().int().nonnegative()).optional(),
    createdAt: TimestampMs,
    updatedAt: TimestampMs.nullable()
  })
  .openapi('Pack');

export const PackList = z.object({ items: z.array(Pack) }).openapi('PackList');

export const PackDeleteResponse = z
  .object({ deleted: z.boolean(), rowsDeleted: z.number().int().nonnegative() })
  .openapi('PackDeleteResponse');

// ---------------------------------------------------------------------------
// Homebrew
// ---------------------------------------------------------------------------

export const HomebrewRow = z
  .object({
    kind: z.string(),
    slug: z.string(),
    name: z.string(),
    source: z.string(),
    version: z.number().int().positive(),
    visibility: z.string(),
    ownerUserId: Uuid.nullable(),
    data: z.record(z.string(), z.unknown()),
    createdAt: TimestampMs,
    updatedAt: TimestampMs.nullable(),
    /** Only present on single-row routes. */
    publishedAt: TimestampMs.nullable().optional(),
    isDraft: z.boolean().optional()
  })
  .openapi('HomebrewRow');

export const HomebrewList = z.object({ items: z.array(HomebrewRow) }).openapi('HomebrewList');

export const HomebrewDeleteResponse = z
  .object({
    deleted: z.boolean(),
    inUseBy: z.array(z.object({ id: Uuid, name: z.string() }))
  })
  .openapi('HomebrewDeleteResponse');

export const Subscription = z
  .object({
    kind: z.string(),
    slug: z.string(),
    authorUserId: Uuid,
    authorUsername: z.string().nullable().optional(),
    /** Null when the author has deleted every version. */
    contentName: z.string().nullable(),
    visibility: z.string().nullable(),
    pinnedVersion: z.number().int().positive().nullable(),
    latestPublishedVersion: z.number().int().positive().nullable(),
    createdAt: TimestampMs
  })
  .openapi('Subscription');

export const SubscriptionList = z
  .object({ subscriptions: z.array(Subscription) })
  .openapi('SubscriptionList');

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export const MemberStatus = z.enum(['pending', 'approved', 'rejected']);

export const JoinCampaignResponse = z
  .object({ campaignId: Uuid, status: MemberStatus })
  .openapi('JoinCampaignResponse');

export const MemberStatusResponse = z
  .object({ status: MemberStatus })
  .openapi('MemberStatusResponse');

export const Grant = z
  .object({
    id: Uuid,
    grantType: z.enum(['pack', 'author']),
    grantKey: z.string(),
    label: z.string(),
    /** Absent from the POST response; always present on the list. */
    createdAt: TimestampMs.optional()
  })
  .openapi('Grant');

export const GrantList = z
  .object({ grants: z.array(Grant), ...PaginationFields })
  .openapi('GrantList');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const AuthUserResponse = z
  .object({ id: Uuid, username: z.string() })
  .openapi('AuthUser');

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const Notification = z
  .object({
    id: Uuid,
    type: z.string(),
    contentKind: z.string(),
    contentSlug: z.string(),
    authorUserId: Uuid,
    authorUsername: z.string().nullable(),
    fromVersion: z.number().int().nullable(),
    toVersion: z.number().int().nullable(),
    readAt: TimestampMs.nullable(),
    createdAt: TimestampMs
  })
  .openapi('Notification');

export const NotificationList = z
  .object({
    unreadCount: z.number().int().nonnegative(),
    notifications: z.array(Notification),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative()
  })
  .openapi('NotificationList');

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

/** GET /api/ai/status — feature flag + model. `model` is null when AI is
 *  not configured (ANTHROPIC_API_KEY unset). */
export const AiStatus = z
  .object({ enabled: z.boolean(), model: z.string().nullable() })
  .openapi('AiStatus');

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const AdminReport = z
  .object({
    id: Uuid,
    contentId: Uuid,
    reason: z.string(),
    createdAt: TimestampMs,
    reporterUsername: z.string().nullable(),
    content: z.object({
      kind: z.string(),
      slug: z.string(),
      name: z.string(),
      visibility: z.string(),
      ownerUserId: Uuid.nullable(),
      ownerUsername: z.string().nullable()
    })
  })
  .openapi('AdminReport');

export const AdminReportList = z
  .object({ reports: z.array(AdminReport), ...PaginationFields })
  .openapi('AdminReportList');
