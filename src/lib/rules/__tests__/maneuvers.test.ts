// Battle Master maneuver content model — `ManeuverDecl` schema +
// `choices.maneuvers` plural-pick slot + per-effect-kind synthesis.
//
// The class row declares the Superiority Dice pool (canonical class-resource
// consumer for maneuvers). The parent feature row (Combat Superiority)
// carries the maneuver catalog in `data.maneuvers[]` and the pick slot
// in `data.choices.maneuvers`. The player records picks under
// `character.featureChoices[slug].maneuvers = [{maneuverId: '...'}, ...]`.
// derive() walks each picked maneuver and emits Action / Trigger /
// OutboundEffect tagged with `spendsResource: 'superiority'`.
//
// Covered:
//   - 6 sample maneuvers exercising every effect.kind in the discriminated
//     union (on-hit-rider, pre-roll, damage-reduction, reaction-attack,
//     ally-attack, temp-hp-grant, target-free-move).
//   - Pick → emit: Riposte emits a Trigger, Trip Attack emits an Action
//     with damage rider + save DC, etc.
//   - Save-DC resolver: `{calc: 'maneuver'}` resolves to 8 + PB + max(str, dex) mod.
//   - Pick-count from a perClass-table at L3/L7/L10/L15 (unresolved state
//     surfaces via pendingFeatureChoices).
//   - allowedIds filtering: maneuver ids not in `allowedIds` are silently dropped.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow, ManeuverDecl } from '../types';

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const TEST_FIGHTER_CLASS: ContentRow = {
  kind: 'class',
  slug: 'testfighter',
  version: 1,
  source: 'test',
  name: 'Test Fighter',
  data: {
    hitDie: 10,
    primaryAbility: 'str',
    saves: ['str', 'con'],
    resources: [
      {
        id: 'superiority',
        name: 'Superiority Dice',
        max: {
          perClass: 'testfighter',
          table: [0, 0, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6]
        },
        dieSize: {
          perClass: 'testfighter',
          table: [
            'd8', 'd8', 'd8', 'd8', 'd8', 'd8', 'd8', 'd8', 'd8',
            'd10', 'd10', 'd10', 'd10', 'd10', 'd10', 'd10', 'd10',
            'd12', 'd12', 'd12'
          ]
        },
        refresh: 'short-rest',
        spendKind: 'die'
      }
    ]
  }
};

const TEST_SUBCLASS: ContentRow = {
  kind: 'subclass',
  slug: 'testbattlemaster',
  version: 1,
  source: 'test',
  name: 'Test Battle Master',
  data: {
    parentClass: 'testfighter',
    subclassFeatures: [{ level: 3, name: 'Combat Superiority' }]
  }
};

