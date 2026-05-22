// Engine-side smoke test: the grimoire-packs phb-2024 cleric domain
// subclass-spells rows (war-domain-spells, light-domain-spells,
// trickery-domain-spells) carry `spellListAdditions` so the listed spells
// flow into Derived.alwaysPreparedFromContent — and therefore into the
// sheet's action list — without the player editing spells.prepared.
//
// CI has no access to grimoire-packs, so we build a synthetic feature row
// (homebrew-style) whose data carries the same primitive. The engine
// contract is identical to a real subclass-spells row: `kind: 'feature'`
// with `data.spellListAdditions`, pulled in via a carrier (subclass or
// feat) that lists it under `data.features`.
//
// Parallel reference: the fey-touched test in mechanics.test.ts (C.4)
// locks the same primitive when it's emitted by a feat row.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import type { ContentRow, CharacterDocument } from '../types';

let PACKS: Map<string, ContentRow>;
beforeAll(() => {
  PACKS = loadAllPacks();
});

/** Overlay any number of synthetic rows onto the real pack set. */
function lookupWithRows(...rows: ContentRow[]) {
  const overlay = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref: { kind: string; slug: string }) =>
    overlay.get(`${ref.kind}/${ref.slug}`) ?? PACKS.get(`${ref.kind}/${ref.slug}`);
}

/** Build the (feat-carrier, feature) pair that mimics the production shape
 *  of a subclass-spells row. The feat sits in `character.feats[]` so it
 *  enters `active`; its `data.features` pulls in the feature row, whose
 *  `data.spellListAdditions` then drives Derived.alwaysPreparedFromContent. */
function makeDomainSpellsCarrier(
  featureSlug: string,
  additions: string[]
): { feat: ContentRow; feature: ContentRow } {
  const feat: ContentRow = {
    kind: 'feat',
    slug: `${featureSlug}-carrier`,
    version: 1,
    name: `${featureSlug} carrier`,
    source: 'test',
    data: { features: [featureSlug] }
  };
  const feature: ContentRow = {
    kind: 'feature',
    slug: featureSlug,
    version: 1,
    name: featureSlug,
    source: 'test',
    data: {
      ownerKind: 'feat',
      ownerSlug: feat.slug,
      minLevel: 1,
      spellListAdditions: additions
    }
  };
  return { feat, feature };
}

describe('pack-shape domain-spells row → derive()', () => {
  it('spellListAdditions surface on alwaysPreparedFromContent', () => {
    // burning-hands lives in SRD spells/1st-level.json, so derive() can
    // resolve the spell row and the engine flags it as always-prepared.
    const { feat, feature } = makeDomainSpellsCarrier('light-domain-spells-synthetic', [
      'burning-hands',
      'fireball'
    ]);
    const character: CharacterDocument = {
      ...chronurgy.CHARACTER,
      feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug: feat.slug }]
    };
    const d = derive(character, lookupWithRows(feat, feature));
    expect(d.alwaysPreparedFromContent).toContain('burning-hands');
    expect(d.alwaysPreparedFromContent).toContain('fireball');
  });

  it('parses cleanly with multiple additions and produces sheet actions', () => {
    // The chronurgy wizard fixture is a full caster, so injected spells
    // realize into actions on the sheet — same downstream path as a real
    // cleric receiving war-/light-/trickery-domain spells.
    const { feat, feature } = makeDomainSpellsCarrier('war-domain-spells-synthetic', [
      'spiritual-weapon',
      'spirit-guardians'
    ]);
    const character: CharacterDocument = {
      ...chronurgy.CHARACTER,
      feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug: feat.slug }]
    };
    const d = derive(character, lookupWithRows(feat, feature));
    expect(d.alwaysPreparedFromContent).toContain('spiritual-weapon');
    expect(d.alwaysPreparedFromContent).toContain('spirit-guardians');
    const spiritualWeapon = d.actions.find((a) => a.sourceContent.slug === 'spiritual-weapon');
    expect(spiritualWeapon).toBeDefined();
  });

  it('silently skips a slug that has no spell row (engine tolerates orphans)', () => {
    // Mirrors homebrew-feat.test.ts:260 — when an addition references a
    // missing spell slug (e.g. a 2024-PHB-only spell not yet in SRD), the
    // engine tolerates the orphan: the present spells still surface and
    // derive() does not throw.
    const { feat, feature } = makeDomainSpellsCarrier('trickery-domain-spells-synthetic', [
      'dimension-door',
      'polymorph',
      'a-spell-that-does-not-exist'
    ]);
    const character: CharacterDocument = {
      ...chronurgy.CHARACTER,
      feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug: feat.slug }]
    };
    const d = derive(character, lookupWithRows(feat, feature));
    expect(d.alwaysPreparedFromContent).toContain('dimension-door');
    expect(d.alwaysPreparedFromContent).toContain('polymorph');
    // alwaysPreparedFromContent records the slug regardless of whether
    // the spell row resolves — but no action is created for the missing
    // row, and the engine does not throw.
    const orphanAction = d.actions.find(
      (a) => a.sourceContent.slug === 'a-spell-that-does-not-exist'
    );
    expect(orphanAction).toBeUndefined();
  });
});
