// Engine-side polymorph + companion primitive (Phase 5 engine-only).
//
// Covers:
//   - derive() walks `character.polymorphForm` → `Derived.activeForm`.
//   - derive() walks `character.companions` → `Derived.companions[]`,
//     filtered to status='summoned'.
//   - Modifiers carrying `persistsInForm: true` on active rows flow
//     into `Derived.activeForm.persistentModifiers`; without the flag
//     they're omitted.
//   - `applyFormDamage` cascades damage temp → overlay → form → base.
//
// Schema / API / UI follow-ons (Phase 5a, 5b, 5c) are scoped
// separately — this file exercises only the derive + hp primitives.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import { applyFormDamage } from '../hp';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

// --- shared fixtures -------------------------------------------------

const TEST_CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-druid',
  version: 1,
  source: 'test',
  name: 'Test Druid',
  data: {
    hitDie: 8,
    primaryAbility: 'wis',
    savingThrows: ['int', 'wis'],
    // Reference the persisting-feature row so it gets pulled into
    // `active` content. Without this, the feature's modifiers never
    // fire — features ride into derive() through a class/subclass/
    // species row's `features` list.
    features: ['circle-of-the-moon-bump']
  }
};

const TEST_SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

// A small brown-bear-shaped monster row. Self-contained so the test
// doesn't depend on the SRD packs being indexed by the test harness.
const BROWN_BEAR: ContentRow = {
  kind: 'monster',
  slug: 'brown-bear',
  version: 1,
  source: 'test',
  name: 'Brown Bear',
  data: {
    size: 'Large',
    type: 'beast',
    cr: 1,
    xp: 200,
    ac: 11,
    hp: { max: 34, hitDice: '4d10+12' },
    speed: { walk: 40, climb: 30 },
    abilityScores: { str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7 },
    skills: { perception: 3 },
    senses: { passivePerception: 13 },
    actions: [
      {
        name: 'Multiattack',
        description: 'The bear makes two attacks: one with its bite and one with its claws.'
      },
      { name: 'Bite', attackBonus: 5, reach: 5, damage: [{ dice: '1d8+4', type: 'piercing' }] },
      { name: 'Claws', attackBonus: 5, reach: 5, damage: [{ dice: '2d6+4', type: 'slashing' }] }
    ]
  }
};

const WOLF: ContentRow = {
  kind: 'monster',
  slug: 'wolf',
  version: 1,
  source: 'test',
  name: 'Wolf',
  data: {
    size: 'Medium',
    type: 'beast',
    cr: '1/4',
    ac: 13,
    hp: { max: 11, hitDice: '2d8+2' },
    speed: { walk: 40 },
    abilityScores: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    actions: [{ name: 'Bite', attackBonus: 4, reach: 5, damage: [{ dice: '2d4+2', type: 'piercing' }] }]
  }
};

// A feature whose modifier ALSO persists in form (the design doc's
// `persistsInForm: true` marker). Druid Circle of the Moon's combat-form
// HP bump is the canonical inspiration; we use a small synthetic
// modifier here so the test asserts the marker plumbing without
// depending on a real Circle-of-the-Moon row.
const PERSISTING_FEATURE: ContentRow = {
  kind: 'feature',
  slug: 'circle-of-the-moon-bump',
  version: 1,
  source: 'test',
  name: 'Circle of the Moon Bump',
  data: {
    ownerKind: 'class',
    ownerSlug: 'test-druid',
    minLevel: 1,
    modifiers: [
      {
        kind: 'stat-modifier',
        target: 'ac',
        mode: 'ADD',
        value: 1,
        persistsInForm: true
      },
      {
        // No persistsInForm flag — should NOT show up on activeForm.
        kind: 'stat-modifier',
        target: 'ac',
        mode: 'ADD',
        value: 1
      }
    ]
  }
};

