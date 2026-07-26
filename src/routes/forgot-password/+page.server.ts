import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';

// Progressive enhancement: posts here without JS; forwards to the existing
// API route via event.fetch.
export const actions: Actions = {
  default: async ({ request, fetch }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();

    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (res.status === 429) {
      return fail(429, { error: 'too many requests — try again later', email });
    }
    // Deliberately treat every other outcome as success — the API never
    // discloses whether the email exists, and neither do we.
    return { sent: true };
  }
};
