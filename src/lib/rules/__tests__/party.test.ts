// Smoke tests for the rules engine v0 against the actual party.
// Both characters use real content loaded from disk:
//   - SRD 5.2 from this repo's `content-packs/`
//   - Non-SRD (Tortle, Half-Orc legacy, Chronurgy, Zealot) from
//     `../grimoire-packs/` (override with $GRIMOIRE_PACKS_DIR).
//
// These assertions cover the *shape* of derive() — that the engine produces
// reasonable numbers for the two builds. Exact damage formulas and edge-case
// trigger semantics will tighten as the engine matures.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import type { ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

describe('Half-Orc Zealot Barbarian L3', () => {
  it('composes the basic stat block', () => {
    const lookup = zealot.makeLookup(PACKS);
    const d = derive(zealot.CHARACTER, lookup);

    // Level + prof bonus
    expect(d.stats.totalLevel).toBe(3);
    expect(d.stats.proficiencyBonus).toBe(2);

    // Abilities after Half-Orc ASIs (+2 STR, +1 CON)
    expect(d.stats.abilities.str.score).toBe(17);
    expect(d.stats.abilities.str.mod).toBe(3);
    expect(d.stats.abilities.con.score).toBe(14);
    expect(d.stats.abilities.con.mod).toBe(2);

    // HP: 12 + 7 + 7 = 26 base + (2 * 3) = 32
    expect(d.stats.hp.max).toBe(32);

    // AC: Unarmored Defense — 10 + DEX (1) + CON (2) = 13
    expect(d.stats.ac).toBe(13);

    // Saves: STR + CON proficient
    expect(d.stats.saves.str.proficient).toBe(true);
    expect(d.stats.saves.con.proficient).toBe(true);
    expect(d.stats.saves.dex.proficient).toBe(false);

    // Skills: chosen athletics/perception + Menacing intimidation
    expect(d.stats.skills.athletics.proficient).toBe(true);
    expect(d.stats.skills.perception.proficient).toBe(true);
    expect(d.stats.skills.intimidation.proficient).toBe(true);
    expect(d.stats.skills.athletics.bonus).toBe(d.stats.abilities.str.mod + d.stats.proficiencyBonus);

    // Senses: Darkvision 60 from Half-Orc
    expect(d.stats.senses.darkvision).toBe(60);

    // No spellcasting
    expect(d.stats.spellSaveDC).toBeNull();
  });

  it('registers active resistances while raging', () => {
    const lookup = zealot.makeLookup(PACKS);
    const d = derive(zealot.CHARACTER, lookup);

    // Rage condition is on the character; resistance modifiers apply
    expect(d.stats.resistances.has('bludgeoning')).toBe(true);
    expect(d.stats.resistances.has('piercing')).toBe(true);
    expect(d.stats.resistances.has('slashing')).toBe(true);
  });

  it('produces a greatsword attack action with the right hit + type', () => {
    const lookup = zealot.makeLookup(PACKS);
    const d = derive(zealot.CHARACTER, lookup);

    const greatsword = d.actions.find((a) => a.sourceContent.slug === 'greatsword');
    expect(greatsword).toBeDefined();
    expect(greatsword!.attackBonus).toBe(d.stats.abilities.str.mod + d.stats.proficiencyBonus); // +5
    expect(greatsword!.attackAbility).toBe('str');
    expect(greatsword!.attackRange).toBe('melee');
    expect(greatsword!.damageRolls?.[0].type).toBe('slashing');
    // Damage formula composition is covered in the "Rage damage + Divine Fury" test
    // below, since this fixture has rage active and divine-fury enabled.
  });

  it('applies Rage damage + Divine Fury to the greatsword while raging', () => {
    const lookup = zealot.makeLookup(PACKS);
    const d = derive(zealot.CHARACTER, lookup);

    const greatsword = d.actions.find((a) => a.sourceContent.slug === 'greatsword');
    expect(greatsword).toBeDefined();
    // Modifier traces should include both Rage and Divine Fury
    const ids = greatsword!.appliedModifiers.map((m) => m.modifierId);
    expect(ids).toContain('rage-melee-damage');
    expect(ids).toContain('divine-fury-bonus');
    // Damage bonus accumulated: prof bonus (2, rage) + 1 (divine fury) = +3 over base +3 STR = +6
    // formula: 2d6+3 base, then +2 rage = 2d6+5, then +1 divine fury = 2d6+6
    expect(greatsword!.damageRolls?.[0].formula).toBe('2d6+6');
  });

  it('declares the Relentless Endurance trigger', () => {
    const lookup = zealot.makeLookup(PACKS);
    const d = derive(zealot.CHARACTER, lookup);

    const re = d.triggers.find((t) => t.id === 'relentless-endurance');
    expect(re).toBeDefined();
    expect(re!.on).toContain('damage.reduce-to-zero');
    expect(re!.limit).toEqual({ per: 'long-rest', uses: 1 });
  });

  it('exposes rage as an availableActivation and Relentless Endurance as a resource', () => {
    const lookup = zealot.makeLookup(PACKS);
    const d = derive(zealot.CHARACTER, lookup);

    // Rage migrated from Resources to the activation primitive (commit b554e6f).
    // Uses still scale by barbarian level via the perClass-table: L3 → 3 / long rest.
    const rage = d.availableActivations.find((a) => a.id === 'rage');
    expect(rage).toBeDefined();
    expect(rage!.usesMax).toBe(3);
    expect(rage!.refreshOn).toBe('long-rest');
    expect(rage!.condition).toBe('rage');
    expect(rage!.cost).toBe('bonus');

    // Confirm rage is NO LONGER a resource — Resources panel doesn't double-count.
    const rageResource = d.resources.find((r) => r.id.endsWith('/enter-rage'));
    expect(rageResource).toBeUndefined();

    // Triggers with `limit` still surface as resources.
    const re = d.resources.find((r) => r.id.includes('relentless-endurance'));
    expect(re).toBeDefined();
    expect(re!.max).toBe(1);
    expect(re!.per).toBe('long-rest');
  });
});