// 6 sample maneuvers, one per effect.kind plus on-hit-rider (most common).
const SAMPLE_MANEUVERS: ManeuverDecl[] = [
  // on-hit-rider with damage rider + STR save → prone (Trip Attack)
  {
    id: 'trip-attack',
    name: 'Trip Attack',
    description:
      'On a hit, add the superiority die to damage. If the target is Large or smaller, it must make a STR save or fall prone.',
    cost: 'free',
    spendsResource: 'superiority',
    effect: {
      kind: 'on-hit-rider',
      damageRider: { dieFromResource: 'superiority', type: 'weapon' },
      save: {
        ability: 'str',
        dc: { calc: 'maneuver' },
        onFail: { kind: 'condition', condition: 'prone' }
      },
      maxTargetSize: 'large'
    }
  },
  // pre-roll add-to-attack (Precision Attack)
  {
    id: 'precision-attack',
    name: 'Precision Attack',
    description: 'Before making an attack roll, add a superiority die to the roll.',
    cost: 'free',
    spendsResource: 'superiority',
    effect: {
      kind: 'pre-roll',
      addsToRoll: 'attack',
      dieFromResource: 'superiority'
    }
  },
  // damage-reduction trigger (Parry)
  {
    id: 'parry',
    name: 'Parry',
    description:
      'When you take damage, reduce it by the superiority die roll + your DEX modifier.',
    cost: 'reaction',
    spendsResource: 'superiority',
    effect: {
      kind: 'damage-reduction',
      reduceBy: { dieFromResource: 'superiority', addAbilityMod: 'dex' },
      triggerOn: 'damage.taken'
    }
  },
  // reaction-attack trigger (Riposte)
  {
    id: 'riposte',
    name: 'Riposte',
    description:
      'When a creature misses you with a melee attack, use your reaction to make a melee weapon attack with the superiority die added to damage.',
    cost: 'reaction',
    spendsResource: 'superiority',
    effect: {
      kind: 'reaction-attack',
      triggerOn: 'attack.targets-self.declare',
      attackType: 'melee-weapon',
      damageRider: { dieFromResource: 'superiority', type: 'weapon' }
    }
  },
  // ally-attack outbound (Commander's Strike)
  {
    id: 'commanders-strike',
    name: "Commander's Strike",
    description:
      'Forgo one of your attacks. Direct an ally to use their reaction to make a weapon attack with the superiority die added to damage.',
    cost: 'bonus',
    spendsResource: 'superiority',
    effect: {
      kind: 'ally-attack',
      costOnSelf: 'bonus',
      costOnAlly: 'reaction',
      attackType: 'weapon',
      damageRider: { dieFromResource: 'superiority', type: 'weapon' }
    }
  },
  // temp-hp-grant (Rally)
  {
    id: 'rally',
    name: 'Rally',
    description:
      'One creature gains temporary hit points equal to the superiority die roll + your CHA modifier.',
    cost: 'bonus',
    spendsResource: 'superiority',
    effect: {
      kind: 'temp-hp-grant',
      costOnSelf: 'bonus',
      tempHp: { dieFromResource: 'superiority', addAbilityMod: 'cha' },
      targets: 'ally'
    }
  },
  // target-free-move on-hit (Maneuvering Attack)
  {
    id: 'maneuvering-attack',
    name: 'Maneuvering Attack',
    description:
      'On a hit, add the superiority die to damage and let one ally move up to half their speed without provoking opportunity attacks.',
    cost: 'free',
    spendsResource: 'superiority',
    effect: {
      kind: 'target-free-move',
      distance: 'half-ally-speed'
    }
  }
];

const FEATURE_COMBAT_SUPERIORITY: ContentRow = {
  kind: 'feature',
  slug: 'combat-superiority',
  version: 1,
  source: 'test',
  name: 'Combat Superiority',
  data: {
    ownerKind: 'subclass',
    ownerSlug: 'testbattlemaster',
    minLevel: 3,
    description: 'Battle Master maneuvers + Superiority Dice.',
    maneuvers: SAMPLE_MANEUVERS,
    choices: {
      maneuvers: {
        picks: {
          perClass: 'testfighter',
          table: [0, 0, 3, 3, 3, 3, 5, 5, 5, 7, 7, 7, 7, 7, 9, 9, 9, 9, 9, 9]
        }
      }
    }
  }
};

// Variant that pins the DC ability to a single ability via the
// override field on the parent feature.
const FEATURE_COMBAT_SUPERIORITY_STR_ONLY: ContentRow = {
  ...FEATURE_COMBAT_SUPERIORITY,
  data: {
    ...FEATURE_COMBAT_SUPERIORITY.data,
    maneuverDCAbility: 'str'
  }
};

