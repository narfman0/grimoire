// Engine-level tests for the marketplace resolution model: two authors
// publishing the same (kind, slug) must resolve independently when each
// ContentRef carries an `authorUserId`. SRD content (null author) resolves
// from refs without an author hint. Subscriptions are tested by simulating
// the map shape that buildContentLookup ships.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { contentMapKey, lookupFromMap } from '../types';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import type { ContentRow, CharacterDocument } from '../types';

let PACKS: Map<string, ContentRow>;
beforeAll(() => {
  PACKS = loadAllPacks();
});

/** Compose a content map keyed the way buildContentLookup serializes it,
 *  combining pack rows (null author) plus an arbitrary set of homebrew rows
 *  keyed by their author id. */
function mapFromPacks(homebrew: Array<{ authorUserId: string; row: ContentRow }> = []) {
  const map: Record<string, ContentRow> = {};
  for (const [k, row] of PACKS) {
    const [kind, slug] = k.split('/');
    map[contentMapKey(kind, slug, null)] = row;
  }
  for (const { authorUserId, row } of homebrew) {
    map[contentMapKey(row.kind, row.slug, authorUserId)] = row;
  }
  return map;
}

describe('two authors with the same slug coexist', () => {
  it('resolves Alice and Bob independently when refs carry authorUserId', () => {
    const aliceAlert: ContentRow = {
      kind: 'feat',
      slug: 'alert',
      version: 1,
      source: 'homebrew',
      name: "Alice's Alert",
      data: {
        modifiers: [
          { kind: 'stat-modifier', target: 'ability.str', mode: 'ADD', value: 1 }
        ]
      }
    };
    const bobAlert: ContentRow = {
      kind: 'feat',
      slug: 'alert',
      version: 1,
      source: 'homebrew',
      name: "Bob's Alert",
      data: {
        modifiers: [
          { kind: 'stat-modifier', target: 'ability.cha', mode: 'ADD', value: 1 }
        ]
      }
    };
    const map = mapFromPacks([
      { authorUserId: 'alice', row: aliceAlert },
      { authorUserId: 'bob', row: bobAlert }
    ]);
    const lookup = lookupFromMap(map);

    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [
        { kind: 'feat', slug: 'alert', authorUserId: 'alice' },
        { kind: 'feat', slug: 'alert', authorUserId: 'bob' }
      ]
    };
    const d = derive(character, lookup);

    // Baseline zealot STR is 17, CHA is 10. Alice's Alert adds +1 STR; Bob's
    // Alert adds +1 CHA. Both refs resolve independently.
    expect(d.stats.abilities.str.score).toBe(18);
    expect(d.stats.abilities.cha.score).toBe(11);
  });
});

describe('null-author fallback', () => {
  it('refs without authorUserId hit the global pack row even when a same-slug homebrew exists', () => {
    // Park a homebrew "alert" feat that adds +5 STR (wildly wrong, easy to
    // detect). A legacy ref `{ kind: 'feat', slug: 'alert' }` should hit
    // the global SRD alert (which doesn't add ability scores) instead.
    const noisyAlert: ContentRow = {
      kind: 'feat',
      slug: 'alert',
      version: 1,
      source: 'homebrew',
      name: 'Noisy Alert',
      data: {
        modifiers: [
          { kind: 'stat-modifier', target: 'ability.str', mode: 'ADD', value: 5 }
        ]
      }
    };
    const map = mapFromPacks([{ authorUserId: 'noisy-user', row: noisyAlert }]);
    const lookup = lookupFromMap(map);

    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: 'alert' }] // no authorUserId
    };
    const d = derive(character, lookup);

    // SRD Alert grants initiative-related things, not STR; should be unchanged.
    expect(d.stats.abilities.str.score).toBe(17);
  });

  it('a ref with authorUserId for a missing author falls back to global', () => {
    // If the character document was authored against author 'alice' but
    // alice's row has been deleted/unsubscribed, the engine should fall
    // back to a same-slug global row rather than render the character
    // broken. Use SRD alert; ref points at the ghost author.
    const map = mapFromPacks();
    const lookup = lookupFromMap(map);

    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: 'alert', authorUserId: 'alice' }]
    };
    const d = derive(character, lookup);
    // Falls back to SRD alert — engine renders successfully.
    expect(d.stats.totalLevel).toBe(3);
  });
});

describe('subscription resolution', () => {
  it("a row owned by an author the user is subscribed to is in the map", () => {
    // We don't exercise the SQL join here (covered in server tests).
    // What we verify: when the map includes a subscribed author's row,
    // refs carrying that authorUserId resolve correctly.
    const subscribedFeat: ContentRow = {
      kind: 'feat',
      slug: 'borrowed-glory',
      version: 1,
      source: 'homebrew',
      name: 'Borrowed Glory',
      data: {
        modifiers: [
          { kind: 'stat-modifier', target: 'ability.cha', mode: 'ADD', value: 2 }
        ]
      }
    };
    const map = mapFromPacks([{ authorUserId: 'famous-author', row: subscribedFeat }]);
    const lookup = lookupFromMap(map);

    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: 'borrowed-glory', authorUserId: 'famous-author' }]
    };
    const d = derive(character, lookup);

    expect(d.stats.abilities.cha.score).toBe(12); // 10 + 2
  });
});
