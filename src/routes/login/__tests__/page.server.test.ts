import { describe, it, expect } from 'vitest';
import { makeLoadEvent } from '$lib/server/__tests__/test-event';
import { load } from '../+page.server';

const loadEvent = makeLoadEvent;

describe('/login +page.server load', () => {
  // Locks: the login page is unreachable for an already-signed-in user.
  // Regression here would expose the login form post-auth and confuse the
  // signup→login redirect on cold start.
  it('redirects to / when locals.user is present', async () => {
    await expect(
      load(loadEvent({ user: { id: 'u1', username: 'a', isAdmin: false } }))
    ).rejects.toMatchObject({ status: 303 });
  });

  it('returns an empty object when there is no session', async () => {
    const data = await load(loadEvent({ user: null }));
    expect(data).toEqual({});
  });
});