// Variant that restricts the legal pick set to a couple of ids via
// `allowedIds` — the rest should drop silently.
const FEATURE_COMBAT_SUPERIORITY_ALLOWED: ContentRow = {
  ...FEATURE_COMBAT_SUPERIORITY,
  data: {
    ...FEATURE_COMBAT_SUPERIORITY.data,
    choices: {
      maneuvers: {
        picks: 3,
        allowedIds: ['trip-attack', 'riposte', 'parry']
      }
    }
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

function makeLookup(extra: ContentRow[] = []): ContentLookup {
  const rows: ContentRow[] = [
    TEST_FIGHTER_CLASS,
    TEST_SUBCLASS,
    FEATURE_COMBAT_SUPERIORITY,
    TEST_SPECIES,
    ...extra
  ];
  const map = new Map<string, ContentRow>(
    rows.map((r) => [`${r.kind}/${r.slug}`, r])
  );
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function baseCharacter(
  level: number,
  featureChoices?: Record<string, Record<string, unknown>>,
  abilityScores?: Partial<CharacterDocument['abilityScores']>
): CharacterDocument {
  return {
    id: 'test-maneuvers',
    name: 'Test Battle Master',
    classes: [
      {
        slug: 'testfighter',
        level,
        subclass: 'testbattlemaster',
        hpRolledPerLevel: Array(level).fill(10)
      }
    ],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: {
      str: 16, // +3
      dex: 14, // +2
      con: 14,
      int: 10,
      wis: 10,
      cha: 12,
      ...abilityScores
    },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 10,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    featureChoices
  };
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe('maneuvers — per-effect-kind synthesis', () => {
  it('on-hit-rider (Trip Attack) emits an Action with damage rider + save DC + spendsResource', () => {
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'trip-attack' }] }
    });
    const d = derive(char, makeLookup());
    const trip = d.actions.find((a) => a.id.endsWith('/maneuver/trip-attack'));
    expect(trip).toBeDefined();
    expect(trip!.type).toBe('maneuver-rider');
    expect(trip!.cost).toBe('free');
    expect(trip!.spendsResource).toBe('superiority');
    expect(trip!.gatedOnTrigger).toBe('attack.hit');
    expect(trip!.maneuverRider).toBeDefined();
    expect(trip!.maneuverRider!.damageRider).toEqual({
      dieFromResource: 'superiority',
      type: 'weapon'
    });
    expect(trip!.maneuverRider!.save).toEqual({
      ability: 'str',
      // 8 + PB(2) + max(strMod=3, dexMod=2) = 13
      dcValue: 13,
      onFail: { kind: 'condition', condition: 'prone' }
    });
    expect(trip!.maneuverRider!.maxTargetSize).toBe('large');
    expect(trip!.saveDC).toEqual({ ability: 'str', value: 13 });
  });

  it('pre-roll (Precision Attack) emits an Action gated on attack.declare', () => {
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'precision-attack' }] }
    });
    const d = derive(char, makeLookup());
    const precision = d.actions.find((a) => a.id.endsWith('/maneuver/precision-attack'));
    expect(precision).toBeDefined();
    expect(precision!.type).toBe('maneuver-pre-roll');
    expect(precision!.gatedOnTrigger).toBe('attack.declare');
    expect(precision!.spendsResource).toBe('superiority');
  });

  it('damage-reduction (Parry) emits a TriggerDeclaration with damage.reduce grant', () => {
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'parry' }] }
    });
    const d = derive(char, makeLookup());
    const parry = d.triggers.find((t) => t.id.endsWith('/maneuver/parry'));
    expect(parry).toBeDefined();
    expect(parry!.on).toEqual(['damage.taken']);
    expect((parry!.grants as { type?: string }).type).toBe('damage.reduce');
    expect(parry!.spendsResource).toBe('superiority');
    expect(parry!.maneuverRider!.reduceBy).toEqual({
      dieFromResource: 'superiority',
      addAbilityMod: 'dex'
    });
  });

  it('reaction-attack (Riposte) emits a TriggerDeclaration with reaction-weapon-attack grant', () => {
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'riposte' }] }
    });
    const d = derive(char, makeLookup());
    const riposte = d.triggers.find((t) => t.id.endsWith('/maneuver/riposte'));
    expect(riposte).toBeDefined();
    expect(riposte!.on).toEqual(['attack.targets-self.declare']);
    expect((riposte!.grants as { type?: string }).type).toBe('reaction-weapon-attack');
    expect(riposte!.spendsResource).toBe('superiority');
    expect(riposte!.maneuverRider!.damageRider).toEqual({
      dieFromResource: 'superiority',
      type: 'weapon'
    });
  });

  it("ally-attack (Commander's Strike) emits an Action with bonus cost AND an outbound effect targeting an ally", () => {
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'commanders-strike' }] }
    });
    const d = derive(char, makeLookup());
    const action = d.actions.find((a) => a.id.endsWith('/maneuver/commanders-strike'));
    expect(action).toBeDefined();
    expect(action!.type).toBe('maneuver-ally-attack');
    expect(action!.cost).toBe('bonus');
    expect(action!.spendsResource).toBe('superiority');
    const outbound = d.outboundEffects.find((o) =>
      o.id.endsWith('/maneuver/commanders-strike')
    );
    expect(outbound).toBeDefined();
    expect(outbound!.targets).toBe('ally');
    expect(outbound!.excludeSelf).toBe(true);
  });

  it('temp-hp-grant (Rally) emits an Action with bonus cost + temp-hp rider', () => {
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'rally' }] }
    });
    const d = derive(char, makeLookup());
    const rally = d.actions.find((a) => a.id.endsWith('/maneuver/rally'));
    expect(rally).toBeDefined();
    expect(rally!.type).toBe('maneuver-buff');
    expect(rally!.cost).toBe('bonus');
    expect(rally!.spendsResource).toBe('superiority');
    expect(rally!.maneuverRider!.tempHp).toEqual({
      dieFromResource: 'superiority',
      addAbilityMod: 'cha'
    });
  });

  it('target-free-move (Maneuvering Attack) emits an Action with a free-move rider', () => {
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'maneuvering-attack' }] }
    });
    const d = derive(char, makeLookup());
    const ma = d.actions.find((a) => a.id.endsWith('/maneuver/maneuvering-attack'));
    expect(ma).toBeDefined();
    expect(ma!.type).toBe('maneuver-ally-move');
    expect(ma!.gatedOnTrigger).toBe('attack.hit');
    expect(ma!.maneuverRider!.freeMove).toBe('half-ally-speed');
  });

  it('multiple picks compose: emits each picked maneuver independently', () => {
    const char = baseCharacter(3, {
      'combat-superiority': {
        maneuvers: [
          { maneuverId: 'trip-attack' },
          { maneuverId: 'riposte' },
          { maneuverId: 'rally' }
        ]
      }
    });
    const d = derive(char, makeLookup());
    expect(d.actions.find((a) => a.id.endsWith('/trip-attack'))).toBeDefined();
    expect(d.triggers.find((t) => t.id.endsWith('/riposte'))).toBeDefined();
    expect(d.actions.find((a) => a.id.endsWith('/rally'))).toBeDefined();
  });

  it('no picks → no synthesis', () => {
    const char = baseCharacter(3);
    const d = derive(char, makeLookup());
    expect(d.actions.find((a) => a.id.includes('/maneuver/'))).toBeUndefined();
    expect(d.triggers.find((t) => t.id.includes('/maneuver/'))).toBeUndefined();
  });

  it('picks that do not resolve to a catalog entry silently drop', () => {
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'fictional-maneuver' }] }
    });
    const d = derive(char, makeLookup());
    expect(d.actions.find((a) => a.id.includes('/maneuver/fictional-maneuver'))).toBeUndefined();
    expect(d.triggers.find((t) => t.id.includes('/maneuver/fictional-maneuver'))).toBeUndefined();
  });
});

