// Pin the canonical pack shapes that exercise the multi-pick engine
// slots (grimoire commit e07a225) — Mastermind's 2-language pick,
// College of Lore's 3-skill pick, Kenku's 2-skill open pick.
// Synthetic rows constructed inline so the test is hermetic.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function lookupFor(extras: Record<string, ContentRow>) {
  return (ref: { kind: string; slug: string; version?: number }) => {
    const extra = extras[`${ref.kind}/${ref.slug}`];
    if (extra) return extra;
    return chronurgy.makeLookup(PACKS)(ref);
  };
}

// xanathars/features/mastermind.json → master-of-intrigue.
// Three plural-shape slots in one row: tool fixed grants + 1-gaming-set
// pick + 2-language pick.
const MASTERMIND_ROW: ContentRow = {
  kind: 'feature',
  slug: 'test-master-of-intrigue',
  version: 1,
  source: 'test',
  name: 'Master of Intrigue',
  data: {
    ownerKind: 'feat',
    ownerSlug: 'test-moi-holder',
    minLevel: 1,
    modifiers: [
      { kind: 'stat-modifier', target: 'proficiency.tool.disguise-kit', mode: 'OVERRIDE', value: true },
      { kind: 'stat-modifier', target: 'proficiency.tool.forgery-kit', mode: 'OVERRIDE', value: true }
    ],
    choices: {
      toolProficiencies: {
        allowedTools: ['dice-set', 'playing-card-set', 'dragonchess-set', 'three-dragon-ante-set'],
        picks: 1
      },
      languages: { picks: 2 }
    }
  }
};

const MOI_HOLDER: ContentRow = {
  kind: 'feat',
  slug: 'test-moi-holder',
  version: 1,
  source: 'test',
  name: 'MoI Holder',
  data: { features: ['test-master-of-intrigue'] }
};

describe('pack contract: Mastermind master-of-intrigue (xanathars) — tool + language plural', () => {
  function withMoIPicks(picks: Record<string, unknown>): CharacterDocument {
    return {
      ...chronurgy.CHARACTER,
      feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug: 'test-moi-holder', version: 1 }],
      featureChoices: {
        ...(chronurgy.CHARACTER.featureChoices ?? {}),
        'test-master-of-intrigue': picks
      }
    };
  }

  it('grants disguise + forgery kit unconditionally (fixed modifiers)', () => {
    const lookup = lookupFor({
      'feat/test-moi-holder': MOI_HOLDER,
      'feature/test-master-of-intrigue': MASTERMIND_ROW
    });
    const d = derive(withMoIPicks({}), lookup);
    expect(d.stats.tools).toContain('disguise-kit');
    expect(d.stats.tools).toContain('forgery-kit');
  });

  it('synthesizes the picked gaming-set tool proficiency', () => {
    const lookup = lookupFor({
      'feat/test-moi-holder': MOI_HOLDER,
      'feature/test-master-of-intrigue': MASTERMIND_ROW
    });
    const d = derive(
      withMoIPicks({ toolProficiencies: [{ tool: 'dragonchess-set' }] }),
      lookup
    );
    expect(d.stats.tools).toContain('dragonchess-set');
    // Other gaming sets in the allow-list must NOT be granted
    expect(d.stats.tools).not.toContain('dice-set');
  });

  it('synthesizes the two picked languages (no allow-list = any)', () => {
    const lookup = lookupFor({
      'feat/test-moi-holder': MOI_HOLDER,
      'feature/test-master-of-intrigue': MASTERMIND_ROW
    });
    const d = derive(
      withMoIPicks({
        languages: [{ language: 'draconic' }, { language: 'celestial' }]
      }),
      lookup
    );
    expect(d.stats.languages).toContain('draconic');
    expect(d.stats.languages).toContain('celestial');
  });
});

// phb-2014/features/college-of-lore.json → bonus-proficiencies.
// Open 3-skill pick (no allow-list = any skill).
const COLLEGE_OF_LORE_ROW: ContentRow = {
  kind: 'feature',
  slug: 'test-bonus-proficiencies',
  version: 1,
  source: 'test',
  name: 'Bonus Proficiencies',
  data: {
    ownerKind: 'feat',
    ownerSlug: 'test-lore-holder',
    minLevel: 1,
    choices: { skillProficiencies: { picks: 3 } }
  }
};

const LORE_HOLDER: ContentRow = {
  kind: 'feat',
  slug: 'test-lore-holder',
  version: 1,
  source: 'test',
  name: 'Lore Holder',
  data: { features: ['test-bonus-proficiencies'] }
};

describe('pack contract: College of Lore bonus-proficiencies — open 3-skill pick', () => {
  it('synthesizes proficiency for each of the three picked skills', () => {
    const lookup = lookupFor({
      'feat/test-lore-holder': LORE_HOLDER,
      'feature/test-bonus-proficiencies': COLLEGE_OF_LORE_ROW
    });
    const char: CharacterDocument = {
      ...chronurgy.CHARACTER,
      feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug: 'test-lore-holder', version: 1 }],
      featureChoices: {
        ...(chronurgy.CHARACTER.featureChoices ?? {}),
        'test-bonus-proficiencies': {
          skillProficiencies: [
            { skill: 'arcana' },
            { skill: 'history' },
            { skill: 'investigation' }
          ]
        }
      }
    };
    const d = derive(char, lookup);
    expect(d.stats.skills.arcana?.proficient).toBe(true);
    expect(d.stats.skills.history?.proficient).toBe(true);
    expect(d.stats.skills.investigation?.proficient).toBe(true);
  });

  it('surfaces the row on pendingFeatureChoices when no picks recorded', () => {
    const lookup = lookupFor({
      'feat/test-lore-holder': LORE_HOLDER,
      'feature/test-bonus-proficiencies': COLLEGE_OF_LORE_ROW
    });
    const char: CharacterDocument = {
      ...chronurgy.CHARACTER,
      feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug: 'test-lore-holder', version: 1 }]
    };
    const d = derive(char, lookup);
    const pending = d.pendingFeatureChoices.find(
      (p) => p.featureSlug === 'test-bonus-proficiencies'
    );
    expect(pending).toBeDefined();
    expect(pending!.unresolved).toBe(true);
    expect(pending!.declarations.skillProficiencies).toEqual({ picks: 3 });
  });
});
