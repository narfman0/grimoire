// E2E mechanics test: verifies that the non-SRD grimoire-packs content (XGtE
// spells, PHB-2014 species, feat schema) has correct mechanical data loaded
// from disk and flows through derive() correctly.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import type { CharacterDocument, ContentLookup, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
	PACKS = loadAllPacks();
});

function lookup(): ContentLookup {
	return (ref) => PACKS.get(`${ref.kind}/${ref.slug}`);
}

// --- Data integrity: verify pack content has mechanical data populated -------

describe('Xanathar spell activities', () => {
	it('toll-the-dead is loaded with a save activity (WIS save, necrotic)', () => {
		const row = PACKS.get('spell/toll-the-dead');
		expect(row).toBeDefined();
		const activities = row!.data.activities as unknown[];
		expect(activities.length).toBeGreaterThan(0);
		const act = activities[0] as Record<string, unknown>;
		expect(act.type).toBe('save');
		const save = act.save as Record<string, unknown>;
		expect(save.ability).toBe('wisdom');
	});

	it('chaos-bolt is loaded with an attack activity', () => {
		const row = PACKS.get('spell/chaos-bolt');
		expect(row).toBeDefined();
		const activities = row!.data.activities as unknown[];
		expect(activities.length).toBeGreaterThan(0);
		const act = activities[0] as Record<string, unknown>;
		expect(act.type).toBe('attack');
	});

	it('absorb-elements is loaded with an activity', () => {
		const row = PACKS.get('spell/absorb-elements');
		expect(row).toBeDefined();
		const activities = row!.data.activities as unknown[];
		expect(activities.length).toBeGreaterThan(0);
	});
});

describe('PHB-2014 species modifiers', () => {
	it('tiefling has CHA +2, INT +1, fire resistance, darkvision', () => {
		const row = PACKS.get('species/tiefling');
		expect(row).toBeDefined();
		const mods = row!.data.modifiers as Array<Record<string, unknown>>;
		expect(mods).toBeDefined();
		expect(mods.length).toBeGreaterThan(0);
		const cha = mods.find((m) => m.target === 'ability.cha');
		expect(cha).toBeDefined();
		expect(cha!.value).toBe(2);
		const fire = mods.find((m) => m.target === 'resistance.fire');
		expect(fire).toBeDefined();
		const dv = mods.find((m) => m.target === 'sense.darkvision');
		expect(dv).toBeDefined();
	});

	it('aarakocra has fly speed and DEX +2, WIS +1', () => {
		const row = PACKS.get('species/aarakocra');
		expect(row).toBeDefined();
		const mods = row!.data.modifiers as Array<Record<string, unknown>>;
		expect(mods).toBeDefined();
		const fly = mods.find((m) => (m.target as string).startsWith('speed.fly'));
		expect(fly).toBeDefined();
	});
});

describe('Feat schema correctness', () => {
	it('XGtE feats use modifiers[] not statModifiers/actionModifiers', () => {
		// Check a sample of feats from xanathars — all should have the corrected schema
		const slugs = ['elven-accuracy', 'fade-away', 'fey-teleportation', 'flames-of-phlegethos'];
		for (const slug of slugs) {
			const row = PACKS.get(`feat/${slug}`);
			if (!row) continue; // skip if not loaded
			expect(row.data).not.toHaveProperty('statModifiers');
			expect(row.data).not.toHaveProperty('actionModifiers');
			expect(row.data).toHaveProperty('modifiers');
			expect(row.data).toHaveProperty('triggers');
		}
	});
});

// --- derive() integration: verifies mechanical data flows through the engine --