describe('maneuvers — save DC resolver', () => {
  it('{calc: maneuver} = 8 + PB + max(STR, DEX) mod', () => {
    // L3 PB=2. STR 16 (+3), DEX 14 (+2) → max=+3. DC = 8 + 2 + 3 = 13.
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'trip-attack' }] }
    });
    const d = derive(char, makeLookup());
    const trip = d.actions.find((a) => a.id.endsWith('/trip-attack'))!;
    expect(trip.saveDC).toEqual({ ability: 'str', value: 13 });
  });

  it('uses STR over DEX when STR mod is higher', () => {
    // STR 18 (+4), DEX 10 (+0). PB=3 at L5. DC = 8 + 3 + 4 = 15.
    const char = baseCharacter(
      5,
      {
        'combat-superiority': { maneuvers: [{ maneuverId: 'trip-attack' }] }
      },
      { str: 18, dex: 10 }
    );
    const d = derive(char, makeLookup());
    const trip = d.actions.find((a) => a.id.endsWith('/trip-attack'))!;
    expect(trip.maneuverRider!.save!.dcValue).toBe(15);
  });

  it('uses DEX over STR when DEX mod is higher', () => {
    // STR 10 (+0), DEX 18 (+4). PB=3 at L5. DC = 8 + 3 + 4 = 15.
    const char = baseCharacter(
      5,
      {
        'combat-superiority': { maneuvers: [{ maneuverId: 'trip-attack' }] }
      },
      { str: 10, dex: 18 }
    );
    const d = derive(char, makeLookup());
    const trip = d.actions.find((a) => a.id.endsWith('/trip-attack'))!;
    expect(trip.maneuverRider!.save!.dcValue).toBe(15);
  });

  it('honors data.maneuverDCAbility=str override even when DEX is higher', () => {
    // STR 10 (+0), DEX 18 (+4). Override pins STR. PB=2 at L3. DC = 8 + 2 + 0 = 10.
    const lookup = ((): ContentLookup => {
      const map = new Map<string, ContentRow>([
        [`${TEST_FIGHTER_CLASS.kind}/${TEST_FIGHTER_CLASS.slug}`, TEST_FIGHTER_CLASS],
        [`${TEST_SUBCLASS.kind}/${TEST_SUBCLASS.slug}`, TEST_SUBCLASS],
        [
          `${FEATURE_COMBAT_SUPERIORITY_STR_ONLY.kind}/${FEATURE_COMBAT_SUPERIORITY_STR_ONLY.slug}`,
          FEATURE_COMBAT_SUPERIORITY_STR_ONLY
        ],
        [`${TEST_SPECIES.kind}/${TEST_SPECIES.slug}`, TEST_SPECIES]
      ]);
      return (ref) => map.get(`${ref.kind}/${ref.slug}`);
    })();
    const char = baseCharacter(
      3,
      {
        'combat-superiority': { maneuvers: [{ maneuverId: 'trip-attack' }] }
      },
      { str: 10, dex: 18 }
    );
    const d = derive(char, lookup);
    const trip = d.actions.find((a) => a.id.endsWith('/trip-attack'))!;
    expect(trip.maneuverRider!.save!.dcValue).toBe(10);
  });

  it('respects an explicit {dc: {value: N}}', () => {
    // Maneuver with a hand-pinned DC instead of {calc: 'maneuver'}.
    const maneuverWithFixedDC: ManeuverDecl = {
      id: 'fixed-dc-maneuver',
      name: 'Fixed DC Maneuver',
      description: 'A maneuver with an explicit DC.',
      cost: 'free',
      spendsResource: 'superiority',
      effect: {
        kind: 'on-hit-rider',
        save: {
          ability: 'wis',
          dc: { value: 17 },
          onFail: { kind: 'disadvantage-against-others' }
        }
      }
    };
    const customFeature: ContentRow = {
      ...FEATURE_COMBAT_SUPERIORITY,
      data: {
        ...FEATURE_COMBAT_SUPERIORITY.data,
        maneuvers: [maneuverWithFixedDC],
        choices: { maneuvers: { picks: 1 } }
      }
    };
    const lookup = ((): ContentLookup => {
      const map = new Map<string, ContentRow>([
        [`${TEST_FIGHTER_CLASS.kind}/${TEST_FIGHTER_CLASS.slug}`, TEST_FIGHTER_CLASS],
        [`${TEST_SUBCLASS.kind}/${TEST_SUBCLASS.slug}`, TEST_SUBCLASS],
        [`${customFeature.kind}/${customFeature.slug}`, customFeature],
        [`${TEST_SPECIES.kind}/${TEST_SPECIES.slug}`, TEST_SPECIES]
      ]);
      return (ref) => map.get(`${ref.kind}/${ref.slug}`);
    })();
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'fixed-dc-maneuver' }] }
    });
    const d = derive(char, lookup);
    const action = d.actions.find((a) => a.id.endsWith('/fixed-dc-maneuver'))!;
    expect(action.saveDC).toEqual({ ability: 'wis', value: 17 });
  });
});

