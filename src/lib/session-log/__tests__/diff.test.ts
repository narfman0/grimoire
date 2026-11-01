import { describe, it, expect } from 'vitest';
import { describeChange, diffCharacterDocs, logKindOf, SLUG_NAMES } from '../diff';

const base = () => ({
  currentHp: 20,
  tempHp: 0,
  conditions: [] as string[],
  classes: [{ slug: 'fighter', level: 3 }],
  inventory: [] as Array<Record<string, unknown>>,
  resourcesSpent: {} as Record<string, number>,
  hitDiceSpent: {} as Record<string, number>,
  // Noise the log must ignore:
  modifierToggles: {},
  actionUsedThisRound: false,
  favoriteActionIds: [] as string[]
});

describe('diffCharacterDocs', () => {
  it('ignores fields the table does not care about', () => {
    const after = { ...base(), actionUsedThisRound: true, modifierToggles: { reckless: true }, favoriteActionIds: ['x'] };
    expect(diffCharacterDocs(base(), after)).toEqual([]);
  });

  it('treats a new or deleted document as no changes', () => {
    expect(diffCharacterDocs(null, base())).toEqual([]);
    expect(diffCharacterDocs(base(), null)).toEqual([]);
  });

  it('reports HP and temp HP in one change', () => {
    const changes = diffCharacterDocs(base(), { ...base(), currentHp: 13, tempHp: 4 });
    expect(changes).toEqual([
      { kind: 'hp', before: { currentHp: 20, tempHp: 0 }, after: { currentHp: 13, tempHp: 4 } }
    ]);
    expect(describeChange('Aria', changes[0], SLUG_NAMES)).toBe(
      'Aria took 7 HP (20 → 13), temp HP 0 → 4'
    );
  });

  it('reports conditions, death saves and concentration', () => {
    const changes = diffCharacterDocs(
      { ...base(), conditions: ['prone'], concentrating: { label: 'Bless' } },
      { ...base(), conditions: ['poisoned'], deathSaves: { successes: 0, failures: 1 }, concentrating: null }
    );
    expect(changes.map((c) => c.kind)).toEqual(['condition', 'death-save', 'concentration']);
    expect(describeChange('Aria', changes[0], SLUG_NAMES)).toBe('Aria is now poisoned; no longer prone');
    expect(describeChange('Aria', changes[1], SLUG_NAMES)).toBe('Aria death saves: 0 successes, 1 failure');
    expect(describeChange('Aria', changes[2], SLUG_NAMES)).toBe('Aria stopped concentrating on Bless');
  });

  it('splits spell slots from other resources and names them', () => {
    const changes = diffCharacterDocs(base(), {
      ...base(),
      resourcesSpent: { 'spell-slot/L3': 1, 'rage': 1 }
    });
    expect(changes).toEqual([
      { kind: 'spell-slot', level: 3, delta: 1 },
      { kind: 'resource', id: 'rage', delta: 1 }
    ]);
    const names = { ...SLUG_NAMES, resource: () => 'Rage' };
    expect(describeChange('Brok', changes[0], names)).toBe('Brok used 1 3rd-level spell slot');
    expect(describeChange('Brok', changes[1], names)).toBe('Brok used Rage');
  });

  it('reports activation uses and hit dice as resource-kind rows', () => {
    const changes = diffCharacterDocs(
      { ...base(), activations: { rage: { active: false, usesRemaining: 3 } } },
      {
        ...base(),
        activations: { rage: { active: true, usesRemaining: 2 } },
        hitDiceSpent: { fighter: 1 }
      }
    );
    expect(changes.map(logKindOf)).toEqual(['resource', 'resource']);
    expect(describeChange('Brok', changes[0], { ...SLUG_NAMES, activation: () => 'Rage' })).toBe(
      'Brok used Rage (2 left)'
    );
    expect(describeChange('Brok', changes[1], SLUG_NAMES)).toBe('Brok spent 1 Fighter hit die');
  });

  it('diffs inventory as a multiset, so a reorder is not a change', () => {
    const rope = { contentKind: 'item', contentSlug: 'rope', equipped: false, attuned: false };
    const wand = { contentKind: 'item', contentSlug: 'wand', equipped: false, attuned: false, charges: 7 };
    const before = { ...base(), inventory: [rope, wand] };
    expect(diffCharacterDocs(before, { ...base(), inventory: [wand, rope] })).toEqual([]);

    const changes = diffCharacterDocs(before, {
      ...base(),
      inventory: [{ ...wand, charges: 5 }, { contentKind: 'item', contentSlug: 'torch' }]
    });
    expect(changes.map((c) => c.kind)).toEqual(['inventory', 'charges']);
    expect(describeChange('Aria', changes[0], SLUG_NAMES)).toBe('Aria gained Torch; lost Rope');
    expect(describeChange('Aria', changes[1], SLUG_NAMES)).toBe('Aria: Wand charges 7 → 5');
  });

  it('reports level changes and new classes', () => {
    const changes = diffCharacterDocs(base(), {
      ...base(),
      classes: [
        { slug: 'fighter', level: 4 },
        { slug: 'wizard', level: 1 }
      ]
    });
    expect(changes.map((c) => describeChange('Aria', c, SLUG_NAMES))).toEqual([
      'Aria: Fighter 3 → 4',
      'Aria took a level in Wizard (1)'
    ]);
  });
});
