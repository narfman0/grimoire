import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) throw redirect(303, '/');
  return {};
};

// Progressive enhancement: posts here without JS; forwards to the existing
// API route via event.fetch (session cookie propagates through SvelteKit's
// internal fetch cookie passthrough).
export const actions: Actions = {
  default: async ({ request, fetch }) => {
    const form = await request.formData();
    const username = String(form.get('username') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');

    if (password.length < 8) {
      return fail(400, { error: 'password must be at least 8 characters', username, email });
    }
    if (password !== confirmPassword) {
      return fail(400, { error: 'passwords do not match', username, email });
    }

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    if (!res.ok) {
      let body = '';
      try {
        const parsed = await res.json();
        if (typeof parsed?.message === 'string') body = parsed.message;
      } catch {
        /* keep status-based message */
      }
      const message =
        res.status === 409
          ? body.includes('email')
            ? 'that email is already registered'
            : 'that username is already taken'
          : res.status === 429
            ? 'too many requests — try again later'
            : res.status === 400
              ? body || 'invalid signup details'
              : `signup failed (${res.status})`;
      return fail(res.status, { error: message, username, email });
    }
    throw redirect(303, '/');
  }
};