describe('maneuvers — pick cap from perClass-table + pendingFeatureChoices', () => {
  function findManeuverPick(
    pendingChoices: ReturnType<typeof derive>['pendingFeatureChoices']
  ) {
    return pendingChoices.find((p) => p.featureSlug === 'combat-superiority');
  }

  it('L3 picks=3 — unresolved when 0 picks recorded', () => {
    const char = baseCharacter(3);
    const d = derive(char, makeLookup());
    const pending = findManeuverPick(d.pendingFeatureChoices)!;
    expect(pending).toBeDefined();
    expect(pending.unresolved).toBe(true);
  });

  it('L3 picks=3 — unresolved when only 2 picks recorded', () => {
    const char = baseCharacter(3, {
      'combat-superiority': {
        maneuvers: [{ maneuverId: 'trip-attack' }, { maneuverId: 'parry' }]
      }
    });
    const d = derive(char, makeLookup());
    const pending = findManeuverPick(d.pendingFeatureChoices)!;
    expect(pending.unresolved).toBe(true);
  });

  it('L3 picks=3 — resolved when 3 picks recorded', () => {
    const char = baseCharacter(3, {
      'combat-superiority': {
        maneuvers: [
          { maneuverId: 'trip-attack' },
          { maneuverId: 'parry' },
          { maneuverId: 'riposte' }
        ]
      }
    });
    const d = derive(char, makeLookup());
    const pending = findManeuverPick(d.pendingFeatureChoices)!;
    expect(pending.unresolved).toBe(false);
  });

  it('L7 picks=5 — unresolved when only 3 picks recorded (the L3 picks)', () => {
    const char = baseCharacter(7, {
      'combat-superiority': {
        maneuvers: [
          { maneuverId: 'trip-attack' },
          { maneuverId: 'parry' },
          { maneuverId: 'riposte' }
        ]
      }
    });
    const d = derive(char, makeLookup());
    const pending = findManeuverPick(d.pendingFeatureChoices)!;
    expect(pending.unresolved).toBe(true);
  });

  it('L10 picks=7 — unresolved when only 5 picks recorded', () => {
    const char = baseCharacter(10, {
      'combat-superiority': {
        maneuvers: Array(5)
          .fill(null)
          .map((_, i) => ({ maneuverId: SAMPLE_MANEUVERS[i].id }))
      }
    });
    const d = derive(char, makeLookup());
    const pending = findManeuverPick(d.pendingFeatureChoices)!;
    expect(pending.unresolved).toBe(true);
  });

  it('L15 picks=9 — unresolved when only 7 picks recorded', () => {
    const char = baseCharacter(15, {
      'combat-superiority': {
        maneuvers: Array(7)
          .fill(null)
          .map((_, i) => ({
            maneuverId: SAMPLE_MANEUVERS[i % SAMPLE_MANEUVERS.length].id
          }))
      }
    });
    const d = derive(char, makeLookup());
    const pending = findManeuverPick(d.pendingFeatureChoices)!;
    expect(pending.unresolved).toBe(true);
  });

  it('L15 picks=9 — resolved when 9 picks recorded', () => {
    const char = baseCharacter(15, {
      'combat-superiority': {
        maneuvers: Array(9)
          .fill(null)
          .map((_, i) => ({
            maneuverId: SAMPLE_MANEUVERS[i % SAMPLE_MANEUVERS.length].id
          }))
      }
    });
    const d = derive(char, makeLookup());
    const pending = findManeuverPick(d.pendingFeatureChoices)!;
    expect(pending.unresolved).toBe(false);
  });
});

