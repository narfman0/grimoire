// Phase 4 / engine emission: Derived.pendingFeatureChoices[]. Walks
// active feature + subclass rows that declare data.choices and surfaces
// what slots exist + which picks the player has recorded. The UI uses
// this manifest to render per-feature pickers.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function fakeFeature(slug: string, name: string, choices: Record<string, unknown>): ContentRow {
  return {
    kind: 'feature',
    slug,
    version: 1,
    name,
    source: 'test',
    data: { choices }
  };
}

function withFeat(slug: string): CharacterDocument {
  return {
    ...chronurgy.CHARACTER,
    feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug, version: 1 }]
  };
}

function wrapLookup(extras: Record<string, ContentRow>) {
  const base = chronurgy.makeLookup(PACKS);
  return (ref: { kind: string; slug: string; version?: number }) =>
    extras[`${ref.kind}/${ref.slug}`] ?? base(ref);
}

describe('Derived.pendingFeatureChoices', () => {
  it('emits a manifest entry for each active feature with data.choices', () => {
    // Stand up a fake feat that pulls in two synthetic features via a
    // synth feature row. Simpler: drive through a feat row that has a
    // `features` reference. But here we just inject a feature directly
    // by pinning it via a synthetic species feat reference.
    //
    // Easiest path: add a feature ref via a synthetic feat row that
    // declares `features: ["test-feature-with-choices"]` so the engine
    // pulls the feature in for derive().
    const featRow: ContentRow = {
      kind: 'feat',
      slug: 'test-host-feat',
      version: 1,
      name: 'Host Feat',
      source: 'test',
      data: { features: ['test-feature-with-choices'] }
    };
    const choiceFeature = fakeFeature('test-feature-with-choices', 'Test Feature', {
      skillProficiency: { allowedSkills: ['nature', 'arcana'] }
    });

    const d = derive(
      withFeat('test-host-feat'),
      wrapLookup({
        'feat/test-host-feat': featRow,
        'feature/test-feature-with-choices': choiceFeature
      })
    );

    const pending = d.pendingFeatureChoices.find((p) => p.featureSlug === 'test-feature-with-choices');
    expect(pending).toBeDefined();
    expect(pending!.featureName).toBe('Test Feature');
    expect(pending!.kind).toBe('feature');
    expect(pending!.declarations).toEqual({
      skillProficiency: { allowedSkills: ['nature', 'arcana'] }
    });
    expect(pending!.picks).toEqual({});
    expect(pending!.unresolved).toBe(true);
  });

  it('marks unresolved=false once all declared slots have picks', () => {
    const featRow: ContentRow = {
      kind: 'feat',
      slug: 'test-host-resolved',
      version: 1,
      name: 'Host',
      source: 'test',
      data: { features: ['test-feature-resolved'] }
    };
    const choiceFeature = fakeFeature('test-feature-resolved', 'Test Resolved', {
      skillProficiency: { allowedSkills: ['nature'] }
    });

    const character: CharacterDocument = {
      ...withFeat('test-host-resolved'),
      featureChoices: {
        'test-feature-resolved': { skillProficiency: { skill: 'nature' } }
      }
    };
    const d = derive(
      character,
      wrapLookup({
        'feat/test-host-resolved': featRow,
        'feature/test-feature-resolved': choiceFeature
      })
    );
    const pending = d.pendingFeatureChoices.find((p) => p.featureSlug === 'test-feature-resolved');
    expect(pending).toBeDefined();
    expect(pending!.picks).toEqual({ skillProficiency: { skill: 'nature' } });
    expect(pending!.unresolved).toBe(false);
  });

  it('only flags unresolved when one of multiple slots is missing a pick', () => {
    const featRow: ContentRow = {
      kind: 'feat',
      slug: 'test-host-partial',
      version: 1,
      name: 'Host',
      source: 'test',
      data: { features: ['test-feature-partial'] }
    };
    const choiceFeature = fakeFeature('test-feature-partial', 'Test Partial', {
      skillProficiency: { allowedSkills: ['nature'] },
      language: { allowedLanguages: ['draconic'] }
    });
    const character: CharacterDocument = {
      ...withFeat('test-host-partial'),
      featureChoices: {
        'test-feature-partial': { skillProficiency: { skill: 'nature' } } // language unresolved
      }
    };
    const d = derive(
      character,
      wrapLookup({
        'feat/test-host-partial': featRow,
        'feature/test-feature-partial': choiceFeature
      })
    );
    const pending = d.pendingFeatureChoices.find((p) => p.featureSlug === 'test-feature-partial');
    expect(pending!.unresolved).toBe(true);
  });

  it('emits nothing for features whose data.choices is absent', () => {
    const d = derive(chronurgy.CHARACTER, chronurgy.makeLookup(PACKS));
    // Chronurgy fixture has no features with choices declared in the SRD/packs
    // it loads, so the manifest is either empty or limited to those that
    // *do* have choices. Either way, every emitted entry must have a
    // non-empty declarations.
    for (const p of d.pendingFeatureChoices) {
      expect(Object.keys(p.declarations).length).toBeGreaterThan(0);
    }
  });

  // ------------------------------------------------------------------
  // Multi-pick `picks: N` semantics: a plural slot is unresolved while
  // the recorded array is shorter than the declared cap, resolved once
  // the array's length hits N. Without `picks` the slot is unresolved
  // only when no array exists at all (back-compat).
  // ------------------------------------------------------------------
  it('plural slot with picks=1 is resolved as soon as one entry is recorded', () => {
    const featRow: ContentRow = {
      kind: 'feat',
      slug: 'test-host-picks-1',
      version: 1,
      name: 'Host',
      source: 'test',
      data: { features: ['test-feature-picks-1'] }
    };
    const choiceFeature = fakeFeature('test-feature-picks-1', 'Test Picks 1', {
      skillProficiencies: { allowedSkills: ['nature', 'arcana'], picks: 1 }
    });
    const character: CharacterDocument = {
      ...withFeat('test-host-picks-1'),
      featureChoices: {
        'test-feature-picks-1': { skillProficiencies: [{ skill: 'nature' }] }
      }
    };
    const d = derive(
      character,
      wrapLookup({
        'feat/test-host-picks-1': featRow,
        'feature/test-feature-picks-1': choiceFeature
      })
    );
    const pending = d.pendingFeatureChoices.find((p) => p.featureSlug === 'test-feature-picks-1');
    expect(pending!.unresolved).toBe(false);
  });

  it('plural slot with picks=N stays unresolved while the array is short', () => {
    const featRow: ContentRow = {
      kind: 'feat',
      slug: 'test-host-partial-multi',
      version: 1,
      name: 'Host',
      source: 'test',
      data: { features: ['test-feature-partial-multi'] }
    };
    const choiceFeature = fakeFeature('test-feature-partial-multi', 'Partial Multi', {
      skillProficiencies: { picks: 3 }
    });
    const character: CharacterDocument = {
      ...withFeat('test-host-partial-multi'),
      featureChoices: {
        'test-feature-partial-multi': {
          skillProficiencies: [{ skill: 'arcana' }, { skill: 'history' }] // 2 of 3
        }
      }
    };
    const d = derive(
      character,
      wrapLookup({
        'feat/test-host-partial-multi': featRow,
        'feature/test-feature-partial-multi': choiceFeature
      })
    );
    const pending = d.pendingFeatureChoices.find(
      (p) => p.featureSlug === 'test-feature-partial-multi'
    );
    expect(pending!.unresolved).toBe(true);
  });

  it('plural slot with picks=N is resolved once the array hits N', () => {
    const featRow: ContentRow = {
      kind: 'feat',
      slug: 'test-host-full-multi',
      version: 1,
      name: 'Host',
      source: 'test',
      data: { features: ['test-feature-full-multi'] }
    };
    const choiceFeature = fakeFeature('test-feature-full-multi', 'Full Multi', {
      languages: { picks: 2 }
    });
    const character: CharacterDocument = {
      ...withFeat('test-host-full-multi'),
      featureChoices: {
        'test-feature-full-multi': {
          languages: [{ language: 'draconic' }, { language: 'celestial' }]
        }
      }
    };
    const d = derive(
      character,
      wrapLookup({
        'feat/test-host-full-multi': featRow,
        'feature/test-feature-full-multi': choiceFeature
      })
    );
    const pending = d.pendingFeatureChoices.find(
      (p) => p.featureSlug === 'test-feature-full-multi'
    );
    expect(pending!.unresolved).toBe(false);
  });

  it('plural slot without picks is unresolved only when no array exists', () => {
    // Open-ended multi-pick (no `picks` cap): the slot is the author's
    // way of saying "the player records as many as they want". An empty
    // recorded array is treated as "they've decided — resolved"; a
    // missing array is the genuine unresolved state.
    const featRow: ContentRow = {
      kind: 'feat',
      slug: 'test-host-open-multi',
      version: 1,
      name: 'Host',
      source: 'test',
      data: { features: ['test-feature-open-multi'] }
    };
    const choiceFeature = fakeFeature('test-feature-open-multi', 'Open Multi', {
      toolProficiencies: { allowedTools: ['smiths-tools', 'carpenters-tools'] }
    });

    // Missing array → unresolved
    const charMissing: CharacterDocument = withFeat('test-host-open-multi');
    const dMissing = derive(
      charMissing,
      wrapLookup({
        'feat/test-host-open-multi': featRow,
        'feature/test-feature-open-multi': choiceFeature
      })
    );
    const pendingMissing = dMissing.pendingFeatureChoices.find(
      (p) => p.featureSlug === 'test-feature-open-multi'
    );
    expect(pendingMissing!.unresolved).toBe(true);

    // Present array (even empty) → resolved
    const charPresent: CharacterDocument = {
      ...charMissing,
      featureChoices: { 'test-feature-open-multi': { toolProficiencies: [] } }
    };
    const dPresent = derive(
      charPresent,
      wrapLookup({
        'feat/test-host-open-multi': featRow,
        'feature/test-feature-open-multi': choiceFeature
      })
    );
    const pendingPresent = dPresent.pendingFeatureChoices.find(
      (p) => p.featureSlug === 'test-feature-open-multi'
    );
    expect(pendingPresent!.unresolved).toBe(false);
  });

  it('spell slot honours picks: N as a partial-pick threshold', () => {
    const featRow: ContentRow = {
      kind: 'feat',
      slug: 'test-host-spell-partial',
      version: 1,
      name: 'Host',
      source: 'test',
      data: { features: ['test-feature-spell-partial'] }
    };
    const choiceFeature = fakeFeature('test-feature-spell-partial', 'Spell Partial', {
      spell: { allowedSpells: ['fireball', 'magic-missile', 'shield'], picks: 2 }
    });

    // Picked only one spell → unresolved
    const charShort: CharacterDocument = {
      ...withFeat('test-host-spell-partial'),
      featureChoices: {
        'test-feature-spell-partial': { spell: { spells: ['fireball'] } }
      }
    };
    const dShort = derive(
      charShort,
      wrapLookup({
        'feat/test-host-spell-partial': featRow,
        'feature/test-feature-spell-partial': choiceFeature
      })
    );
    expect(
      dShort.pendingFeatureChoices.find((p) => p.featureSlug === 'test-feature-spell-partial')!
        .unresolved
    ).toBe(true);

    // Picked both → resolved
    const charFull: CharacterDocument = {
      ...withFeat('test-host-spell-partial'),
      featureChoices: {
        'test-feature-spell-partial': { spell: { spells: ['fireball', 'shield'] } }
      }
    };
    const dFull = derive(
      charFull,
      wrapLookup({
        'feat/test-host-spell-partial': featRow,
        'feature/test-feature-spell-partial': choiceFeature
      })
    );
    expect(
      dFull.pendingFeatureChoices.find((p) => p.featureSlug === 'test-feature-spell-partial')!
        .unresolved
    ).toBe(false);
  });

  it('dedupes when the same feature is pulled in twice (e.g. via two ancestor refs)', () => {
    // Two different feats both reference the same downstream feature.
    const featA: ContentRow = {
      kind: 'feat',
      slug: 'test-host-a',
      version: 1,
      name: 'A',
      source: 'test',
      data: { features: ['test-shared-feature'] }
    };
    const featB: ContentRow = {
      kind: 'feat',
      slug: 'test-host-b',
      version: 1,
      name: 'B',
      source: 'test',
      data: { features: ['test-shared-feature'] }
    };
    const choiceFeature = fakeFeature('test-shared-feature', 'Shared', {
      skillProficiency: { allowedSkills: ['nature'] }
    });

    const character: CharacterDocument = {
      ...chronurgy.CHARACTER,
      feats: [
        ...chronurgy.CHARACTER.feats,
        { kind: 'feat', slug: 'test-host-a', version: 1 },
        { kind: 'feat', slug: 'test-host-b', version: 1 }
      ]
    };
    const d = derive(
      character,
      wrapLookup({
        'feat/test-host-a': featA,
        'feat/test-host-b': featB,
        'feature/test-shared-feature': choiceFeature
      })
    );

    const matches = d.pendingFeatureChoices.filter((p) => p.featureSlug === 'test-shared-feature');
    expect(matches).toHaveLength(1);
  });
});
