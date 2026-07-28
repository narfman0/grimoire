// End-to-end: a spell row with `activities[].grants.tempHp` flows
// through derive() onto Action.grants, with the formula evaluated
// against the caster's context. Combines with upcastScaling for the
// Armor of Agathys "5 temp HP, +5 per slot above 1" shape.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { applyUpcast } from '../upcast';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

const FAKE_ARMOR_OF_AGATHYS: ContentRow = {
  kind: 'spell',
  slug: 'test-armor-of-agathys',
  version: 1,
  source: 'test',
  name: 'Test Armor of Agathys',
  data: {
    level: 1,
    school: 'abjuration',
    castingTime: 'action',
    range: { value: 0, units: 'self' },
    components: ['v', 's', 'm'],
    duration: '1 hour',
    activities: [
      {
        id: 'test-aoa-cast',
        type: 'utility',
        name: 'Cast Test Armor of Agathys',
        cost: 'action',
        grants: { tempHp: 5 },
        upcastScaling: { baseSlotLevel: 1, extraTempHpPerSlot: 5 }
      }
    ]
  }
};

function lookupFor(extras: Record<string, ContentRow>) {
  return (ref: { kind: string; slug: string; version?: number }) => {
    const extra = extras[`${ref.kind}/${ref.slug}`];
    if (extra) return extra;
    return chronurgy.makeLookup(PACKS)(ref);
  };
}

function withKnownSpell(slug: string): CharacterDocument {
  return {
    ...chronurgy.CHARACTER,
    spells: {
      known: [...chronurgy.CHARACTER.spells.known, { kind: 'spell', slug, version: 1 }],
      prepared: [...chronurgy.CHARACTER.spells.prepared, slug]
    }
  };
}

