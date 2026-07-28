// `modifierFromChoice` options carrying activities / triggers /
// outboundEffects.
//
// A modifiers-only menu synthesizes nothing for an option whose payload
// is an extra attack (Hunter's Prey Horde Breaker), an on-hit rider
// (Power of the Wilds' Ram) or an aura (its Lion), which is exactly why
// the audit held those rows at T2. Picked options' entries fold into the
// row's own declarations under a `choice/<optionId>/` id namespace, so
// every downstream consumer treats them as row-declared.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

const CLASS: ContentRow = {
  kind: 'class',
  slug: 'test-ranger',
  version: 1,
  source: 'test',
  name: 'Test Ranger',
  data: { hitDie: 10, primaryAbility: 'dex', saves: ['str', 'dex'], features: ['power-menu'] }
};

const SPECIES: ContentRow = {
  kind: 'species',
  slug: 'test-species',
  version: 1,
  source: 'test',
  name: 'Test Species',
  data: {}
};

const MENU: ContentRow = {
  kind: 'feature',
  slug: 'power-menu',
  version: 1,
  source: 'test',
  name: 'Power Menu',
  data: {
    ownerKind: 'class',
    ownerSlug: 'test-ranger',
    minLevel: 1,
    choices: {
      modifierFromChoice: {
        label: 'Power',
        picks: 3,
        options: [
          {
            id: 'horde-breaker',
            label: 'Horde Breaker',
            activities: [
              {
                id: 'extra-swing',
                name: 'Horde Breaker',
                type: 'attack',
                cost: 'free',
                uses: { max: 1, per: 'turn' },
                attack: { ability: 'dex', proficient: true },
                damage: { parts: [{ dice: '1d8', type: 'slashing' }] }
              }
            ]
          },
          {
            id: 'ram',
            label: 'Ram',
            triggers: [
              {
                name: 'Ram',
                on: ['attack.hit'],
                limit: { uses: 1, per: 'turn' },
                grants: { type: 'condition.rider', condition: 'prone' }
              }
            ]
          },
          {
            id: 'lion',
            label: 'Lion',
            outboundEffects: [
              {
                name: 'Lion',
                rangeFt: 5,
                targets: 'enemy',
                modifiers: [{ kind: 'stat-modifier', target: 'attacked.advantage', value: true }]
              }
            ]
          },
          {
            id: 'bear',
            label: 'Bear',
            modifiers: [
              { kind: 'stat-modifier', target: 'resistance.slashing', value: true }
            ]
          }
        ]
      }
    }
  }
};

function makeLookup(): ContentLookup {
  const rows = [CLASS, SPECIES, MENU];
  const map = new Map<string, ContentRow>(rows.map((r) => [`${r.kind}/${r.slug}`, r]));
  return (ref) => map.get(`${ref.kind}/${ref.slug}`);
}

function character(options: string[]): CharacterDocument {
  return {
    id: 'mfc-payloads',
    name: 'Menu Subject',
    classes: [{ slug: 'test-ranger', level: 5, hpRolledPerLevel: [10, 6, 6, 6, 6] }],
    species: { kind: 'species', slug: 'test-species' },
    feats: [],
    abilityScores: { str: 12, dex: 16, con: 14, int: 10, wis: 12, cha: 10 },
    proficienciesChosen: { skills: [] },
    inventory: [],
    spells: { known: [], prepared: [] },
    currentHp: 40,
    tempHp: 0,
    hitDiceSpent: {},
    conditions: [],
    modifierToggles: {},
    featureChoices: { 'power-menu': { modifierFromChoice: { options } } }
  };
}

describe('option-carried activities', () => {
  it('realizes into an Action under the choice/<optionId>/ namespace', () => {
    const d = derive(character(['horde-breaker']), makeLookup());
    const action = d.actions.find((a) => a.id === 'feature/power-menu/choice/horde-breaker/extra-swing');
    expect(action).toBeDefined();
    expect(action!.name).toBe('Horde Breaker');
    expect(action!.cost).toBe('free');
    expect(action!.attackBonus).toBe(6); // dex +3 + PB 3
    expect(action!.damageRolls?.[0]).toEqual({ formula: '1d8', type: 'slashing' });
  });

  it('gets its own per-activity uses pool', () => {
    const d = derive(character(['horde-breaker']), makeLookup());
    const res = d.resources.find((r) => r.id.includes('choice/horde-breaker/extra-swing'));
    expect(res).toBeDefined();
    expect(res!.max).toBe(1);
    expect(res!.per).toBe('turn');
  });

  it('contributes nothing when the option is not picked', () => {
    const d = derive(character(['bear']), makeLookup());
    expect(d.actions.some((a) => a.id.includes('horde-breaker'))).toBe(false);
    expect(d.stats.resistances.has('slashing')).toBe(true);
  });
});

describe('option-carried triggers', () => {
  it('registers the trigger and its limit pool', () => {
    const d = derive(character(['ram']), makeLookup());
    const trigger = d.triggers.find((t) => t.id === 'choice/ram/0');
    expect(trigger).toBeDefined();
    expect(trigger!.on).toEqual(['attack.hit']);
    expect(trigger!.grants).toEqual({ type: 'condition.rider', condition: 'prone' });
    expect(d.resources.some((r) => r.id === 'trigger/power-menu/choice/ram/0')).toBe(true);
  });

  it('fires no unknown-trigger-event warning for a cataloged event', () => {
    const d = derive(character(['ram']), makeLookup());
    expect(d.validations.some((v) => v.code.startsWith('unknown-'))).toBe(false);
  });
});

describe('option-carried outbound effects', () => {
  it('joins the aura manifest', () => {
    const d = derive(character(['lion']), makeLookup());
    const aura = d.outboundEffects.find((e) => e.id === 'choice/lion/0');
    expect(aura).toBeDefined();
    expect(aura!.targets).toBe('enemy');
    expect(aura!.rangeFt).toBe(5);
    expect(aura!.sourceContent).toEqual({ kind: 'feature', slug: 'power-menu' });
  });
});

describe('multi-pick composition', () => {
  it('carries every picked option payload at once, namespaced apart', () => {
    const d = derive(character(['horde-breaker', 'ram', 'lion']), makeLookup());
    expect(d.actions.some((a) => a.id.includes('choice/horde-breaker/'))).toBe(true);
    expect(d.triggers.some((t) => t.id === 'choice/ram/0')).toBe(true);
    expect(d.outboundEffects.some((e) => e.id === 'choice/lion/0')).toBe(true);
  });

  it('never mutates the shared ContentRow (two derives agree)', () => {
    const lookup = makeLookup();
    const a = derive(character(['horde-breaker']), lookup);
    const b = derive(character(['horde-breaker']), lookup);
    expect(a.actions.length).toBe(b.actions.length);
    // The base row still declares no activities of its own.
    expect((MENU.data as { activities?: unknown[] }).activities).toBeUndefined();
    // And a character who picked nothing gets no option payloads.
    expect(derive(character([]), lookup).actions.some((x) => x.id.includes('choice/'))).toBe(false);
  });
});
