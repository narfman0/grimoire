// Pack-side polymorph declarations — `type: 'polymorph'` activities.
//
// `polymorphForm` is character state, so before this a spell row had no
// way to say "this transforms the target into a form of CR <= X". The
// declaration carries the constraint plus the two rules that differ per
// spell (where the form's HP pool comes from, which ability scores back
// its saves — exactly what PolymorphFormState records), and derive()
// checks a recorded form against it (`polymorph-form-over-budget`).

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const TEST_CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-druid',
  version: 1,
  source: 'test',
  name: 'Test Druid',
  data: { hitDie: 8, primaryAbility: 'wis', savingThrows: ['int', 'wis'] }
};

const TEST_SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

const BROWN_BEAR: ContentRow = {
  kind: 'monster',
  slug: 'brown-bear',
  version: 1,
  source: 'test',
  name: 'Brown Bear',
  data: {
    size: 'large',
    type: 'beast',
    cr: 1,
    ac: 11,
    hp: { max: 34 },
    speed: { walk: 40 },
    abilityScores: { str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7 }
  }
};

const ANCIENT_WYRM: ContentRow = {
  kind: 'monster',
  slug: 'ancient-wyrm',
  version: 1,
  source: 'test',
  name: 'Ancient Wyrm',
  data: {
    size: 'gargantuan',
    type: 'dragon',
    cr: 20,
    ac: 22,
    hp: { max: 400 },
    speed: { walk: 40, fly: 80 },
    abilityScores: { str: 30, dex: 10, con: 29, int: 18, wis: 15, cha: 23 }
  }
};

function polymorphSpell(form: Record<string, unknown>, slug = 'polymorph'): ContentRow {
  return {
    kind: 'spell',
    slug,
    version: 1,
    source: 'test',
    name: 'Polymorph',
    data: {
      level: 4,
      school: 'transmutation',
      activities: [
        { id: 'cast', name: 'Polymorph', type: 'polymorph', cost: 'action', form }
      ]
    }
  };
}

