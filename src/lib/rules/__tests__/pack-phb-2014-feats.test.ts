// Engine-contract test for the phb-2014 feat encodings that ship with
// grimoire-packs (charger, elemental-adept, crossbow-expert). Tests use
// synthetic feat rows (homebrew-style) so they assert the engine
// primitives, not pack-content presence. Mirrors the structure of
// pack-gated-reaction-attacks.test.ts and homebrew-feat.test.ts.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import { CHARACTER as ZEALOT } from './fixtures/half-orc-zealot-barbarian';
import { loadAllPacks } from './setup/load-packs';
import type {
  CharacterDocument,
  ContentLookup,
  ContentRow
} from '../types';

const PACKS: Map<string, ContentRow> = loadAllPacks();

function lookupWithExtra(rows: ContentRow[]): ContentLookup {
  const map = new Map(PACKS);
  for (const r of rows) map.set(`${r.kind}/${r.slug}`, r);
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function charWithFeat(slug: string, override: Partial<CharacterDocument> = {}): CharacterDocument {
  return {
    ...ZEALOT,
    feats: [{ kind: 'feat', slug }],
    ...override
  };
}

describe('phb-2014 feat encodings — engine contract', () => {
  // -------------------------------------------------------------------------
  // Charger — bonus-action-weapon-attack synthesis after Dash.
  // -------------------------------------------------------------------------
  it('charger-style feat: trigger grant synthesizes a bonus-cost gated Action', () => {
    const slug = 'synthetic-charger';
    const triggerId = 'synthetic-charger-ba';
    const row: ContentRow = {
      kind: 'feat',
      slug,
      version: 1,
      name: 'Synthetic Charger',
      source: 'test-fixtures',
      data: {
        modifiers: [],
        triggers: [
          {
            kind: 'trigger',
            id: triggerId,
            name: 'Charger BA Attack',
            on: ['action.dash'],
            grants: { type: 'bonus-action-weapon-attack' }
          }
        ]
      }
    };
    const d = derive(charWithFeat(slug), lookupWithExtra([row]));
    const gated = d.actions.find((a) => a.gatedOnTrigger === triggerId);
    expect(gated).toBeDefined();
    expect(gated!.cost).toBe('bonus');
    expect(gated!.type).toBe('attack');
    // The synthesized action's sourceContent points at the feat, not the
    // mirrored weapon item.
    expect(gated!.sourceContent).toEqual({ kind: 'feat', slug });
  });

  // -------------------------------------------------------------------------
  // Elemental Adept — defaultEnabled:false toggle exposed on Derived.toggles.
  // -------------------------------------------------------------------------
  it('elemental-adept-style feat: defaultEnabled:false action-modifier surfaces as a toggle', () => {
    const slug = 'synthetic-elemental-adept';
    const toggleId = 'synthetic-elemental-adept-toggle';
    const row: ContentRow = {
      kind: 'feat',
      slug,
      version: 1,
      name: 'Synthetic Elemental Adept',
      source: 'test-fixtures',
      data: {
        modifiers: [
          {
            kind: 'action-modifier',
            id: toggleId,
            name: 'Elemental Adept',
            defaultEnabled: false,
            appliesTo: { activityType: 'cast-spell' },
            effects: [
              { target: 'damage.ignore-resistance', mode: 'OVERRIDE', value: true },
              { target: 'damage.die.min', mode: 'UPGRADE', value: 2 }
            ]
          }
        ],
        triggers: []
      }
    };
    const d = derive(charWithFeat(slug), lookupWithExtra([row]));
    const toggle = d.toggles.find((t) => t.id === toggleId);
    expect(toggle).toBeDefined();
    expect(toggle!.defaultEnabled).toBe(false);
    expect(toggle!.currentlyEnabled).toBe(false);
    expect(toggle!.sourceContent).toEqual({ kind: 'feat', slug });
  });

  // -------------------------------------------------------------------------
  // Crossbow Expert — close-range action-modifier applies to ranged attacks.
  // The half-orc fixture only has a melee greatsword; we swap in a shortbow
  // (SRD content) so a ranged weapon attack is in the action list.
  // -------------------------------------------------------------------------
  it('crossbow-expert-style feat: attack.no-disadvantage.within-5ft lands on ranged attacks', () => {
    const slug = 'synthetic-crossbow-expert';
    const row: ContentRow = {
      kind: 'feat',
      slug,
      version: 1,
      name: 'Synthetic Crossbow Expert',
      source: 'test-fixtures',
      data: {
        modifiers: [
          {
            kind: 'action-modifier',
            id: 'synthetic-crossbow-expert-close-range',
            name: 'Crossbow Close Range',
            appliesTo: {
              activityType: 'attack',
              predicates: [{ 'attack.range': 'ranged' }]
            },
            effects: [
              { target: 'attack.no-disadvantage.within-5ft', mode: 'OVERRIDE', value: true }
            ]
          }
        ],
        triggers: []
      }
    };
    const character = charWithFeat(slug, {
      inventory: [
        { contentKind: 'item', contentSlug: 'shortbow', version: 1, equipped: true, attuned: false }
      ]
    });
    const d = derive(character, lookupWithExtra([row]));
    const rangedAttack = d.actions.find(
      (a) => a.type === 'attack' && a.attackRange === 'ranged' && a.sourceContent.kind === 'item'
    );
    expect(rangedAttack).toBeDefined();
    expect(rangedAttack!.attackNoDisadvantageWithin5ft).toBe(true);
  });

  it('crossbow-expert-style feat: close-range modifier does NOT apply to melee attacks', () => {
    // Same modifier, but the character wields a melee weapon — the
    // `attack.range: ranged` predicate must filter the modifier out.
    const slug = 'synthetic-crossbow-expert-melee-control';
    const row: ContentRow = {
      kind: 'feat',
      slug,
      version: 1,
      name: 'Synthetic Crossbow Expert (melee control)',
      source: 'test-fixtures',
      data: {
        modifiers: [
          {
            kind: 'action-modifier',
            id: 'synthetic-crossbow-expert-control-modifier',
            name: 'Crossbow Close Range',
            appliesTo: {
              activityType: 'attack',
              predicates: [{ 'attack.range': 'ranged' }]
            },
            effects: [
              { target: 'attack.no-disadvantage.within-5ft', mode: 'OVERRIDE', value: true }
            ]
          }
        ],
        triggers: []
      }
    };
    const d = derive(charWithFeat(slug), lookupWithExtra([row]));
    // Half-orc fixture has only a greatsword (melee). Modifier must not apply.
    const meleeAttack = d.actions.find(
      (a) => a.type === 'attack' && a.attackRange === 'melee' && a.sourceContent.kind === 'item'
    );
    expect(meleeAttack).toBeDefined();
    expect(meleeAttack!.attackNoDisadvantageWithin5ft).toBeFalsy();
  });
});