describe('maneuvers — allowedIds filtering', () => {
  it('picks not in allowedIds are silently dropped', () => {
    const lookup = ((): ContentLookup => {
      const map = new Map<string, ContentRow>([
        [`${TEST_FIGHTER_CLASS.kind}/${TEST_FIGHTER_CLASS.slug}`, TEST_FIGHTER_CLASS],
        [`${TEST_SUBCLASS.kind}/${TEST_SUBCLASS.slug}`, TEST_SUBCLASS],
        [
          `${FEATURE_COMBAT_SUPERIORITY_ALLOWED.kind}/${FEATURE_COMBAT_SUPERIORITY_ALLOWED.slug}`,
          FEATURE_COMBAT_SUPERIORITY_ALLOWED
        ],
        [`${TEST_SPECIES.kind}/${TEST_SPECIES.slug}`, TEST_SPECIES]
      ]);
      return (ref) => map.get(`${ref.kind}/${ref.slug}`);
    })();
    const char = baseCharacter(3, {
      'combat-superiority': {
        maneuvers: [
          { maneuverId: 'trip-attack' },     // allowed
          { maneuverId: 'parry' },           // allowed
          { maneuverId: 'rally' },           // NOT allowed
          { maneuverId: 'precision-attack' } // NOT allowed
        ]
      }
    });
    const d = derive(char, lookup);
    // trip-attack + parry should emit
    expect(d.actions.find((a) => a.id.endsWith('/trip-attack'))).toBeDefined();
    expect(d.triggers.find((t) => t.id.endsWith('/parry'))).toBeDefined();
    // rally + precision-attack should NOT emit
    expect(d.actions.find((a) => a.id.endsWith('/rally'))).toBeUndefined();
    expect(d.actions.find((a) => a.id.endsWith('/precision-attack'))).toBeUndefined();
  });
});

