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

  it('emits rages-per-day and Relentless Endurance as resources', () => {
    const lookup = zealot.makeLookup(PACKS);
    const d = derive(zealot.CHARACTER, lookup);

    // Rage uses scale by barbarian level: L3 → 3 per long rest.
    const rage = d.resources.find((r) => r.id.endsWith('/enter-rage'));
    expect(rage).toBeDefined();
    expect(rage!.max).toBe(3);
    expect(rage!.per).toBe('long-rest');

    // Triggers with `limit` also surface as resources.
    const re = d.resources.find((r) => r.id.includes('relentless-endurance'));
    expect(re).toBeDefined();
    expect(re!.max).toBe(1);
    expect(re!.per).toBe('long-rest');
  });
});

describe('Tortle Chronurgy Wizard L5', () => {
  it('composes the basic stat block', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const d = derive(chronurgy.CHARACTER, lookup);

    expect(d.stats.totalLevel).toBe(5);
    expect(d.stats.proficiencyBonus).toBe(3);

    // Tortle ASIs: +2 STR (8 → 10), +1 WIS (12 → 13)
    expect(d.stats.abilities.str.score).toBe(10);
    expect(d.stats.abilities.wis.score).toBe(13);
    expect(d.stats.abilities.int.score).toBe(15);
    expect(d.stats.abilities.int.mod).toBe(2);

    // HP: 6 + 4 + 4 + 4 + 4 = 22 base + (CON +2 × 5) = 32
    expect(d.stats.hp.max).toBe(32);

    // AC: Tortle natural armor = 17, no Dex
    expect(d.stats.ac).toBe(17);

    // Saves: Wizard is INT + WIS
    expect(d.stats.saves.int.proficient).toBe(true);
    expect(d.stats.saves.wis.proficient).toBe(true);

    // Skills: arcana + investigation chosen + Survival from Tortle
    expect(d.stats.skills.arcana.proficient).toBe(true);
    expect(d.stats.skills.investigation.proficient).toBe(true);
    expect(d.stats.skills.survival.proficient).toBe(true);

    // Speeds
    expect(d.stats.speeds.walk).toBe(30);
    expect(d.stats.speeds.swim).toBe(30);

    // Spellcasting
    expect(d.stats.spellcastingAbility).toBe('int');
    // DC = 8 + prof(3) + INT mod(2) = 13
    expect(d.stats.spellSaveDC).toBe(13);
    // Attack = prof(3) + INT mod(2) = +5
    expect(d.stats.spellAttackBonus).toBe(5);
    // Wizard 5 slot table: 4 / 3 / 2
    expect(d.stats.spellSlots[1].max).toBe(4);
    expect(d.stats.spellSlots[2].max).toBe(3);
    expect(d.stats.spellSlots[3].max).toBe(2);
  });

  it('produces Fire Bolt with the spell attack bonus', () => {
    const lookup = chronurgy.makeLookup(PACKS);
    const d = derive(chronurgy.CHARACTER, lookup);

    const fb = d.actions.find((a) => a.sourceContent.slug === 'fire-bolt');
    expect(fb).toBeDefined();
    // Fire bolt's `attack.ability` is "spellcasting" → INT mod (2) added,
    // plus prof bonus (3) → +5
    expect(fb!.attackBonus).toBe(5);
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
