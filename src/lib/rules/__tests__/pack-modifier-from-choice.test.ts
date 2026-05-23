// Pin the canonical pack shapes that exercise the modifierFromChoice
// engine slot (grimoire commit 05077e1) — Aspect of the Wilds in
// phb-2024 + Transmuter's Stone in phb-2014. Synthetic rows constructed
// inline so the test is hermetic against pack reshuffles. If the engine
// reshapes modifierFromChoice, both this test AND the real pack rows
// need to update together.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

// phb-2024/features/path-of-the-wild-heart.json → aspect-of-the-wilds.
// Synthetic copy of the pack row's choices.modifierFromChoice block;
// drift here = pack drift the engine would silently regress on.
const ASPECT_OF_THE_WILDS_ROW: ContentRow = {
  kind: 'feature',
  slug: 'test-aspect-of-the-wilds',
  version: 1,
  source: 'test',
  name: 'Aspect of the Wilds',
  data: {
    ownerKind: 'feat',
    ownerSlug: 'test-aotw-holder',
    minLevel: 1,
    choices: {
      modifierFromChoice: {
        label: 'Aspect of the Wilds',
        options: [
          {
            id: 'owl',
            label: 'Owl (Darkvision 60 ft)',
            modifiers: [
              { kind: 'stat-modifier', target: 'sense.darkvision', mode: 'UPGRADE', value: 60 }
            ]
          },
          {
            id: 'panther',
            label: 'Panther (Climb = Speed)',
            modifiers: [
              { kind: 'stat-modifier', target: 'speed.climb', mode: 'UPGRADE', value: 'walkSpeed' }
            ]
          },
          {
            id: 'salmon',
            label: 'Salmon (Swim = Speed)',
            modifiers: [
              { kind: 'stat-modifier', target: 'speed.swim', mode: 'UPGRADE', value: 'walkSpeed' }
            ]
          }
        ]
      }
    }
  }
};

const HOLDER_FEAT: ContentRow = {
  kind: 'feat',
  slug: 'test-aotw-holder',
  version: 1,
  source: 'test',
  name: 'Holder',
  data: { features: ['test-aspect-of-the-wilds'] }
};

function lookupFor(extras: Record<string, ContentRow>) {
  // Defer base-lookup construction to call time so PACKS is populated by
  // beforeAll before the lookup function is first invoked.
  return (ref: { kind: string; slug: string; version?: number }) => {
    const extra = extras[`${ref.kind}/${ref.slug}`];
    if (extra) return extra;
    return chronurgy.makeLookup(PACKS)(ref);
  };
}

function withFeatAndPick(picks: Record<string, unknown>): CharacterDocument {
  return {
    ...chronurgy.CHARACTER,
    feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug: 'test-aotw-holder', version: 1 }],
    featureChoices: {
      ...(chronurgy.CHARACTER.featureChoices ?? {}),
      'test-aspect-of-the-wilds': picks
    }
  };
}

describe('pack contract: Aspect of the Wilds (phb-2024) — modifierFromChoice shape', () => {
  const lookup = lookupFor({
    'feat/test-aotw-holder': HOLDER_FEAT,
    'feature/test-aspect-of-the-wilds': ASPECT_OF_THE_WILDS_ROW
  });

  // chronurgy fixture is a Tortle so baseline carries swim from species.
  // Assert what the pick *adds* by comparing against the no-pick baseline.
  let baseline: ReturnType<typeof derive>;
  beforeAll(() => {
    baseline = derive(withFeatAndPick({}), lookup);
  });

  it('owl pick grants darkvision 60 ft', () => {
    const char = withFeatAndPick({ modifierFromChoice: { option: 'owl' } });
    const d = derive(char, lookup);
    expect(d.stats.senses.darkvision).toBe(60);
    // Owl doesn't touch climb/swim
    expect(d.stats.speeds.climb).toBe(baseline.stats.speeds.climb);
    expect(d.stats.speeds.swim).toBe(baseline.stats.speeds.swim);
  });

  it('panther pick grants climb = walk speed', () => {
    const char = withFeatAndPick({ modifierFromChoice: { option: 'panther' } });
    const d = derive(char, lookup);
    expect(d.stats.speeds.climb).toBe(d.stats.speeds.walk);
    // Panther doesn't touch darkvision/swim relative to baseline
    expect(d.stats.senses.darkvision).toBe(baseline.stats.senses.darkvision);
    expect(d.stats.speeds.swim).toBe(baseline.stats.speeds.swim);
  });

  it('salmon pick grants swim = walk speed', () => {
    const char = withFeatAndPick({ modifierFromChoice: { option: 'salmon' } });
    const d = derive(char, lookup);
    expect(d.stats.speeds.swim).toBe(d.stats.speeds.walk);
    expect(d.stats.senses.darkvision).toBe(baseline.stats.senses.darkvision);
    expect(d.stats.speeds.climb).toBe(baseline.stats.speeds.climb);
  });

  it('surfaces the pending choice on Derived.pendingFeatureChoices', () => {
    const char = withFeatAndPick({});
    const d = derive(char, lookup);
    const pending = d.pendingFeatureChoices.find(
      (p) => p.featureSlug === 'test-aspect-of-the-wilds'
    );
    expect(pending).toBeDefined();
    expect(pending!.unresolved).toBe(true);
    expect(pending!.declarations.modifierFromChoice).toBeDefined();
  });
});

