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

  it('applies a skill proficiency choice', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'skill-tinker',
      version: 1,
      name: 'Skill Tinker',
      source: 'homebrew',
      data: { choices: { skillProficiency: { allowedSkills: ['arcana', 'history'] } } }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug, choices: { skillProficiency: { skill: 'arcana' } } }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    expect(d.stats.skills.arcana?.proficient).toBe(true);
  });

  it('drops a skill proficiency pick outside the allow-list', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'skill-tinker',
      version: 1,
      name: 'Skill Tinker',
      source: 'homebrew',
      data: { choices: { skillProficiency: { allowedSkills: ['arcana'] } } }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug, choices: { skillProficiency: { skill: 'history' } } }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    expect(d.stats.skills.history?.proficient).toBeFalsy();
  });

  it('applies a saving-throw proficiency choice', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'resilient-pick',
      version: 1,
      name: 'Resilient',
      source: 'homebrew',
      data: { choices: { savingThrow: { allowedAbilities: ['wis'] } } }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug, choices: { savingThrow: { ability: 'wis' } } }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    expect(d.stats.saves.wis.proficient).toBe(true);
  });

  it('applies an ASI pick from the default ability set when allowedAbilities is omitted', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'open-asi',
      version: 1,
      name: 'Open ASI',
      source: 'homebrew',
      data: { choices: { asi: { bonus: 1 } } }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug, choices: { asi: { ability: 'dex' } } }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    // Baseline DEX 13; +1 from ASI pick.
    expect(d.stats.abilities.dex.score).toBe(14);
  });

  it('drops an ASI pick outside the default ability set', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'open-asi',
      version: 1,
      name: 'Open ASI',
      source: 'homebrew',
      data: { choices: { asi: { bonus: 1 } } }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      // 'gibberish' is not in the default ability set — should not apply.
      feats: [{ kind: 'feat', slug: homebrew.slug, choices: { asi: { ability: 'gibberish' } } }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    expect(d.stats.abilities.cha.score).toBe(10);
    expect(d.stats.abilities.str.score).toBe(17);
  });

  // -------------------------------------------------------------------------
  // asiBudget feats (Ability Score Improvement pattern)
  // -------------------------------------------------------------------------

  it('ASI feat: applies +2 to one ability (single asis entry)', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'ability-score-improvement',
      version: 1,
      name: 'Ability Score Improvement',
      source: 'srd-5.2',
      data: {
        abilityChoices: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
        asiBudget: 2
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug, choices: { asis: [{ ability: 'str', bonus: 2 }] } }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    // Baseline STR 17 + 2 → 19.
    expect(d.stats.abilities.str.score).toBe(19);
  });

  it('ASI feat: applies +1/+1 split across two abilities', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'ability-score-improvement',
      version: 1,
      name: 'Ability Score Improvement',
      source: 'srd-5.2',
      data: {
        abilityChoices: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
        asiBudget: 2
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [
        {
          kind: 'feat',
          slug: homebrew.slug,
          choices: { asis: [{ ability: 'str', bonus: 1 }, { ability: 'dex', bonus: 1 }] }
        }
      ]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    // Baseline STR 17 → 18, DEX 13 → 14.
    expect(d.stats.abilities.str.score).toBe(18);
    expect(d.stats.abilities.dex.score).toBe(14);
  });

  it('ASI feat: budget exceeded — second entry that pushes over is dropped', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'ability-score-improvement',
      version: 1,
      name: 'Ability Score Improvement',
      source: 'srd-5.2',
      data: {
        abilityChoices: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
        asiBudget: 2
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [
        {
          kind: 'feat',
          slug: homebrew.slug,
          choices: { asis: [{ ability: 'str', bonus: 2 }, { ability: 'dex', bonus: 1 }] }
        }
      ]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    // First entry uses the full budget; second is dropped.
    expect(d.stats.abilities.str.score).toBe(19);
    expect(d.stats.abilities.dex.score).toBe(13); // unchanged
  });

  it('ASI feat: ability outside allowedAbilities is dropped', () => {
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'ability-score-improvement',
      version: 1,
      name: 'Ability Score Improvement',
      source: 'srd-5.2',
      data: {
        abilityChoices: ['str', 'dex'],
        asiBudget: 2
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug, choices: { asis: [{ ability: 'cha', bonus: 2 }] } }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    // 'cha' not in allowedAbilities → no bump.
    expect(d.stats.abilities.cha.score).toBe(10); // baseline
    expect(d.stats.abilities.str.score).toBe(17); // unchanged
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

  it('sense.darkvision ADD stacks on an existing species darkvision (60 → 120)', () => {
    // Locks the engine contract grimoire-packs phb-2024 Gloom Stalker
    // (umbral-sight) and Shadow Monk (warrior-of-shadow darkvision)
    // depend on. Both rows say "Darkvision 60. If you already have
    // Darkvision, its range increases by 60 ft." — the right mode is
    // ADD (not MAX, which modes.ts drops; not UPGRADE, which takes
    // max instead of stacking). Half-Orc base darkvision is 60 from
    // the extras fixture; the homebrew ADD 60 must lift it to 120.
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'shadow-blooded',
      version: 1,
      name: 'Shadow-Blooded (test)',
      source: 'test',
      data: {
        modifiers: [
          { kind: 'stat-modifier', target: 'sense.darkvision', mode: 'ADD', value: 60 }
        ]
      }
    };
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    expect(d.stats.senses.darkvision).toBe(120);
  });

  it('applies an object-valued ac.formula OVERRIDE from a feat (Dragon Hide shape)', () => {
    // Regression (engine batch 6 §1): the feat-row schema rejected
    // object-valued stat-modifier values, so XGtE Dragon Hide's
    // "AC 13 + DEX while unarmored" had nowhere to live. derive() has
    // always read `ac.formula` as an object — this locks the pair.
    const homebrew: ContentRow = {
      kind: 'feat',
      slug: 'dragon-hide-test',
      version: 1,
      name: 'Dragon Hide (test)',
      source: 'test',
      data: {
        modifiers: [
          {
            kind: 'stat-modifier',
            target: 'ac.formula',
            mode: 'OVERRIDE',
            // Barbarian Unarmored Defense authors its own ac.formula
            // OVERRIDE; an explicit priority makes which one lands
            // deterministic rather than insertion-order-dependent.
            priority: 100,
            value: { base: 13, ability: 'dex' }
          }
        ]
      }
    };
    // The fixture wears no armor, so computeAC takes the unarmored
    // branch that reads `ac.formula`.
    const character: CharacterDocument = {
      ...zealot.CHARACTER,
      feats: [{ kind: 'feat', slug: homebrew.slug }]
    };
    const d = derive(character, lookupWithHomebrew(homebrew));
    // 13 + DEX mod (13 → +1) = 14.
    expect(d.stats.ac).toBe(14);
  });
});
