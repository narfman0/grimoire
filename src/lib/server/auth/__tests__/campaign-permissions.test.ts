import { describe, it, expect } from 'vitest';
import {
  mergePermissions,
  PERMISSIVE_DEFAULTS,
  type CampaignPermissions
} from '../campaign-permissions';

describe('campaign permissions', () => {
  it('allows everything by default', () => {
    expect(mergePermissions(null)).toEqual({
      actForOthers: true,
      editOthersVitals: true,
      planForOthers: true
    });
  });

  it('returns a fresh object so a caller cannot mutate the defaults', () => {
    const perms = mergePermissions(null);
    perms.actForOthers = false;
    expect(mergePermissions(null).actForOthers).toBe(true);
  });

  it('freezes the exported defaults', () => {
    expect(Object.isFrozen(PERMISSIVE_DEFAULTS)).toBe(true);
  });

  // Tripwire: every permission must default to allow. A new key added with a
  // restrictive default would silently take capability away from tables that
  // never asked for it.
  it('has no restrictive default', () => {
    const perms = mergePermissions(null) as unknown as Record<
      keyof CampaignPermissions,
      boolean
    >;
    const restrictive = Object.entries(perms).filter(([, v]) => v !== true);
    expect(restrictive).toEqual([]);
  });

  // getCampaignPermissions itself is exercised against a real DB by the route
  // tests, which are the ones that prove a stored restriction actually
  // restricts something. Everything decision-making here is in
  // mergePermissions, below.
});

// ---- overrides (phase 8b, migration 0009) ----
//
// mergePermissions is the whole read path: `campaigns.permissions_json` is
// nullable with no backfill, so "absent" and "corrupt" both have to resolve
// to the permissive defaults or the migration would silently take capability
// away from every existing table.
describe('mergePermissions', () => {
  it('returns defaults for null (every pre-migration campaign)', () => {
    expect(mergePermissions(null)).toEqual(PERMISSIVE_DEFAULTS);
    expect(mergePermissions(undefined)).toEqual(PERMISSIVE_DEFAULTS);
    expect(mergePermissions('')).toEqual(PERMISSIVE_DEFAULTS);
  });

  it('applies a stored restriction', () => {
    expect(mergePermissions('{"actForOthers":false}')).toEqual({
      ...PERMISSIVE_DEFAULTS,
      actForOthers: false
    });
  });

  it('leaves unnamed keys at their default', () => {
    const merged = mergePermissions('{"actForOthers":false}');
    expect(merged.editOthersVitals).toBe(true);
    expect(merged.planForOthers).toBe(true);
  });

  it.each([
    ['{not json', 'unparseable'],
    ['null', 'null literal'],
    ['[]', 'array'],
    ['"nope"', 'string'],
    ['{"actForOthers":"false"}', 'string instead of boolean'],
    ['{"actForOthers":0}', 'number instead of boolean'],
    ['{"unknownKey":false}', 'unknown key']
  ])('falls back to allow for %j (%s)', (raw) => {
    // Fail *open* here on purpose: this column can only remove capability, so
    // a value we can't read must not be able to remove it by accident.
    expect(mergePermissions(raw).actForOthers).toBe(true);
  });
});
