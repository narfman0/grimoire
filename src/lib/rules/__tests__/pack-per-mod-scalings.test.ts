// Locks the evaluator shapes that grimoire-packs rows in the celestial /
// archfey / fiend warlock-patron group rely on for per-ability-mod and
// per-class-level scaling. Before C.0/C.A landed, naked string tokens like
// "chaMod", "warlockLevel", and arithmetic like "1 + warlockLevel" silently
// no-op'd through evaluateValue — the row evaluated to the raw string and
// fell out at applyNumericMode. This file exercises the new structured
// shapes (perAbilityMod / perClassLevel / sum) directly *and* round-trips
// one through derive() to confirm Resource.max actually computes the
// dynamic value when a feat row's activity uses the evaluator.
//
// Coverage:
//  - perAbilityMod   — sear-undead pattern: `{perAbilityMod, dieSize}` →
//                      "{abilityMod}d{die}" dice string with min-1 clamp.
//  - perClassLevel   — preserve-life pattern: `{perClassLevel, multiplier}`
//                      → numeric (classLevel * multiplier).
//  - sum             — dark-ones-blessing pattern: `{sum: […]}` resolves
//                      named tokens and adds them.
//  - end-to-end uses.max via derive() — a homebrew feat declares a
//                      per-long-rest resource whose max is the sum of a
//                      class-level token and a literal; the Resource that
//                      pops out of derive() carries the right max.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { evaluateValue, type EvalContext } from '../evaluate';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import type { CharacterDocument, ContentRow } from '../types';

/** Synthetic eval ctx for a warlock-flavored character: WIS +2, CHA +3,
 *  3 warlock levels. Mirrors the shape `derive()` builds internally so
 *  these unit tests stay grounded in the production code path. */
const WARLOCK_CTX: EvalContext = {
  totalLevel: 3,
  proficiencyBonus: 2,
  rageDamage: 0,
  classLevels: { warlock: 3 },
  abilityMods: { str: 0, dex: 1, con: 2, int: 0, wis: 2, cha: 3 },
  walkSpeed: 30,
  conditionStacks: {}
};

describe('perAbilityMod shape (sear-undead pattern)', () => {
  it('produces "{wisMod}d8" with the right modifier value', () => {
    // WIS +2 → "2d8". This is the canonical sear-undead encoding
    // (content-packs/srd-5.2/features/cleric.json:159).
    expect(evaluateValue({ perAbilityMod: 'wis', dieSize: 8 }, WARLOCK_CTX))
      .toBe('2d8');
  });

  it('produces "{chaMod}d6" — exactly the healing-light dice expression', () => {
    // CHA +3 → "3d6". Mirrors phb-2024 celestial-patron healing-light's
    // per-use heal roll after C.0 promoted it from the inert "chaMod d6"
    // string token (which used to fall through evaluateValue unchanged).
    expect(evaluateValue({ perAbilityMod: 'cha', dieSize: 6 }, WARLOCK_CTX))
      .toBe('3d6');
  });

  it('clamps the dice count to a minimum of 1 when the mod is 0 or negative', () => {
    // Prose-required minimums ("minimum of one die") get a built-in floor.
    // A CHA-8 warlock should still roll at least 1d6; the engine clamps via
    // Math.max(1, mod ?? 1) inside the perAbilityMod branch.
    const lowCha: EvalContext = { ...WARLOCK_CTX, abilityMods: { ...WARLOCK_CTX.abilityMods, cha: -1 } };
    expect(evaluateValue({ perAbilityMod: 'cha', dieSize: 6 }, lowCha)).toBe('1d6');
    const zeroCha: EvalContext = { ...WARLOCK_CTX, abilityMods: { ...WARLOCK_CTX.abilityMods, cha: 0 } };
    expect(evaluateValue({ perAbilityMod: 'cha', dieSize: 6 }, zeroCha)).toBe('1d6');
  });
});

describe('perClassLevel shape (preserve-life pattern)', () => {
  it('resolves classLevel × multiplier as a numeric', () => {
    // Warlock 3 × 5 = 15. Mirrors the preserve-life healing-pool encoding
    // (srd-5.2/features/subclasses.json:268) — same shape, different class.
    expect(evaluateValue({ perClassLevel: 'warlock', multiplier: 5 }, WARLOCK_CTX))
      .toBe(15);
  });

  it('returns 0 when the character has no levels in the named class', () => {
    // A pure-warlock character has no cleric levels → the resource max
    // should evaluate to 0 so derive() drops it instead of emitting an
    // off-spec preserve-life pool.
    expect(evaluateValue({ perClassLevel: 'cleric', multiplier: 5 }, WARLOCK_CTX))
      .toBe(0);
  });

  it('handles multiplier=1 (raw class-level read-out)', () => {
    expect(evaluateValue({ perClassLevel: 'warlock', multiplier: 1 }, WARLOCK_CTX))
      .toBe(3);
  });
});