// phb-2014/features/school-of-transmutation.json → transmuter-s-stone.
// Verifies the 8-option flattened-resistance shape (the four base
// options + five sibling resistance-X variants for the nested damage-type
// pick the modifierFromChoice slot doesn't support natively).
const TRANSMUTERS_STONE_ROW: ContentRow = {
  kind: 'feature',
  slug: 'test-transmuter-s-stone',
  version: 1,
  source: 'test',
  name: "Transmuter's Stone",
  data: {
    ownerKind: 'feat',
    ownerSlug: 'test-ts-holder',
    minLevel: 1,
    choices: {
      modifierFromChoice: {
        label: "Transmuter's Stone benefit",
        options: [
          {
            id: 'darkvision',
            label: 'Darkvision 60 ft',
            modifiers: [{ kind: 'stat-modifier', target: 'sense.darkvision', mode: 'UPGRADE', value: 60 }]
          },
          {
            id: 'speed',
            label: '+10 ft speed',
            modifiers: [{ kind: 'stat-modifier', target: 'speed.walk', mode: 'ADD', value: 10 }]
          },
          {
            id: 'con-save-prof',
            label: 'Proficiency in CON saves',
            modifiers: [{ kind: 'stat-modifier', target: 'proficiency.save.con', mode: 'OVERRIDE', value: true }]
          },
          {
            id: 'resistance-fire',
            label: 'Resistance: fire',
            modifiers: [{ kind: 'stat-modifier', target: 'resistance.fire', mode: 'OVERRIDE', value: true }]
          }
        ]
      }
    }
  }
};

const TS_HOLDER_FEAT: ContentRow = {
  kind: 'feat',
  slug: 'test-ts-holder',
  version: 1,
  source: 'test',
  name: 'TS Holder',
  data: { features: ['test-transmuter-s-stone'] }
};

describe("pack contract: Transmuter's Stone (phb-2014) — 8-option flattened-resistance shape", () => {
  const lookup = lookupFor({
    'feat/test-ts-holder': TS_HOLDER_FEAT,
    'feature/test-transmuter-s-stone': TRANSMUTERS_STONE_ROW
  });

  function withTSPick(picks: Record<string, unknown>): CharacterDocument {
    return {
      ...chronurgy.CHARACTER,
      feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug: 'test-ts-holder', version: 1 }],
      featureChoices: {
        ...(chronurgy.CHARACTER.featureChoices ?? {}),
        'test-transmuter-s-stone': picks
      }
    };
  }

  it('speed pick bumps walk by +10', () => {
    const baseSpeed = derive(chronurgy.CHARACTER, chronurgy.makeLookup(PACKS)).stats.speeds.walk;
    const char = withTSPick({ modifierFromChoice: { option: 'speed' } });
    const d = derive(char, lookup);
    expect(d.stats.speeds.walk).toBe(baseSpeed + 10);
  });

  it('con-save-prof pick flips proficiency.save.con on', () => {
    const char = withTSPick({ modifierFromChoice: { option: 'con-save-prof' } });
    const d = derive(char, lookup);
    expect(d.stats.saves.con.proficient).toBe(true);
  });

  it('resistance-fire pick adds fire to resistances', () => {
    const char = withTSPick({ modifierFromChoice: { option: 'resistance-fire' } });
    const d = derive(char, lookup);
    expect(d.stats.resistances).toContain('fire');
  });
});
