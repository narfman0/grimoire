import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';

// Progressive enhancement: posts here without JS; forwards to the existing
// API route via event.fetch (the caller's session cookie is forwarded).
export const actions: Actions = {
  default: async ({ request, fetch }) => {
    const form = await request.formData();
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');

    if (newPassword !== confirmPassword) {
      return fail(400, { error: 'new passwords do not match' });
    }

    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    if (!res.ok) {
      const message =
        res.status === 401 ? 'current password is incorrect' : `error (${res.status})`;
      return fail(res.status, { error: message });
    }
    return { done: true };
  }
};