describe('maneuvers — superiority-die pool integration', () => {
  it('Derived.classResources reports a Superiority Dice pool sized to the fighter table', () => {
    const char = baseCharacter(3, {
      'combat-superiority': { maneuvers: [{ maneuverId: 'trip-attack' }] }
    });
    const d = derive(char, makeLookup());
    const pool = d.classResources?.find((r) => r.id === 'superiority');
    expect(pool).toBeDefined();
    // L3 → 4 dice, d8
    expect(pool!.max).toBe(4);
    expect(pool!.dieSize).toBe('d8');
    expect(pool!.refresh).toBe('short-rest');
    // Synthesized action references the pool by id via spendsResource.
    const trip = d.actions.find((a) => a.id.endsWith('/trip-attack'))!;
    expect(trip.spendsResource).toBe('superiority');
  });

  it('die size scales with fighter level (d8 → d10 at L10)', () => {
    const char = baseCharacter(10, {
      'combat-superiority': {
        maneuvers: [
          { maneuverId: 'trip-attack' },
          { maneuverId: 'parry' },
          { maneuverId: 'riposte' }
        ]
      }
    });
    const d = derive(char, makeLookup());
    const pool = d.classResources!.find((r) => r.id === 'superiority')!;
    expect(pool.dieSize).toBe('d10');
    expect(pool.max).toBe(5);
  });
});
