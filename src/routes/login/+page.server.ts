import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) throw redirect(303, '/');
  return {};
};

// Progressive enhancement: the form posts here (works without JS) and the
// action forwards to the existing API route via event.fetch — the session
// cookie set by the handler propagates to this response through SvelteKit's
// internal fetch cookie passthrough.
export const actions: Actions = {
  default: async ({ request, fetch }) => {
    const form = await request.formData();
    const username = String(form.get('username') ?? '').trim();
    const password = String(form.get('password') ?? '');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      const message =
        res.status === 401
          ? 'invalid username or password'
          : res.status === 423
            ? 'account temporarily locked — try again later or reset your password'
            : res.status === 429
              ? 'too many requests — try again later'
              : `login failed (${res.status})`;
      return fail(res.status, { error: message, username });
    }
    throw redirect(303, '/');
  }
};