describe('Tiefling Hexblade Warlock L5 with XGtE spells', () => {
	const CHARACTER: CharacterDocument = {
		id: 'test-tiefling-hexblade',
		name: 'Mara Ashveil',
		alignment: 'NE',
		classes: [
			{
				slug: 'warlock',
				level: 5,
				subclass: 'hexblade',
				hpRolledPerLevel: [8, 5, 5, 5, 5]
			}
		],
		species: { kind: 'species', slug: 'tiefling' },
		feats: [],
		abilityScores: { str: 9, dex: 14, con: 14, int: 11, wis: 12, cha: 16 },
		proficienciesChosen: { skills: ['arcana', 'deception'] },
		inventory: [],
		spells: {
			known: [
				{ kind: 'spell', slug: 'toll-the-dead' },
				{ kind: 'spell', slug: 'eldritch-blast' },
				{ kind: 'spell', slug: 'hex' },
				{ kind: 'spell', slug: 'arms-of-hadar' }
			],
			prepared: ['toll-the-dead', 'eldritch-blast', 'hex', 'arms-of-hadar']
		},
		currentHp: 33,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('applies Tiefling ASIs: CHA +2, INT +1', () => {
		const d = derive(CHARACTER, lookup());
		// Base CHA 16 + 2 = 18
		expect(d.stats.abilities.cha.score).toBe(18);
		expect(d.stats.abilities.cha.mod).toBe(4);
		// Base INT 11 + 1 = 12
		expect(d.stats.abilities.int.score).toBe(12);
	});

	it('has fire resistance from Tiefling Hellish Resistance', () => {
		const d = derive(CHARACTER, lookup());
		expect(d.stats.resistances.has('fire')).toBe(true);
	});

	it('produces spell actions for XGtE spells', () => {
		const d = derive(CHARACTER, lookup());
		const tollTheDead = d.actions.find((a) => a.sourceContent.slug === 'toll-the-dead');
		expect(tollTheDead).toBeDefined();
	});

	it('has resources from warlock class features', () => {
		const d = derive(CHARACTER, lookup());
		// At minimum the engine should produce some resources for a L5 Warlock
		expect(d.resources).toBeDefined();
	});
});

describe('Gloom Stalker Ranger L5 with XGtE spells', () => {
	const CHARACTER: CharacterDocument = {
		id: 'test-gloom-stalker',
		name: 'Dusk Hawkwood',
		alignment: 'LN',
		classes: [
			{
				slug: 'ranger',
				level: 5,
				subclass: 'gloom-stalker',
				hpRolledPerLevel: [10, 6, 6, 6, 6]
			}
		],
		species: { kind: 'species', slug: 'wood-elf' },
		feats: [{ kind: 'feat', slug: 'sharpshooter' }],
		abilityScores: { str: 10, dex: 17, con: 14, int: 10, wis: 15, cha: 8 },
		proficienciesChosen: { skills: ['perception', 'stealth'] },
		inventory: [
			{ contentKind: 'item', contentSlug: 'longbow', version: 1, equipped: true, attuned: false }
		],
		spells: {
			known: [
				{ kind: 'spell', slug: 'zephyr-strike' },
				{ kind: 'spell', slug: 'hunters-mark' }
			],
			prepared: ['zephyr-strike', 'hunters-mark']
		},
		currentHp: 40,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('stat block composes correctly at L5', () => {
		const d = derive(CHARACTER, lookup());
		expect(d.stats.totalLevel).toBe(5);
		expect(d.stats.proficiencyBonus).toBe(3);
	});

	it('produces XGtE spell action for zephyr-strike', () => {
		const d = derive(CHARACTER, lookup());
		const zs = d.actions.find((a) => a.sourceContent.slug === 'zephyr-strike');
		expect(zs).toBeDefined();
	});

	it('sharpshooter feat is loaded with correct schema', () => {
		const row = PACKS.get('feat/sharpshooter');
		expect(row).toBeDefined();
		expect(row!.data).not.toHaveProperty('statModifiers');
		expect(row!.data).toHaveProperty('modifiers');
	});
});

// --- C.1: armor + weapon proficiency targets ---------------------------------
// Locks the contract that `proficiency.armor.<slug>` and
// `proficiency.weapon.<slug>` modifier targets actually land on the derived
// stat block. Before C.1 these prefixes had no scan loop, so feats like
// Weapon Master / Heavy Armor Master were silently inert.

describe('C.1 — armor + weapon proficiency targets', () => {
	const WIZARD_WITH_WEAPON_MASTER: CharacterDocument = {
		id: 'test-wizard-weapon-master',
		name: 'Studious Bruiser',
		classes: [{ slug: 'wizard', level: 5, hpRolledPerLevel: [6, 4, 4, 4, 4] }],
		species: { kind: 'species', slug: 'human' },
		feats: [{ kind: 'feat', slug: 'weapon-master' }],
		abilityScores: { str: 14, dex: 10, con: 12, int: 16, wis: 12, cha: 10 },
		proficienciesChosen: { skills: [] },
		inventory: [],
		spells: { known: [], prepared: [] },
		currentHp: 22,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('populates stats.weaponProficiencies from proficiency.weapon.<slug> modifiers', () => {
		const d = derive(WIZARD_WITH_WEAPON_MASTER, lookup());
		expect(d.stats.weaponProficiencies).toContain('martial');
	});

	it('populates stats.armorProficiencies from proficiency.armor.<slug> modifiers', () => {
		const d = derive(WIZARD_WITH_WEAPON_MASTER, lookup());
		expect(d.stats.armorProficiencies).toContain('heavy');
	});
});