function makeLookup(rows: ContentRow[]): ContentLookup {
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function baseCharacter(overrides: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    id: 'test-polymorph',
    name: 'Test Druid',
    classes: [{ slug: 'test-druid', level: 5, hpRolledPerLevel: [8, 5, 5, 5, 5] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 10, dex: 14, con: 14, int: 10, wis: 18, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 30,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    ...overrides
  };
}

// --- derive(): polymorph form ---------------------------------------

describe('derive() polymorph form', () => {
  it('emits no activeForm when polymorphForm is null/absent', () => {
    const noForm = derive(baseCharacter(), makeLookup([TEST_CLASS, TEST_SPECIES, BROWN_BEAR]));
    expect(noForm.activeForm).toBeUndefined();

    const nullForm = derive(
      baseCharacter({ polymorphForm: null }),
      makeLookup([TEST_CLASS, TEST_SPECIES, BROWN_BEAR])
    );
    expect(nullForm.activeForm).toBeUndefined();
  });

  it('emits activeForm with the form statblock when polymorphForm is set', () => {
    const d = derive(
      baseCharacter({
        polymorphForm: {
          slug: 'brown-bear',
          sourceContent: { kind: 'spell', slug: 'polymorph' },
          currentHp: 34,
          maxHp: 34
        }
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES, BROWN_BEAR])
    );
    expect(d.activeForm).toBeDefined();
    expect(d.activeForm!.sourceContent).toEqual({ kind: 'spell', slug: 'polymorph' });
    expect(d.activeForm!.statblock.ac).toBe(11);
    expect(d.activeForm!.statblock.maxHp).toBe(34);
    expect(d.activeForm!.statblock.abilityScores.str).toBe(19);
    expect(d.activeForm!.statblock.speeds.walk).toBe(40);
    expect(d.activeForm!.statblock.actions.map((a) => a.name)).toContain('Bite');
    expect(d.activeForm!.currentHp).toBe(34);
    expect(d.activeForm!.maxHp).toBe(34);
    // Default formSaveSource is 'form' (Polymorph spell semantics).
    expect(d.activeForm!.formSaveSource).toBe('form');
    expect(d.activeForm!.roundsRemaining).toBe(null);
  });

  it("honors stored currentHp on the form (form HP independent of PC's currentHp)", () => {
    const d = derive(
      baseCharacter({
        currentHp: 30,
        polymorphForm: {
          slug: 'brown-bear',
          sourceContent: { kind: 'feature', slug: 'wild-shape' },
          currentHp: 12, // form already took 22 damage
          maxHp: 34
        }
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES, BROWN_BEAR])
    );
    expect(d.activeForm!.currentHp).toBe(12);
    expect(d.activeForm!.maxHp).toBe(34);
    // Base PC HP undisturbed.
    expect(d.stats.hp.current).toBe(30);
  });

  it("preserves Wild Shape's 'base' formSaveSource when explicitly set", () => {
    const d = derive(
      baseCharacter({
        polymorphForm: {
          slug: 'brown-bear',
          sourceContent: { kind: 'feature', slug: 'wild-shape' },
          currentHp: 34,
          maxHp: 34,
          formSaveSource: 'base'
        }
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES, BROWN_BEAR])
    );
    expect(d.activeForm!.formSaveSource).toBe('base');
  });

  it('emits a warning validation when the polymorph form slug is unknown', () => {
    const d = derive(
      baseCharacter({
        polymorphForm: {
          slug: 'ghost-of-baluchitherium',
          sourceContent: { kind: 'spell', slug: 'polymorph' },
          currentHp: 5,
          maxHp: 5
        }
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES])
    );
    expect(d.activeForm).toBeUndefined();
    expect(d.validations.some((v) => v.code === 'polymorph-form-missing-content')).toBe(true);
  });
});

// --- derive(): persistsInForm marker --------------------------------

describe('derive() persistsInForm modifier marker', () => {
  it('flows modifiers tagged persistsInForm:true into activeForm.persistentModifiers', () => {
    const d = derive(
      baseCharacter({
        polymorphForm: {
          slug: 'brown-bear',
          sourceContent: { kind: 'spell', slug: 'polymorph' },
          currentHp: 34,
          maxHp: 34
        }
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES, BROWN_BEAR, PERSISTING_FEATURE])
    );
    expect(d.activeForm).toBeDefined();
    expect(d.activeForm!.persistentModifiers).toHaveLength(1);
    expect(d.activeForm!.persistentModifiers[0]).toMatchObject({
      kind: 'stat-modifier',
      target: 'ac',
      persistsInForm: true
    });
  });

  it('omits modifiers without persistsInForm from activeForm.persistentModifiers', () => {
    const d = derive(
      baseCharacter({
        polymorphForm: {
          slug: 'brown-bear',
          sourceContent: { kind: 'spell', slug: 'polymorph' },
          currentHp: 34,
          maxHp: 34
        }
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES, BROWN_BEAR, PERSISTING_FEATURE])
    );
    // The PERSISTING_FEATURE row carries two modifiers; only the
    // flagged one shows up in persistentModifiers. Sanity: the
    // unflagged one does not.
    const unflagged = d.activeForm!.persistentModifiers.find(
      (m) => m.persistsInForm !== true
    );
    expect(unflagged).toBeUndefined();
  });

  it('persistsInForm modifiers ALSO apply to the base PC stats (not form-only)', () => {
    // Per the design doc: these are PC modifiers that *also* persist
    // in form. The base PC's AC should reflect both AC bumps from
    // PERSISTING_FEATURE regardless of polymorph status.
    const baseline = derive(
      baseCharacter(),
      makeLookup([TEST_CLASS, TEST_SPECIES])
    );
    const withFeat = derive(
      baseCharacter(),
      makeLookup([TEST_CLASS, TEST_SPECIES, PERSISTING_FEATURE])
    );
    expect(withFeat.stats.ac).toBe(baseline.stats.ac + 2);
  });
});

// --- derive(): appliesToForm (form-scoped modifiers) -----------------

// The inverse of persistsInForm: modifiers that apply ONLY to the form's
// statblock. Circle of the Moon's in-form AC floor, Primal Strike's
// "beast-form attacks count as magical", Improved Circle Forms'
// WIS-mod-to-CON-saves-while-in-form. Authoring these unflagged would
// leak them onto the base sheet.
const FORM_SCOPED_FEATURE: ContentRow = {
  kind: 'feature',
  slug: 'combat-wild-shape-riders',
  version: 1,
  source: 'test',
  name: 'Combat Wild Shape Riders',
  data: {
    ownerKind: 'class',
    ownerSlug: 'test-druid',
    minLevel: 1,
    modifiers: [
      // "While in form your AC is at least 13" — the bear's own 11 loses.
      { kind: 'stat-modifier', target: 'ac', mode: 'UPGRADE', value: 13, appliesToForm: true },
      // "Add your WIS modifier to the form's CON saves" (WIS 18 → +4).
      { kind: 'stat-modifier', target: 'save.con', mode: 'ADD', value: 'wisMod', appliesToForm: true },
      // Primal Strike, scoped to the form rather than corpus-wide.
      {
        kind: 'stat-modifier',
        target: 'trait.attacks-count-as-magical',
        value: true,
        appliesToForm: true
      },
      // A rider with no MonsterDerived slot — must still surface raw.
      {
        kind: 'stat-modifier',
        target: 'form-attack.damage-type',
        value: 'radiant',
        appliesToForm: true
      }
    ]
  }
};

/** The same class row, wired to the form-scoped feature instead. */
const FORM_SCOPED_CLASS: ContentRow = {
  ...TEST_CLASS,
  data: { ...TEST_CLASS.data, features: ['combat-wild-shape-riders'] }
};

const IN_BEAR = {
  slug: 'brown-bear',
  sourceContent: { kind: 'spell', slug: 'polymorph' },
  currentHp: 34,
  maxHp: 34
};

describe('derive() appliesToForm modifier marker', () => {
  it('never applies form-scoped modifiers to the base sheet', () => {
    const baseline = derive(baseCharacter(), makeLookup([TEST_CLASS, TEST_SPECIES]));
    const withRiders = derive(
      baseCharacter(),
      makeLookup([FORM_SCOPED_CLASS, TEST_SPECIES, FORM_SCOPED_FEATURE])
    );
    // AC UPGRADE 13, CON save +4 and the trait flag are all form-only.
    expect(withRiders.stats.ac).toBe(baseline.stats.ac);
    expect(withRiders.stats.saves.con.bonus).toBe(baseline.stats.saves.con.bonus);
    expect(withRiders.stats.traits).not.toContain('attacks-count-as-magical');
  });

  it('is inert in base form (no activeForm, no leak)', () => {
    const d = derive(
      baseCharacter(),
      makeLookup([FORM_SCOPED_CLASS, TEST_SPECIES, FORM_SCOPED_FEATURE, BROWN_BEAR])
    );
    expect(d.activeForm).toBeUndefined();
  });

  it('folds statblock-slotted targets into the form snapshot', () => {
    const d = derive(
      baseCharacter({ polymorphForm: IN_BEAR }),
      makeLookup([FORM_SCOPED_CLASS, TEST_SPECIES, FORM_SCOPED_FEATURE, BROWN_BEAR])
    );
    expect(d.activeForm).toBeDefined();
    // Bear AC 11 → UPGRADE floor of 13.
    expect(d.activeForm!.statblock.ac).toBe(13);
    // Bear CON mod +3, plus the druid's WIS mod +4 = +7.
    expect(d.activeForm!.statblock.saves.con).toBe(7);
    // trait.<slug> lands as a named trait on the form.
    expect(d.activeForm!.statblock.traits.map((t) => t.name)).toContain(
      'attacks-count-as-magical'
    );
    // The bear's own statblock is otherwise untouched.
    expect(d.activeForm!.statblock.maxHp).toBe(34);
    expect(d.activeForm!.statblock.speeds.walk).toBe(40);
  });

  it('surfaces every flagged modifier raw on activeForm.formModifiers', () => {
    const d = derive(
      baseCharacter({ polymorphForm: IN_BEAR }),
      makeLookup([FORM_SCOPED_CLASS, TEST_SPECIES, FORM_SCOPED_FEATURE, BROWN_BEAR])
    );
    expect(d.activeForm!.formModifiers).toHaveLength(4);
    // Riders with no MonsterDerived slot ride through verbatim for the
    // encounter runtime.
    expect(d.activeForm!.formModifiers).toContainEqual({
      kind: 'stat-modifier',
      target: 'form-attack.damage-type',
      value: 'radiant',
      appliesToForm: true
    });
  });

  it('leaves formModifiers empty when nothing is flagged', () => {
    const d = derive(
      baseCharacter({ polymorphForm: IN_BEAR }),
      makeLookup([TEST_CLASS, TEST_SPECIES, BROWN_BEAR, PERSISTING_FEATURE])
    );
    expect(d.activeForm!.formModifiers).toEqual([]);
    // …and persistsInForm keeps working alongside it.
    expect(d.activeForm!.persistentModifiers).toHaveLength(1);
  });

  it('does not mutate the cached monster row — derive is repeatable', () => {
    const look = makeLookup([FORM_SCOPED_CLASS, TEST_SPECIES, FORM_SCOPED_FEATURE, BROWN_BEAR]);
    const a = derive(baseCharacter({ polymorphForm: IN_BEAR }), look);
    const b = derive(baseCharacter({ polymorphForm: IN_BEAR }), look);
    expect(a.activeForm!.statblock.saves.con).toBe(7);
    expect(b.activeForm!.statblock.saves.con).toBe(7);
    expect(BROWN_BEAR.data.ac).toBe(11);
  });
});

// --- derive(): companions -------------------------------------------

describe('derive() companion walk', () => {
  it('emits no companions[] when character has no companions', () => {
    const d = derive(baseCharacter(), makeLookup([TEST_CLASS, TEST_SPECIES]));
    expect(d.companions).toBeUndefined();
  });

  it('emits a companion snapshot with statblock for status=summoned entries', () => {
    const d = derive(
      baseCharacter({
        companions: [
          {
            slug: 'wolf',
            name: 'Greymane',
            sourceContent: { kind: 'feature', slug: 'beast-master' },
            currentHp: 11,
            maxHp: 11,
            status: 'summoned'
          }
        ]
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES, WOLF])
    );
    expect(d.companions).toHaveLength(1);
    const c = d.companions![0];
    expect(c.slug).toBe('wolf');
    expect(c.name).toBe('Greymane');
    expect(c.statblock.ac).toBe(13);
    expect(c.statblock.abilityScores.dex).toBe(15);
    expect(c.statblock.actions[0].name).toBe('Bite');
    expect(c.currentHp).toBe(11);
    expect(c.status).toBe('summoned');
    // Open-question default: sharesInitiative defaults to true.
    expect(c.sharesInitiative).toBe(true);
  });

  it('omits status=dismissed companions from Derived.companions', () => {
    const d = derive(
      baseCharacter({
        companions: [
          {
            slug: 'wolf',
            name: 'Greymane',
            sourceContent: { kind: 'feature', slug: 'beast-master' },
            currentHp: 11,
            maxHp: 11,
            status: 'dismissed'
          }
        ]
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES, WOLF])
    );
    expect(d.companions).toBeUndefined();
  });

  it('honors sharesInitiative=false (familiar opt-out)', () => {
    const d = derive(
      baseCharacter({
        companions: [
          {
            slug: 'wolf',
            name: 'Familiar',
            sourceContent: { kind: 'spell', slug: 'find-familiar' },
            currentHp: 11,
            maxHp: 11,
            status: 'summoned',
            sharesInitiative: false
          }
        ]
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES, WOLF])
    );
    expect(d.companions![0].sharesInitiative).toBe(false);
  });

  it('filters mixed list correctly: only summoned entries surface', () => {
    const d = derive(
      baseCharacter({
        companions: [
          {
            slug: 'wolf',
            name: 'Greymane',
            sourceContent: { kind: 'feature', slug: 'beast-master' },
            currentHp: 11,
            maxHp: 11,
            status: 'summoned'
          },
          {
            slug: 'brown-bear',
            name: 'Sleepy',
            sourceContent: { kind: 'feature', slug: 'beast-master' },
            currentHp: 34,
            maxHp: 34,
            status: 'dismissed'
          }
        ]
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES, WOLF, BROWN_BEAR])
    );
    expect(d.companions).toHaveLength(1);
    expect(d.companions![0].slug).toBe('wolf');
  });

  it('emits warning + skips companion when slug is unknown', () => {
    const d = derive(
      baseCharacter({
        companions: [
          {
            slug: 'ghost-rabbit',
            name: 'Spook',
            sourceContent: { kind: 'spell', slug: 'find-familiar' },
            currentHp: 1,
            maxHp: 1,
            status: 'summoned'
          }
        ]
      }),
      makeLookup([TEST_CLASS, TEST_SPECIES])
    );
    expect(d.companions).toBeUndefined();
    expect(d.validations.some((v) => v.code === 'companion-missing-content')).toBe(true);
  });
});

// --- hp.applyFormDamage ---------------------------------------------

describe('applyFormDamage', () => {
  it('routes damage to form HP first; base untouched when form absorbs it all', () => {
    const result = applyFormDamage(
      { currentHp: 30, tempHp: 0 },
      { current: 10, max: 10 },
      6
    );
    expect(result.form).toEqual({ current: 4, max: 10 });
    expect(result.base.currentHp).toBe(30);
    expect(result.overflowToBase).toBe(0);
  });

  it('cascades overflow to base HP when form drops to 0', () => {
    // The headline scenario from the task: form 5/10, base 30,
    // amount 8 → form hits 0 absorbing 5; base takes 3.
    const result = applyFormDamage(
      { currentHp: 30, tempHp: 0 },
      { current: 5, max: 10 },
      8
    );
    expect(result.form.current).toBe(0);
    expect(result.base.currentHp).toBe(27);
    expect(result.overflowToBase).toBe(3);
  });

  it('drains tempHp before form HP', () => {
    // temp absorbs 4; form takes the rest (10).
    const result = applyFormDamage(
      { currentHp: 30, tempHp: 4 },
      { current: 20, max: 20 },
      14
    );
    expect(result.base.tempHp).toBe(0);
    expect(result.form.current).toBe(10);
    expect(result.base.currentHp).toBe(30);
    expect(result.overflowToBase).toBe(0);
  });

  it('drains overlayHp before form HP', () => {
    const result = applyFormDamage(
      { currentHp: 30, tempHp: 0, overlayHp: 6 },
      { current: 20, max: 20 },
      14
    );
    expect(result.base.overlayHp).toBe(0);
    expect(result.form.current).toBe(12);
    expect(result.base.currentHp).toBe(30);
    expect(result.overflowToBase).toBe(0);
  });

  it('full cascade: temp → overlay → form → base', () => {
    // temp 2, overlay 3, form 5, base 30. Amount 15 → all four
    // buckets bite.
    const result = applyFormDamage(
      { currentHp: 30, tempHp: 2, overlayHp: 3 },
      { current: 5, max: 5 },
      15
    );
    expect(result.base.tempHp).toBe(0);
    expect(result.base.overlayHp).toBe(0);
    expect(result.form.current).toBe(0);
    expect(result.base.currentHp).toBe(25);
    expect(result.overflowToBase).toBe(5);
  });

  it('floors base HP at 0 on lethal overflow', () => {
    const result = applyFormDamage(
      { currentHp: 4, tempHp: 0 },
      { current: 2, max: 10 },
      100
    );
    expect(result.form.current).toBe(0);
    expect(result.base.currentHp).toBe(0);
    expect(result.overflowToBase).toBe(98);
  });

  it('clamps negative amounts to zero (no heal via form-damage)', () => {
    const result = applyFormDamage(
      { currentHp: 30, tempHp: 0 },
      { current: 10, max: 10 },
      -5
    );
    expect(result.form).toEqual({ current: 10, max: 10 });
    expect(result.base.currentHp).toBe(30);
    expect(result.overflowToBase).toBe(0);
  });

  it('floors fractional amounts', () => {
    const result = applyFormDamage(
      { currentHp: 30, tempHp: 0 },
      { current: 10, max: 10 },
      3.9
    );
    expect(result.form.current).toBe(7);
    expect(result.base.currentHp).toBe(30);
  });

  it('preserves the legacy 2-arg applyDamageDelta contract (backwards compat)', async () => {
    // Sanity: bringing in a new helper must not break the existing
    // signature. Re-import applyDamageDelta and assert the shape
    // unchanged.
    const { applyDamageDelta } = await import('../hp');
    expect(applyDamageDelta({ currentHp: 20, tempHp: 0 }, 5)).toEqual({
      currentHp: 15,
      tempHp: 0
    });
  });
});