function makeLookup(rows: ContentRow[]): ContentLookup {
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function character(overrides: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    id: 'test-polymorph-decl',
    name: 'Test Druid',
    classes: [{ slug: 'test-druid', level: 9, hpRolledPerLevel: [8, 5, 5, 5, 5, 5, 5, 5, 5] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 14, con: 14, int: 10, wis: 18, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: {
      known: [{ kind: 'spell', slug: 'polymorph' }],
      prepared: ['polymorph']
    },
    currentHp: 50,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...overrides
  };
}

function castAction(rows: ContentRow[], char = character()) {
  const d = derive(char, makeLookup([TEST_CLASS, TEST_SPECIES, ...rows]));
  return { d, action: d.actions.find((a) => a.id.endsWith('/cast'))! };
}

describe('polymorph activity declarations', () => {
  it('realizes the form constraint onto Action.polymorph', () => {
    const { d, action } = castAction([
      polymorphSpell({
        target: 'creature',
        crMax: 6,
        creatureTypes: ['beast'],
        sizeMax: 'large',
        count: 1,
        hpSource: 'form',
        saveSource: 'form',
        duration: { value: 1, units: 'hour' },
        note: 'The form can have no flying speed.'
      }),
      BROWN_BEAR
    ]);
    expect(action.polymorph).toEqual({
      target: 'creature',
      hpSource: 'form',
      saveSource: 'form',
      crMax: 6,
      count: 1,
      creatureTypes: ['beast'],
      sizeMax: 'large',
      duration: { value: 1, units: 'hour' },
      note: 'The form can have no flying speed.'
    });
    // 'polymorph' is a known activity type — no typo warning.
    expect(d.validations.some((v) => v.code === 'unknown-activity-type')).toBe(false);
  });

  it('defaults to self / form HP / form saves and evaluates crMax tokens', () => {
    const { action } = castAction([
      polymorphSpell({ crMax: 'floor(druidLevel/3)', creatureType: 'beast' }),
      BROWN_BEAR
    ]);
    expect(action.polymorph!.target).toBe('self');
    expect(action.polymorph!.hpSource).toBe('form');
    expect(action.polymorph!.saveSource).toBe('form');
    expect(action.polymorph!.creatureTypes).toEqual(['beast']);
    // druidLevel isn't a class here (test-druid is), so the token
    // resolves to 0 — still a number, never the raw string.
    expect(typeof action.polymorph!.crMax).toBe('number');
  });

  it("carries Shapechange's base-HP / base-save reading", () => {
    const { action } = castAction([
      polymorphSpell({ target: 'self', crMax: 9, hpSource: 'base', saveSource: 'base' }),
      BROWN_BEAR
    ]);
    expect(action.polymorph!.hpSource).toBe('base');
    expect(action.polymorph!.saveSource).toBe('base');
  });

  it('emits no polymorph payload when the form block is absent or malformed', () => {
    const spell: ContentRow = {
      kind: 'spell',
      slug: 'polymorph',
      version: 1,
      source: 'test',
      name: 'Polymorph',
      data: {
        level: 4,
        activities: [{ id: 'cast', name: 'Polymorph', type: 'polymorph', cost: 'action' }]
      }
    };
    const { action } = castAction([spell]);
    expect(action.polymorph).toBeUndefined();
  });
});

describe('polymorph-form-over-budget validation', () => {
  const SPELL = polymorphSpell({
    target: 'creature',
    crMax: 6,
    creatureTypes: ['beast'],
    sizeMax: 'large'
  });

  const inForm = (slug: string): Partial<CharacterDocument> => ({
    polymorphForm: {
      slug,
      sourceContent: { kind: 'spell', slug: 'polymorph' },
      currentHp: 34,
      maxHp: 34
    }
  });

  it('stays silent when the recorded form satisfies the declaration', () => {
    const { d } = castAction([SPELL, BROWN_BEAR], character(inForm('brown-bear')));
    expect(d.validations.some((v) => v.code === 'polymorph-form-over-budget')).toBe(false);
    expect(d.activeForm!.statblock.maxHp).toBe(34);
  });

  it('warns on CR, creature type and size violations at once', () => {
    const { d } = castAction([SPELL, ANCIENT_WYRM], character(inForm('ancient-wyrm')));
    const w = d.validations.filter((v) => v.code === 'polymorph-form-over-budget');
    expect(w.length).toBe(1);
    expect(w[0].severity).toBe('warning');
    expect(w[0].message).toContain('CR 20');
    expect(w[0].message).toContain("type 'dragon'");
    expect(w[0].message).toContain("size 'gargantuan'");
    // The QC gate greps unknown-* codes only — this must never match.
    expect(w[0].code.startsWith('unknown-')).toBe(false);
    // The form still resolves; the warning is advisory.
    expect(d.activeForm).toBeDefined();
  });

  it('stays silent when the form came from a different source row', () => {
    const { d } = castAction(
      [SPELL, ANCIENT_WYRM],
      character({
        polymorphForm: {
          slug: 'ancient-wyrm',
          sourceContent: { kind: 'feature', slug: 'wild-shape' },
          currentHp: 400,
          maxHp: 400
        }
      })
    );
    expect(d.validations.some((v) => v.code === 'polymorph-form-over-budget')).toBe(false);
  });

  it('stays silent when the declaration names no constraint', () => {
    const { d } = castAction(
      [polymorphSpell({ target: 'creature' }), ANCIENT_WYRM],
      character(inForm('ancient-wyrm'))
    );
    expect(d.validations.some((v) => v.code === 'polymorph-form-over-budget')).toBe(false);
  });

  it('stays silent when the monster row does not resolve', () => {
    const { d } = castAction([SPELL], character(inForm('some-other-pack-monster')));
    expect(d.validations.some((v) => v.code === 'polymorph-form-over-budget')).toBe(false);
  });
});
