// Engine-side smoke test: a homebrew feat row (synthetic, not loaded from
// any pack) flows through derive() exactly like an SRD feat — its
// modifiers and player choices are applied to the resulting stat block.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import type { ContentRow, CharacterDocument } from '../types';

let PACKS: Map<string, ContentRow>;
beforeAll(() => {
  PACKS = loadAllPacks();
});

/** Build a lookup that overlays a single homebrew feat onto the real pack
 *  set. Mirrors what buildContentLookup() does for an in-app user. */
function lookupWithHomebrew(brew: ContentRow) {
  return (ref: { kind: string; slug: string }) => {
    if (ref.kind === brew.kind && ref.slug === brew.slug) return brew;
    return PACKS.get(`${ref.kind}/${ref.slug}`);
  };
}

describe('homebrew feat → derive()', () => {
  it('applies a static modifier from a homebrew feat', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'bear-strength',
      version: 1,
      name: 'Bear Strength',
      source: 'homebrew',
      data: {
        modifiers: [
          { kind: 'stat-modifier', target: 'ability.str', mode: 'ADD', value: 2 }
        ]
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    // Baseline zealot fixture lands at STR 17 (Half-Orc ASI); +2 from
    // homebrew puts it at 19.
    expect(d.stats.abilities.str.score).toBe(19);
  });

  it('applies an ASI choice from a homebrew feat', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'minor-prodigy',
      version: 1,
      name: 'Minor Prodigy',
      source: 'homebrew',
      data: {
        choices: { asi: { bonus: 1, allowedAbilities: ['int', 'wis', 'cha'] } }
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug, choices: { asi: { ability: 'cha' } } }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    // Baseline CHA is 10; +1 from homebrew ASI pick → 11.
    expect(d.stats.abilities.cha.score).toBe(11);
  });

  it('silently skips a missing homebrew feat row (engine tolerates orphans)', () => {
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: 'deleted-homebrew' }]
    };
    // No row provided — the engine treats it as a missing reference and
    // produces the same stat block as the fixture baseline.
    const baseLookup = (ref: { kind: string; slug: string }) =>
      PACKS.get(`${ref.kind}/${ref.slug}`);
    const d = derive(character, baseLookup);
    expect(d.stats.abilities.str.score).toBe(17); // unchanged
  });
});
