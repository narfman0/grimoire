// Locks the trigger-grant → synthesized-action shape that grimoire-packs
// relies on for non-SRD subclass features (Eldritch Knight War Magic,
// War Domain War Priest, College of Valor Battle Magic, Oath of Vengeance
// Soul of Vengeance, etc.).
//
// These packs encode the gated BA/reaction weapon attack as a trigger on
// the feature row with grants.type ∈ {bonus-action-weapon-attack,
// reaction-weapon-attack}. Derive must synthesize an extra Action
// mirroring the primary weapon attack with cost flipped + gatedOnTrigger
// pointing at the trigger id. We don't load grimoire-packs from disk
// here — instead we build synthetic feat rows (homebrew-style) so the
// test asserts the engine contract, not pack content presence.
//
// Reference contract test: mechanics.test.ts → "C.9 — gated BA / reaction
// weapon attack from trigger grants".

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import { CHARACTER } from './fixtures/half-orc-zealot-barbarian';
import { loadAllPacks } from './setup/load-packs';
import type {
  CharacterDocument,
  ContentLookup,
  ContentRow,
  TriggerGrant
} from '../types';

const PACKS: Map<string, ContentRow> = loadAllPacks();

function lookupWithExtra(rows: ContentRow[]): ContentLookup {
  const map = new Map(PACKS);
  for (const r of rows) map.set(`${r.kind}/${r.slug}`, r);
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function feat(slug: string, triggerId: string, grants: TriggerGrant): ContentRow {
  return {
    kind: 'feat',
    slug,
    version: 1,
    name: slug,
    source: 'test-fixtures',
    data: {
      modifiers: [],
      triggers: [
        {
          kind: 'trigger',
          id: triggerId,
          name: slug,
          on: ['spell.cast'],
          grants
        }
      ]
    }
  };
}

// Re-use the half-orc zealot character (has a greatsword → primary weapon
// attack to mirror). We layer a synthetic feat onto the character via the
// feats[] list so derive picks up the trigger.
function charWithFeat(slug: string): CharacterDocument {
  return { ...CHARACTER, feats: [{ kind: 'feat', slug }] };
}

describe('pack contract — gated BA / reaction weapon-attack synthesis', () => {
  it('synthesizes a BA-cost Action with gatedOnTrigger set for bonus-action-weapon-attack grants', () => {
    const slug = 'synthetic-ba-grant';
    const triggerId = 'synthetic-ba-grant-trigger';
    const lookup = lookupWithExtra([
      feat(slug, triggerId, { type: 'bonus-action-weapon-attack' })
    ]);
    const d = derive(charWithFeat(slug), lookup);
    const gated = d.actions.find((a) => a.gatedOnTrigger === triggerId);
    expect(gated).toBeDefined();
    expect(gated!.cost).toBe('bonus');
    expect(gated!.type).toBe('attack');
  });

  it('synthesizes a reaction-cost Action for reaction-weapon-attack grants', () => {
    const slug = 'synthetic-reaction-grant';
    const triggerId = 'synthetic-reaction-grant-trigger';
    const lookup = lookupWithExtra([
      feat(slug, triggerId, { type: 'reaction-weapon-attack' })
    ]);
    const d = derive(charWithFeat(slug), lookup);
    const gated = d.actions.find((a) => a.gatedOnTrigger === triggerId);
    expect(gated).toBeDefined();
    expect(gated!.cost).toBe('reaction');
    expect(gated!.type).toBe('attack');
  });

  it('mirrors the primary weapon attack (attackBonus + damageRolls match the greatsword action)', () => {
    const slug = 'synthetic-mirror-grant';
    const triggerId = 'synthetic-mirror-grant-trigger';
    const lookup = lookupWithExtra([
      feat(slug, triggerId, { type: 'bonus-action-weapon-attack' })
    ]);
    const d = derive(charWithFeat(slug), lookup);
    const primary = d.actions.find(
      (a) => a.sourceContent.kind === 'item' && a.cost === 'action' && a.type === 'attack'
    );
    const gated = d.actions.find((a) => a.gatedOnTrigger === triggerId);
    expect(primary).toBeDefined();
    expect(gated).toBeDefined();
    expect(gated!.attackBonus).toBe(primary!.attackBonus);
    expect(gated!.damageRolls).toEqual(primary!.damageRolls);
    expect(gated!.attackAbility).toBe(primary!.attackAbility);
    expect(gated!.attackRange).toBe(primary!.attackRange);
  });

  it('points sourceContent at the feature/feat the trigger came from, not the weapon', () => {
    const slug = 'synthetic-sourcecontent-grant';
    const triggerId = 'synthetic-sourcecontent-grant-trigger';
    const lookup = lookupWithExtra([
      feat(slug, triggerId, { type: 'bonus-action-weapon-attack' })
    ]);
    const d = derive(charWithFeat(slug), lookup);
    const gated = d.actions.find((a) => a.gatedOnTrigger === triggerId);
    expect(gated).toBeDefined();
    expect(gated!.sourceContent).toEqual({ kind: 'feat', slug });
    // Negative assertion: the source must NOT be the weapon item.
    expect(gated!.sourceContent.kind).not.toBe('item');
  });
});
