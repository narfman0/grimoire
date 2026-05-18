// Tests for the version-picking logic inside buildContentLookup. The DB
// pieces are best covered with an integration harness; these are pure-
// function tests over the row-selection rules:
//
//   - own rows: latest version wins regardless of publish state
//   - subscriber pinned: exact published version if present, else latest published
//   - subscriber tracking latest (null pin): latest published row
//   - drafts are invisible to non-owners

import { describe, it, expect } from 'vitest';
import { pickRow, type RowCandidate } from '../lookup';

function row(version: number, publishedAt: Date | null, ownerUserId: string | null = 'alice'): RowCandidate {
  return {
    kind: 'spell',
    slug: 'fireball',
    version,
    source: 'homebrew',
    name: `Fireball v${version}`,
    data: '{}',
    ownerUserId,
    publishedAt
  };
}

describe('pickRow — owner mode', () => {
  it('returns the highest version regardless of publish state', () => {
    const group = [
      row(1, new Date(1000)),
      row(2, new Date(2000)),
      row(3, null)
    ];
    const picked = pickRow(group, { owner: true });
    expect(picked?.version).toBe(3);
  });

  it('falls back gracefully on an empty group', () => {
    expect(pickRow([], { owner: true })).toBeUndefined();
  });
});

describe('pickRow — subscriber with explicit pin', () => {
  it('returns the exact pinned version when it is published', () => {
    const group = [
      row(1, new Date(1000)),
      row(2, new Date(2000)),
      row(3, new Date(3000))
    ];
    expect(pickRow(group, { pinnedVersion: 2 })?.version).toBe(2);
  });

  it('falls back to the latest published when the pin is unpublished/missing', () => {
    const group = [
      row(1, new Date(1000)),
      row(2, new Date(2000)),
      row(3, null) // draft
    ];
    // Pin points at the draft (3) which isn't published — falls back to v2.
    expect(pickRow(group, { pinnedVersion: 3 })?.version).toBe(2);
    // Pin points at a version that no longer exists — falls back to latest.
    expect(pickRow(group, { pinnedVersion: 99 })?.version).toBe(2);
  });
});

describe('pickRow — subscriber tracking latest (null pin)', () => {
  it('returns the highest published version', () => {
    const group = [
      row(1, new Date(1000)),
      row(2, new Date(2000)),
      row(3, null) // draft, excluded
    ];
    expect(pickRow(group, { pinnedVersion: null })?.version).toBe(2);
  });

  it('returns undefined when no version has been published yet', () => {
    const group = [row(1, null), row(2, null)];
    expect(pickRow(group, { pinnedVersion: null })).toBeUndefined();
  });
});

describe('pickRow — non-owner cannot see drafts', () => {
  it("does not return a draft even when it's the only row", () => {
    const group = [row(1, null)];
    expect(pickRow(group, {})).toBeUndefined();
    expect(pickRow(group, { pinnedVersion: 1 })).toBeUndefined();
  });
});
