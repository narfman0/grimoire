// Attunement gating for item-sourced effects.
//
// Two layers (see derive.ts itemRequirementMet):
//   1. Per-entry `appliesWhen.requires` — 'equipped' (baseline) vs
//      'equipped:attuned' (needs the slot attuned).
//   2. Wholesale inertness — an item row with requiresAttunement: true
//      whose slot is NOT attuned contributes no modifiers, activities,
//      activations, or charge pools, unless an individual entry declares
//      `requires: 'equipped'` explicitly.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function withInventory(extra: CharacterDocument['inventory']): CharacterDocument {
  // Drop the party fixture's own attuned Amulet of Health so its CON
  // override doesn't mask the item under test.
  return {
    ...chronurgy.CHARACTER,
    inventory: [
      ...chronurgy.CHARACTER.inventory.filter((s) => s.contentSlug !== 'amulet-of-health'),
      ...extra
    ]
  };
}

function wrapLookup(packs: Map<string, ContentRow>, extras: Record<string, ContentRow>) {
  const base = chronurgy.makeLookup(packs);
  return (ref: { kind: string; slug: string; version?: number }) =>
    extras[`${ref.kind}/${ref.slug}`] ?? base(ref);
}

const slot = (slug: string, attuned: boolean) => ({
  contentKind: 'item',
  contentSlug: slug,
  version: 1,
  equipped: true,
  attuned
});

describe('requiresAttunement wholesale inertness', () => {
  it('Amulet of Health: CON 19 when attuned, base CON when merely equipped', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const attuned = derive(withInventory([slot('amulet-of-health', true)]), lookup);
    expect(attuned.stats.abilities.con.score).toBe(19);

    const unattuned = derive(withInventory([slot('amulet-of-health', false)]), lookup);
    expect(unattuned.stats.abilities.con.score).toBe(chronurgy.CHARACTER.abilityScores.con);
  });

  it('Lunar Dragon Raiment: no resistances and no Ray of Frost cast when unattuned', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const unattuned = derive(withInventory([slot('lunar-dragon-raiment', false)]), lookup);

    expect(unattuned.stats.resistances.has('cold')).toBe(false);
    expect(unattuned.stats.resistances.has('fire')).toBe(false);
    expect(unattuned.actions.some((a) => a.id.endsWith('/ldr-cast-ray-of-frost'))).toBe(false);
  });

  it('Elven Scorn: +1 enhancement and authored attack are inert when unattuned', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const attuned = derive(withInventory([slot('elven-scorn', true)]), lookup);
    const unattuned = derive(withInventory([slot('elven-scorn', false)]), lookup);

    const attunedAttack = attuned.actions.find((a) => a.sourceContent.slug === 'elven-scorn');
    expect(attunedAttack).toBeDefined();
    // No damage string on the row → no synthesized fallback either.
    expect(unattuned.actions.some((a) => a.sourceContent.slug === 'elven-scorn')).toBe(false);
  });

  it('unattuned attunement item emits no charge pool; attuned does', () => {
    const orb = {
      kind: 'item' as const,
      slug: 'test-attuned-orb',
      version: 1,
      name: 'Test Attuned Orb',
      source: 'test',
      data: {
        category: 'wondrous',
        requiresAttunement: true,
        charges: { max: 5, recharge: { per: 'dawn' } }
      }
    };
    const lookup = wrapLookup(PACKS, { 'item/test-attuned-orb': orb });

    const attuned = derive(withInventory([slot('test-attuned-orb', true)]), lookup);
    expect(attuned.resources.some((r) => r.id === 'item/test-attuned-orb/charges')).toBe(true);

    const unattuned = derive(withInventory([slot('test-attuned-orb', false)]), lookup);
    expect(unattuned.resources.some((r) => r.id === 'item/test-attuned-orb/charges')).toBe(false);
  });

  it('unattuned attunement item surfaces no activations', () => {
    const cloak = {
      kind: 'item' as const,
      slug: 'test-attuned-cloak',
      version: 1,
      name: 'Test Attuned Cloak',
      source: 'test',
      data: {
        category: 'wondrous',
        requiresAttunement: true,
        activations: [
          {
            id: 'test-cloak-shroud',
            name: 'Shroud',
            condition: 'test-cloak-shroud-active'
          }
        ]
      }
    };
    const lookup = wrapLookup(PACKS, { 'item/test-attuned-cloak': cloak });

    const attuned = derive(withInventory([slot('test-attuned-cloak', true)]), lookup);
    expect(attuned.availableActivations.some((a) => a.id === 'test-cloak-shroud')).toBe(true);

    const unattuned = derive(withInventory([slot('test-attuned-cloak', false)]), lookup);
    expect(unattuned.availableActivations.some((a) => a.id === 'test-cloak-shroud')).toBe(false);
  });

  it('an entry declaring requires "equipped" still applies on an unattuned attunement item', () => {
    const lantern = {
      kind: 'item' as const,
      slug: 'test-half-lantern',
      version: 1,
      name: 'Test Half Lantern',
      source: 'test',
      data: {
        category: 'wondrous',
        requiresAttunement: true,
        modifiers: [
          // Works while merely held.
          {
            kind: 'stat-modifier',
            target: 'sense.darkvision',
            mode: 'UPGRADE',
            value: 60,
            appliesWhen: { requires: 'equipped' }
          },
          // Needs attunement.
          {
            kind: 'stat-modifier',
            target: 'ac',
            mode: 'ADD',
            value: 1,
            appliesWhen: { requires: 'equipped:attuned' }
          }
        ]
      }
    };
    const lookup = wrapLookup(PACKS, { 'item/test-half-lantern': lantern });
    const base = derive(withInventory([]), lookup);

    const unattuned = derive(withInventory([slot('test-half-lantern', false)]), lookup);
    expect(unattuned.stats.senses.darkvision).toBe(60);
    expect(unattuned.stats.ac).toBe(base.stats.ac);

    const attuned = derive(withInventory([slot('test-half-lantern', true)]), lookup);
    expect(attuned.stats.senses.darkvision).toBe(60);
    expect(attuned.stats.ac).toBe(base.stats.ac + 1);
  });
});

describe('appliesWhen.requires "equipped:attuned" on non-attunement rows', () => {
  it('SRD Ring of Protection: +1 AC only while attuned', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const base = derive(withInventory([]), lookup);

    const unattuned = derive(withInventory([slot('ring-of-protection', false)]), lookup);
    expect(unattuned.stats.ac).toBe(base.stats.ac);

    const attuned = derive(withInventory([slot('ring-of-protection', true)]), lookup);
    expect(attuned.stats.ac).toBe(base.stats.ac + 1);
  });

  it('the SRD shield offHand-gated +2 AC keeps working (offHand treated as equipped in v1)', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const base = derive(withInventory([]), lookup);
    const withShield = derive(
      withInventory([
        { contentKind: 'item', contentSlug: 'shield', version: 1, equipped: true, attuned: false, slot: 'offHand' }
      ]),
      lookup
    );
    expect(withShield.stats.ac).toBe(base.stats.ac + 2);
  });
});
