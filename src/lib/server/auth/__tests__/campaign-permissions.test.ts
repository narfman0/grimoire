import { describe, it, expect } from 'vitest';
import {
  getCampaignPermissions,
  PERMISSIVE_DEFAULTS,
  type CampaignPermissions
} from '../campaign-permissions';

describe('campaign permissions', () => {
  it('allows everything by default', async () => {
    const perms = await getCampaignPermissions('any-campaign');
    expect(perms).toEqual({
      actForOthers: true,
      editOthersVitals: true,
      planForOthers: true
    });
  });

  it('returns a fresh object so a caller cannot mutate the defaults', async () => {
    const perms = await getCampaignPermissions('c1');
    perms.actForOthers = false;
    const again = await getCampaignPermissions('c1');
    expect(again.actForOthers).toBe(true);
  });

  it('freezes the exported defaults', () => {
    expect(Object.isFrozen(PERMISSIVE_DEFAULTS)).toBe(true);
  });

  // Tripwire for phase 8b: every permission must default to allow. A new key
  // added with a restrictive default would silently take capability away from
  // tables that never asked for it.
  it('has no restrictive default', async () => {
    const perms = (await getCampaignPermissions('c1')) as unknown as Record<
      keyof CampaignPermissions,
      boolean
    >;
    const restrictive = Object.entries(perms).filter(([, v]) => v !== true);
    expect(restrictive).toEqual([]);
  });
});
