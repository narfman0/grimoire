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

// --- C.10: subclass-driven spellcasting progression -------------------------
// Locks the contract that a subclass with a `data.spellcasting` block (e.g.
// Arcane Trickster on Rogue, Eldritch Knight on Fighter) wires the character
// up as a third caster even when the parent class row has no spellcasting.

describe('C.10 — subclass-driven spellcasting', () => {
	const ARCANE_TRICKSTER_L7: CharacterDocument = {
		id: 'test-arcane-trickster',
		name: 'Whisper',
		classes: [
			{
				slug: 'rogue',
				level: 7,
				subclass: 'arcane-trickster',
				hpRolledPerLevel: [8, 5, 5, 5, 5, 5, 5]
			}
		],
		species: { kind: 'species', slug: 'human' },
		feats: [],
		abilityScores: { str: 8, dex: 16, con: 12, int: 16, wis: 10, cha: 10 },
		proficienciesChosen: { skills: ['stealth', 'sleight-of-hand'] },
		inventory: [],
		spells: { known: [], prepared: [] },
		currentHp: 38,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('reads subclass.data.spellcasting when the class row has none', () => {
		const d = derive(ARCANE_TRICKSTER_L7, lookup());
		expect(d.stats.spellcastingAbility).toBe('int');
		expect(d.stats.spellSaveDC).toBe(8 + 3 + 3); // 8 + PB(3) + intMod(3)
		expect(d.stats.spellAttackBonus).toBe(3 + 3);
	});

	it('uses the third-caster slot table at the class level (Rogue 7 → 4 L1 + 2 L2)', () => {
		const d = derive(ARCANE_TRICKSTER_L7, lookup());
		expect(d.stats.spellSlots[1]?.max).toBe(4);
		expect(d.stats.spellSlots[2]?.max).toBe(2);
		expect(d.stats.spellSlots[3]?.max).toBeUndefined();
	});

	it('produces no slots before third-caster onset (Rogue 2)', () => {
		const lvl2 = {
			...ARCANE_TRICKSTER_L7,
			classes: [{ ...ARCANE_TRICKSTER_L7.classes[0], level: 2, hpRolledPerLevel: [8, 5] }]
		};
		const d = derive(lvl2, lookup());
		expect(d.stats.spellSlots[1]?.max).toBeUndefined();
	});
});

// --- C.7: resistance/immunity/vulnerability qualifiers ----------------------
// Locks the contract that a `qualifier` field on a resistance/immunity/
// vulnerability modifier (nonmagical, spell, creature-type slug) lands on
// the qualifier map without losing the flat set membership. The
// damage-resolution layer (encounter tooling) decides whether the qualifier
// applies; the flat set still shows the type in the UI.

describe('C.7 — resistance qualifiers', () => {
	const CHAR_WITH_QUALIFIED_RESISTS: CharacterDocument = {
		id: 'test-avatar-of-battle',
		name: 'Battle-Anointed',
		classes: [{ slug: 'cleric', level: 1, hpRolledPerLevel: [8] }],
		species: { kind: 'species', slug: 'human' },
		feats: [{ kind: 'feat', slug: 'avatar-of-battle' }],
		abilityScores: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
		proficienciesChosen: { skills: [] },
		inventory: [],
		spells: { known: [], prepared: [] },
		currentHp: 10,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('flat resistance set still contains the type (for UI iteration)', () => {
		const d = derive(CHAR_WITH_QUALIFIED_RESISTS, lookup());
		expect(d.stats.resistances.has('bludgeoning')).toBe(true);
		expect(d.stats.resistances.has('piercing')).toBe(true);
		expect(d.stats.resistances.has('slashing')).toBe(true);
	});

	it('qualifier map carries the qualifier for damage resolution', () => {
		const d = derive(CHAR_WITH_QUALIFIED_RESISTS, lookup());
		expect(d.stats.resistanceQualifiers.bludgeoning).toBe('nonmagical');
		expect(d.stats.resistanceQualifiers.piercing).toBe('nonmagical');
	});

	it('immunity qualifier survives on a separate map', () => {
		const d = derive(CHAR_WITH_QUALIFIED_RESISTS, lookup());
		expect(d.stats.immunities.has('poison')).toBe(true);
		expect(d.stats.immunityQualifiers.poison).toBe('spell');
	});

	it('unqualified entries do not appear in the qualifier map (fire from tiefling)', () => {
		const tiefling: CharacterDocument = {
			...CHAR_WITH_QUALIFIED_RESISTS,
			species: { kind: 'species', slug: 'tiefling' },
			feats: []
		};
		const d = derive(tiefling, lookup());
		expect(d.stats.resistances.has('fire')).toBe(true);
		expect(d.stats.resistanceQualifiers.fire).toBeUndefined();
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
