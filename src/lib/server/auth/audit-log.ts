import { db, schema } from '$lib/server/db';

export type AuthAction =
  | 'login_success'
  | 'login_failure'
  | 'login_locked'
  | 'signup'
  | 'email_verified'
  | 'password_reset_requested'
  | 'password_reset'
  | 'password_changed'
  | 'resend_verify'
  /** A DM changed who may act for whom in a campaign. Recorded so a player
   *  who suddenly can't roll for a friend can be given a reason. */
  | 'campaign_permission_changed';

interface LogOptions {
  userId?: string;
  action: AuthAction;
  ip?: string;
  userAgent?: string;
}

/** Record a campaign permission flip. Rides the auth log rather than a new
 *  table: it is the same kind of fact (who changed what authority, when), and
 *  a dedicated table would be a second migration for one row type.
 *  `userAgent` carries the detail since the log has no free-form column. */
export async function logCampaignPermissionChange(opts: {
  userId: string;
  campaignId: string;
  permission: string;
  allowed: boolean;
}): Promise<void> {
  await logAuthEvent({
    userId: opts.userId,
    action: 'campaign_permission_changed',
    userAgent: `campaign=${opts.campaignId} ${opts.permission}=${opts.allowed ? 'allow' : 'deny'}`
  });
}

export async function logAuthEvent(opts: LogOptions): Promise<void> {
  await db.insert(schema.authLog).values({
    id: crypto.randomUUID(),
    userId: opts.userId ?? null,
    action: opts.action,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
    createdAt: new Date()
  });
}