describe('sum shape (dark-ones-blessing pattern)', () => {
  it('adds named tokens together: warlockLevel + chaMod', () => {
    // The SRD fiend-patron dark-ones-blessing trigger grants temp HP equal
    // to { sum: [warlockLevel, chaMod] }. Warlock 3 + CHA +3 → 6.
    expect(evaluateValue({ sum: ['warlockLevel', 'chaMod'] }, WARLOCK_CTX))
      .toBe(6);
  });

  it('mixes literals and tokens: 1 + warlockLevel (healing-light pool size)', () => {
    // celestial-patron healing-light pool = 1 + warlockLevel. Warlock 3 → 4.
    expect(evaluateValue({ sum: [1, 'warlockLevel'] }, WARLOCK_CTX)).toBe(4);
  });

  it('returns 0 when no parts resolve to a number (defensive fallback)', () => {
    // Unknown tokens fall through as strings; `sum` skips non-numeric
    // results rather than producing NaN.
    expect(evaluateValue({ sum: ['unknownToken', 'anotherUnknown'] }, WARLOCK_CTX))
      .toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a homebrew feat declares a resource whose max uses one of the
// new evaluator shapes. derive() must compute the dynamic value and emit a
// Resource row that the encounter UI can show as N/N.
// ---------------------------------------------------------------------------

let PACKS: Map<string, ContentRow>;
beforeAll(() => {
  PACKS = loadAllPacks();
});

function lookupWithHomebrew(brew: ContentRow) {
  return (ref: { kind: string; slug: string }) => {
    if (ref.kind === brew.kind && ref.slug === brew.slug) return brew;
    return PACKS.get(`${ref.kind}/${ref.slug}`);
  };
}

describe('uses.max evaluation via derive() (end-to-end)', () => {
  it('a sum-shaped uses.max becomes the Resource.max on the derived sheet', () => {
    // Build a homebrew "healing-light"-flavored feat with the celestial
    // patron's pool-size encoding. We attach it to the zealot fixture (a
    // barbarian) and assert the resource's max is 1 + barbarianLevel = 4
    // (the fixture is at barbarian L3). This isolates the eval path — no
    // dependence on warlock content being loaded — while still exercising
    // the real derive() pipeline.
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'test-celestial-pool',
      version: 1,
      name: 'Test Celestial Pool',
      source: 'homebrew',
      data: {
        activities: [
          {
            id: 'test-pool',
            type: 'heal',
            name: 'Test Pool',
            cost: 'bonus',
            uses: { max: { sum: [1, 'barbarianLevel'] }, per: 'long-rest' }
          }
        ]
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    const resource = d.resources.find((r) => r.id.includes('test-pool'));
    expect(resource).toBeDefined();
    // Zealot fixture is barbarian L3 → 1 + 3 = 4.
    expect(resource?.max).toBe(4);
    expect(resource?.per).toBe('long-rest');
  });

  it('a perClassLevel-shaped uses.max scales with class level', () => {
    // Pool = barbarianLevel × 2 = 6 at L3. Demonstrates that the
    // perClassLevel shape flows through evaluateValue → Resource.max
    // identically to the sear-undead/preserve-life pattern.
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'test-class-level-pool',
      version: 1,
      name: 'Test Class-Level Pool',
      source: 'homebrew',
      data: {
        activities: [
          {
            id: 'class-level-pool',
            type: 'heal',
            name: 'Class-Level Pool',
            cost: 'bonus',
            uses: {
              max: { perClassLevel: 'barbarian', multiplier: 2 },
              per: 'long-rest'
            }
          }
        ]
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    const resource = d.resources.find((r) => r.id.includes('class-level-pool'));
    expect(resource).toBeDefined();
    expect(resource?.max).toBe(6);
  });

  it('drops the resource when the evaluator produces a non-positive value (engine gap note)', () => {
    // Documents the engine's current minimum-clamp behavior for resource
    // pools: if the evaluator returns 0 or negative (e.g. chaMod for a
    // CHA-8 character), derive() short-circuits with
    //   `if (typeof max !== 'number' || max <= 0) continue;`
    // and emits no resource. Steps-of-the-Fey prose says "minimum of once"
    // — that floor is NOT yet enforced by the engine and would need a
    // dedicated clamp evaluator shape to honor the prose for CHA-dumped
    // characters. Locked here so a future change is intentional.
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'test-zero-pool',
      version: 1,
      name: 'Test Zero Pool',
      source: 'homebrew',
      data: {
        activities: [
          {
            id: 'zero-pool',
            type: 'utility',
            name: 'Zero Pool',
            cost: 'bonus',
            // Zealot fixture has CHA 10 → chaMod = 0. Pool drops.
            uses: { max: 'chaMod', per: 'long-rest' }
          }
        ]
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    const resource = d.resources.find((r) => r.id.includes('zero-pool'));
    expect(resource).toBeUndefined();
  });
});