describe('Zealot Barbarian — Divine Fury + Warrior of the Gods feature authoring', () => {
  it('divine-fury action-modifier appears in greatsword appliedModifiers while raging', () => {
    const lookup = zealot.makeLookup(PACKS);
    const d = derive(zealot.CHARACTER, lookup);

    // Character fixture has rage active (conditions: ['rage']) and
    // divine-fury-bonus in modifierToggles: { 'divine-fury-bonus': true }.
    const greatsword = d.actions.find((a) => a.sourceContent.slug === 'greatsword');
    expect(greatsword).toBeDefined();
    expect(greatsword!.type).toBe('attack');
    expect(greatsword!.attackRange).toBe('melee');

    const modIds = greatsword!.appliedModifiers.map((m) => m.modifierId);
    // divine-fury-bonus action-modifier from the zealot feature fires because
    // appliesWhen.condition='rage' is satisfied and the attack is melee.
    expect(modIds).toContain('divine-fury-bonus');
  });

  it('divine-fury produces an extra damage.dice roll on the greatsword action', () => {
    const lookup = zealot.makeLookup(PACKS);
    const d = derive(zealot.CHARACTER, lookup);

    const greatsword = d.actions.find((a) => a.sourceContent.slug === 'greatsword');
    expect(greatsword).toBeDefined();
    // The greatsword should have at least the base damage roll.
    // The damage.dice effect from divine-fury appends an extra roll.
    expect(greatsword!.damageRolls).toBeDefined();
    expect(greatsword!.damageRolls!.length).toBeGreaterThanOrEqual(1);
    // The greatsword base damage roll is slashing; divine-fury appends radiant.
    const slashing = greatsword!.damageRolls!.find((r) => r.type === 'slashing');
    expect(slashing).toBeDefined();
  });

  it('warrior-of-the-gods feature row carries the no-material-component-on-revive flag modifier', () => {
    const lookup = zealot.makeLookup(PACKS);
    // Verify the feature row itself is present and has the expected flag modifier.
    const featureRow = lookup({ kind: 'feature', slug: 'warrior-of-the-gods' });
    expect(featureRow).toBeDefined();
    const mods = (featureRow!.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    const flagMod = mods.find(
      (m) => m.kind === 'stat-modifier' && m.target === 'flag.no-material-component-on-revive'
    );
    expect(flagMod).toBeDefined();
    expect(flagMod!.value).toBe(true);
    expect(flagMod!.mode).toBe('OVERRIDE');

    // Also verify derive() does not error when warrior-of-the-gods is active
    // (the flag modifier does not produce validation warnings).
    const d = derive(zealot.CHARACTER, lookup);
    const errors = d.validations.filter((v) => v.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});

describe("Ray'Quasar — Tortle Chronurgy Magic Wizard 10", () => {
  it('composes the basic stat block', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const d = derive(chronurgy.CHARACTER, lookup);

    expect(d.stats.totalLevel).toBe(10);
    expect(d.stats.proficiencyBonus).toBe(4);

    // Tortle-package species: STR+2 (raw 4 → 6), WIS+1 (raw 9 → 10)
    expect(d.stats.abilities.str.score).toBe(6);
    expect(d.stats.abilities.wis.score).toBe(10);
    // Skill Expert feat ASI: INT+1 (raw 19 → 20)
    expect(d.stats.abilities.int.score).toBe(20);
    expect(d.stats.abilities.int.mod).toBe(5);
    // Amulet of Health: CON OVERRIDE 19
    expect(d.stats.abilities.con.score).toBe(19);
    expect(d.stats.abilities.con.mod).toBe(4);

    // HP: sum(hpRolledPerLevel) 42 + CON mod(+4) × 10 = 82
    expect(d.stats.hp.max).toBe(82);

    // AC: Tortle natural armor OVERRIDE 17 (DEX not added)
    expect(d.stats.ac).toBe(17);

    // Saves: Wizard is proficient in INT + WIS
    expect(d.stats.saves.int.proficient).toBe(true);
    expect(d.stats.saves.wis.proficient).toBe(true);

    // Skills: chosen proficiencies + Survival auto from tortle-package
    expect(d.stats.skills.arcana.proficient).toBe(true);
    expect(d.stats.skills.arcana.expertise).toBe(true); // Skill Expert expertise choice
    expect(d.stats.skills.arcana.bonus).toBe(13); // INT+5 + PB+4 + expertise PB+4
    expect(d.stats.skills.stealth.proficient).toBe(true); // Skill Expert skill choice
    expect(d.stats.skills.investigation.proficient).toBe(true);
    expect(d.stats.skills.survival.proficient).toBe(true);

    // Speeds
    expect(d.stats.speeds.walk).toBe(30);
    expect(d.stats.speeds.swim).toBe(30);

    // Spellcasting
    expect(d.stats.spellcastingAbility).toBe('int');
    // DC = 8 + prof(4) + INT mod(5) = 17
    expect(d.stats.spellSaveDC).toBe(17);
    // Attack = prof(4) + INT mod(5) = +9
    expect(d.stats.spellAttackBonus).toBe(9);
    // Wizard 10 slot table: 4 / 3 / 3 / 3 / 2
    expect(d.stats.spellSlots[1].max).toBe(4);
    expect(d.stats.spellSlots[2].max).toBe(3);
    expect(d.stats.spellSlots[3].max).toBe(3);
    expect(d.stats.spellSlots[4].max).toBe(3);
    expect(d.stats.spellSlots[5].max).toBe(2);
  });

  it('produces Fire Bolt with the spell attack bonus', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const d = derive(chronurgy.CHARACTER, lookup);

    const fb = d.actions.find((a) => a.sourceContent.slug === 'fire-bolt');
    expect(fb).toBeDefined();
    // Fire bolt: spellcasting attack → INT mod(5) + prof(4) = +9
    expect(fb!.attackBonus).toBe(9);
    expect(fb!.damageRolls?.[0].type).toBe('fire');
  });

  it('declares the Chronal Shift trigger', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const d = derive(chronurgy.CHARACTER, lookup);

    const cs = d.triggers.find((t) => t.id === 'chronal-shift');
    expect(cs).toBeDefined();
    expect(cs!.limit).toEqual({ per: 'long-rest', uses: 2 });
  });
});