describe('derive(): grants.tempHp flows through to Action.grants', () => {
  const lookup = lookupFor({ 'spell/test-armor-of-agathys': FAKE_ARMOR_OF_AGATHYS });

  it('plumbs Armor of Agathys grants.tempHp onto the derived Action', () => {
    const d = derive(withKnownSpell('test-armor-of-agathys'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-armor-of-agathys');
    expect(cast).toBeDefined();
    expect(cast!.grants?.tempHp).toBe(5);
  });

  it('applyUpcast at L3 grants 15 temp HP (5 base + 2 × 5)', () => {
    const d = derive(withKnownSpell('test-armor-of-agathys'), lookup);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-armor-of-agathys')!;
    const upcast = applyUpcast(cast, 3);
    expect(upcast.grants?.tempHp).toBe(15);
  });

  it('evaluates formula tempHp against the caster context (Heroism shape: chaMod)', () => {
    // Synthetic Heroism — grants chaMod temp HP at the start of each turn.
    // Tortle Chronurgy fixture's CHA is 9, so chaMod = -1 → resolved
    // grants.tempHp = -1 (the engine evaluates the formula but doesn't
    // clamp; the runtime decides whether to apply). The point of this
    // test is just to lock the formula-evaluation contract.
    const heroismShape: ContentRow = {
      ...FAKE_ARMOR_OF_AGATHYS,
      slug: 'test-heroism',
      data: {
        ...(FAKE_ARMOR_OF_AGATHYS.data as Record<string, unknown>),
        activities: [
          {
            id: 'test-heroism-cast',
            type: 'utility',
            name: 'Cast Test Heroism',
            cost: 'action',
            grants: { tempHp: 'chaMod' }
          }
        ]
      }
    };
    const lookupH = lookupFor({ 'spell/test-heroism': heroismShape });
    const d = derive(withKnownSpell('test-heroism'), lookupH);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-heroism')!;
    // chronurgy fixture's chaMod = -1 (CHA 9 base, no buffs)
    expect(cast.grants?.tempHp).toBe(-1);
  });

  it('omits grants on Action when the activity has no grants block', () => {
    const noGrants: ContentRow = {
      ...FAKE_ARMOR_OF_AGATHYS,
      slug: 'test-no-grants',
      data: {
        ...(FAKE_ARMOR_OF_AGATHYS.data as Record<string, unknown>),
        activities: [
          {
            id: 'test-no-grants-cast',
            type: 'utility',
            name: 'Cast',
            cost: 'action'
          }
        ]
      }
    };
    const lookupN = lookupFor({ 'spell/test-no-grants': noGrants });
    const d = derive(withKnownSpell('test-no-grants'), lookupN);
    const cast = d.actions.find((a) => a.sourceContent.slug === 'test-no-grants')!;
    expect(cast.grants).toBeUndefined();
  });
});

describe('derive(): grants.removeConditions flows through to Action.grants', () => {
  function spellWithGrants(slug: string, grants: Record<string, unknown>): ContentRow {
    return {
      ...FAKE_ARMOR_OF_AGATHYS,
      slug,
      data: {
        ...(FAKE_ARMOR_OF_AGATHYS.data as Record<string, unknown>),
        activities: [
          { id: `${slug}-cast`, type: 'utility', name: `Cast ${slug}`, cost: 'action', grants }
        ]
      }
    };
  }

  it('plumbs string entries (Lesser Restoration shape) verbatim', () => {
    const row = spellWithGrants('test-lesser-restoration', {
      removeConditions: ['blinded', 'poisoned']
    });
    const d = derive(withKnownSpell(row.slug), lookupFor({ [`spell/${row.slug}`]: row }));
    const cast = d.actions.find((a) => a.sourceContent.slug === row.slug)!;
    expect(cast.grants?.removeConditions).toEqual(['blinded', 'poisoned']);
  });

  it('plumbs stack-decrement entries; stacks stays numeric-only', () => {
    const row = spellWithGrants('test-restoring-touch', {
      removeConditions: [
        { condition: 'exhaustion', stacks: 2 },
        { condition: 'frightened' },
        { condition: 'poisoned', stacks: 'chaMod' } // non-numeric stacks → dropped, condition kept
      ]
    });
    const d = derive(withKnownSpell(row.slug), lookupFor({ [`spell/${row.slug}`]: row }));
    const cast = d.actions.find((a) => a.sourceContent.slug === row.slug)!;
    expect(cast.grants?.removeConditions).toEqual([
      { condition: 'exhaustion', stacks: 2 },
      { condition: 'frightened' },
      { condition: 'poisoned' }
    ]);
  });

  it('drops malformed entries and omits the field when nothing survives', () => {
    const row = spellWithGrants('test-bad-removals', {
      removeConditions: ['', 42, { stacks: 3 }, null]
    });
    const d = derive(withKnownSpell(row.slug), lookupFor({ [`spell/${row.slug}`]: row }));
    const cast = d.actions.find((a) => a.sourceContent.slug === row.slug)!;
    expect(cast.grants?.removeConditions).toBeUndefined();
  });

  it('composes with tempHp in the same grants block', () => {
    const row = spellWithGrants('test-combined-grants', {
      tempHp: 5,
      removeConditions: ['charmed']
    });
    const d = derive(withKnownSpell(row.slug), lookupFor({ [`spell/${row.slug}`]: row }));
    const cast = d.actions.find((a) => a.sourceContent.slug === row.slug)!;
    expect(cast.grants?.tempHp).toBe(5);
    expect(cast.grants?.removeConditions).toEqual(['charmed']);
  });
});

describe('derive(): grants.restoreSpellSlots + activity teleport shape', () => {
  const RING: ContentRow = {
    kind: 'item',
    slug: 'test-refueling-ring',
    version: 1,
    source: 'test',
    name: 'Test Refueling Ring',
    data: {
      category: 'wondrous',
      activities: [
        {
          id: 'refuel',
          name: 'Refuel',
          type: 'utility',
          cost: 'action',
          uses: { max: 1, per: 'day' },
          grants: { restoreSpellSlots: { level: 3 } }
        }
      ]
    }
  };
  const BOOTS: ContentRow = {
    kind: 'item',
    slug: 'test-winding-boots',
    version: 1,
    source: 'test',
    name: 'Test Boots of the Winding Path',
    data: {
      category: 'wondrous',
      activities: [
        {
          id: 'step-back',
          name: 'Step Back',
          type: 'utility',
          cost: 'bonus',
          teleport: { distanceFt: 15, mode: 'line-of-sight' }
        },
        {
          id: 'rift-step',
          name: 'Rift Step',
          type: 'utility',
          cost: { hitDice: 1 },
          teleport: { mode: 'unrestricted' }
        }
      ]
    }
  };

  function withItems(): CharacterDocument {
    return {
      ...chronurgy.CHARACTER,
      inventory: [
        ...chronurgy.CHARACTER.inventory,
        { contentKind: 'item', contentSlug: 'test-refueling-ring', version: 1, equipped: true, attuned: false },
        { contentKind: 'item', contentSlug: 'test-winding-boots', version: 1, equipped: true, attuned: false }
      ]
    };
  }
  const lookup = lookupFor({
    'item/test-refueling-ring': RING,
    'item/test-winding-boots': BOOTS
  });

  it('plumbs restoreSpellSlots onto Action.grants (count defaults absent)', () => {
    const d = derive(withItems(), lookup);
    const refuel = d.actions.find((a) => a.id === 'item/test-refueling-ring/refuel');
    expect(refuel).toBeDefined();
    expect(refuel!.grants?.restoreSpellSlots).toEqual({ level: 3 });
  });

  it('plumbs the teleport block onto Action.teleport', () => {
    const d = derive(withItems(), lookup);
    const step = d.actions.find((a) => a.id === 'item/test-winding-boots/step-back');
    expect(step!.teleport).toEqual({ distanceFt: 15, mode: 'line-of-sight' });
    const rift = d.actions.find((a) => a.id === 'item/test-winding-boots/rift-step');
    expect(rift!.teleport).toEqual({ mode: 'unrestricted' });
  });

  it('passes a hit-dice cost through Action.cost verbatim', () => {
    const d = derive(withItems(), lookup);
    const rift = d.actions.find((a) => a.id === 'item/test-winding-boots/rift-step');
    expect(rift!.cost).toEqual({ hitDice: 1 });
  });

  it('drops malformed restoreSpellSlots / teleport blocks', () => {
    const bad: ContentRow = {
      ...RING,
      slug: 'test-bad-ring',
      data: {
        category: 'wondrous',
        activities: [
          {
            id: 'bad',
            name: 'Bad',
            type: 'utility',
            cost: 'action',
            grants: { restoreSpellSlots: { level: 'three' } },
            teleport: { mode: 'sideways' }
          }
        ]
      }
    };
    const d = derive(
      {
        ...chronurgy.CHARACTER,
        inventory: [
          ...chronurgy.CHARACTER.inventory,
          { contentKind: 'item', contentSlug: 'test-bad-ring', version: 1, equipped: true, attuned: false }
        ]
      },
      lookupFor({ 'item/test-bad-ring': bad })
    );
    const act = d.actions.find((a) => a.id === 'item/test-bad-ring/bad');
    expect(act).toBeDefined();
    expect(act!.grants).toBeUndefined();
    expect(act!.teleport).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// grants.stabilizeTarget — the action-grant sibling of the self-only
// `trait.auto-stabilize` passive (Spare the Dying).
// ---------------------------------------------------------------------------

describe('derive(): grants.stabilizeTarget', () => {
  const SPARE_THE_DYING: ContentRow = {
    kind: 'spell',
    slug: 'test-spare-the-dying',
    version: 1,
    source: 'test',
    name: 'Test Spare the Dying',
    data: {
      level: 0,
      school: 'necromancy',
      activities: [
        {
          id: 'stabilize',
          name: 'Spare the Dying',
          type: 'utility',
          cost: 'action',
          grants: { stabilizeTarget: true }
        }
      ]
    }
  };

  it('plumbs the flag onto Action.grants', () => {
    const d = derive(
      withKnownSpell('test-spare-the-dying'),
      lookupFor({ 'spell/test-spare-the-dying': SPARE_THE_DYING })
    );
    const cast = d.actions.find((a) => a.id.endsWith('/stabilize'));
    expect(cast!.grants).toEqual({ stabilizeTarget: true });
  });

  it('ignores a non-true value (no grants block synthesized)', () => {
    const loose: ContentRow = {
      ...SPARE_THE_DYING,
      slug: 'test-loose-stabilize',
      data: {
        ...(SPARE_THE_DYING.data as Record<string, unknown>),
        activities: [
          {
            id: 'stabilize',
            name: 'Loose',
            type: 'utility',
            cost: 'action',
            grants: { stabilizeTarget: 'yes' }
          }
        ]
      }
    };
    const d = derive(
      withKnownSpell('test-loose-stabilize'),
      lookupFor({ 'spell/test-loose-stabilize': loose })
    );
    expect(d.actions.find((a) => a.id.endsWith('/stabilize'))!.grants).toBeUndefined();
  });
});
