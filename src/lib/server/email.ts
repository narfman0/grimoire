import { logger } from '$lib/server/logger';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.FROM_EMAIL ?? 'noreply@grimoire.app';

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    logger.info({ to, subject }, 'email skipped — no API key configured');
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

export function verificationEmail(username: string, link: string): string {
  return `<p>Hi ${username},</p>
<p>Click the link below to verify your email address:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`;
}

export function passwordResetEmail(username: string, link: string): string {
  return `<p>Hi ${username},</p>
<p>Someone requested a password reset for your Grimoire account. Click the link below to set a new password:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 1 hour. If you didn't request this, you can ignore this email — your password won't change.</p>`;
}
