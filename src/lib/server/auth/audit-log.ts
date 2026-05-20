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
  | 'resend_verify';

interface LogOptions {
  userId?: string;
  action: AuthAction;
  ip?: string;
  userAgent?: string;
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
