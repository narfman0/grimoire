import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';

// Progressive enhancement: posts here without JS; forwards to the existing
// API route via event.fetch. The token travels as a hidden input so the
// no-JS flow works too.
export const actions: Actions = {
  default: async ({ request, fetch }) => {
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');

    if (password !== confirmPassword) {
      return fail(400, { error: 'passwords do not match' });
    }

    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password })
    });
    if (!res.ok) {
      let body = '';
      try {
        const parsed = await res.json();
        if (typeof parsed?.message === 'string') body = parsed.message;
      } catch {
        /* keep status-based message */
      }
      const message = res.status === 400 ? body || 'invalid or expired link' : `error (${res.status})`;
      return fail(res.status, { error: message });
    }
    return { done: true };
  }
};
