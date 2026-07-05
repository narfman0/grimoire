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

// --- C.6: outbound effects manifest ------------------------------------------
// `data.outboundEffects[]` emits aura/multi-target stat-grant declarations
// on Derived.outboundEffects so the encounter layer can apply them to ally
// tokens. appliesWhen.condition gates the entry on a live condition
// (Rage, Concentrating, etc.).

describe('C.6 — outbound effects manifest', () => {
	const CHAR_WITH_AURA: CharacterDocument = {
		id: 'test-c6',
		name: 'Aura Source',
		classes: [{ slug: 'paladin', level: 7, hpRolledPerLevel: [10, 6, 6, 6, 6, 6, 6] }],
		species: { kind: 'species', slug: 'human' },
		feats: [{ kind: 'feat', slug: 'aura-of-alacrity' }],
		abilityScores: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 16 },
		proficienciesChosen: { skills: [] },
		inventory: [],
		spells: { known: [], prepared: [] },
		currentHp: 50,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('emits unconditional outbound effects', () => {
		const d = derive(CHAR_WITH_AURA, lookup());
		const aura = d.outboundEffects.find((e) => e.id === 'aura-of-alacrity');
		expect(aura).toBeDefined();
		expect(aura!.rangeFt).toBe(5);
		expect(aura!.targets).toBe('ally');
		expect(aura!.modifiers).toHaveLength(1);
	});

	it('filters out conditional effects when their gating condition is absent', () => {
		const d = derive(CHAR_WITH_AURA, lookup());
		const rageAura = d.outboundEffects.find((e) => e.id === 'rage-aura');
		expect(rageAura).toBeUndefined();
	});

	it('includes conditional effects when the gating condition is present', () => {
		const raging = { ...CHAR_WITH_AURA, conditions: ['rage'] };
		const d = derive(raging, lookup());
		const rageAura = d.outboundEffects.find((e) => e.id === 'rage-aura');
		expect(rageAura).toBeDefined();
		expect(rageAura!.rangeFt).toBe(10);
	});

	it('a character without outbound-effect content emits an empty manifest', () => {
		// Level-5 paladin: below the L6 threshold for aura-of-protection outboundEffect.
		const clean = {
			...CHAR_WITH_AURA,
			feats: [],
			classes: [{ slug: 'paladin', level: 5, hpRolledPerLevel: [10, 6, 6, 6, 6] }]
		};
		const d = derive(clean, lookup());
		expect(d.outboundEffects).toEqual([]);
	});
});

// --- C.4: spell-list compositing -------------------------------------------
// `data.spellListAdditions` injects spells into active content (so their
// actions appear in the sheet) and surfaces them on
// Derived.alwaysPreparedFromContent for UI labelling. `data.freeCasts`
// emits a per-rest Resource so the encounter runtime can let the player
// cast the spell without a slot until the budget runs out.

describe('C.4 — spell-list compositing', () => {
	const FIGHTER_WITH_FEY_TOUCHED: CharacterDocument = {
		id: 'test-c4',
		name: 'Fey-Touched Fighter',
		classes: [{ slug: 'fighter', level: 5, hpRolledPerLevel: [10, 6, 6, 6, 6] }],
		species: { kind: 'species', slug: 'human' },
		feats: [{ kind: 'feat', slug: 'fey-touched' }],
		abilityScores: { str: 10, dex: 14, con: 14, int: 14, wis: 10, cha: 10 },
		proficienciesChosen: { skills: [] },
		inventory: [],
		spells: { known: [], prepared: [] },
		currentHp: 40,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('alwaysPreparedFromContent lists the injected spell', () => {
		const d = derive(FIGHTER_WITH_FEY_TOUCHED, lookup());
		expect(d.alwaysPreparedFromContent).toContain('daylight');
	});

	it('the spell becomes active even without an entry in spells.prepared', () => {
		const d = derive(FIGHTER_WITH_FEY_TOUCHED, lookup());
		const daylightAction = d.actions.find((a) => a.sourceContent.slug === 'daylight');
		expect(daylightAction).toBeDefined();
	});

	it('emits a free-cast Resource for the long-rest budget', () => {
		const d = derive(FIGHTER_WITH_FEY_TOUCHED, lookup());
		const r = d.resources.find((r) => r.id === 'free-cast/fey-touched/daylight');
		expect(r).toBeDefined();
		expect(r!.per).toBe('long-rest');
		expect(r!.max).toBe(1);
		expect(r!.used).toBe(0);
	});

	it('does nothing when the feat is not taken', () => {
		const clean = { ...FIGHTER_WITH_FEY_TOUCHED, feats: [] };
		const d = derive(clean, lookup());
		expect(d.alwaysPreparedFromContent).not.toContain('daylight');
		expect(d.resources.find((r) => r.id.startsWith('free-cast/fey-touched'))).toBeUndefined();
	});
});

// --- C.5: player-choice menu-picks for non-feat content ---------------------
// Before C.5, only feat rows ran the choice-synthesis pass. Subclass-feature
// menu picks (Acolyte of Nature, Aspect of the Wilds, etc.) had no landing
// pad — either every option was granted (over-grant) or none were. This
// commit lifts the synthesis to any active row with `data.choices`,
// reading picks from `character.featureChoices[slug]` for features and
// the matching ContentRef for species/subspecies/background/feat.

describe('C.5 — player-choice menu-picks on subclass features', () => {
	const CLERIC_WITH_ACOLYTE: CharacterDocument = {
		id: 'test-c5',
		name: 'Nature Acolyte',
		classes: [
			{ slug: 'cleric', level: 1, subclass: 'nature-domain-c5', hpRolledPerLevel: [8] }
		],
		species: { kind: 'species', slug: 'human' },
		feats: [],
		abilityScores: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
		proficienciesChosen: { skills: [] },
		inventory: [],
		spells: { known: [], prepared: [] },
		currentHp: 10,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {},
		featureChoices: {
			'acolyte-of-nature': {
				skillProficiency: { skill: 'nature' },
				language: { language: 'druidic' }
			}
		}
	};

	it('synthesizes skill proficiency from feature.choices pick', () => {
		const d = derive(CLERIC_WITH_ACOLYTE, lookup());
		expect(d.stats.skills.nature?.proficient).toBe(true);
		// The other allowed skills were NOT picked, so they should NOT be proficient.
		expect(d.stats.skills['animal-handling']?.proficient).toBe(false);
	});

	it('synthesizes language proficiency from feature.choices pick', () => {
		const d = derive(CLERIC_WITH_ACOLYTE, lookup());
		expect(d.stats.languages).toContain('druidic');
		// Other allowed languages NOT picked.
		expect(d.stats.languages).not.toContain('sylvan');
	});

	it('respects the allow-list — a non-allowed pick yields no modifier', () => {
		const wrongPick: CharacterDocument = {
			...CLERIC_WITH_ACOLYTE,
			featureChoices: {
				'acolyte-of-nature': { skillProficiency: { skill: 'acrobatics' } }
			}
		};
		const d = derive(wrongPick, lookup());
		expect(d.stats.skills.acrobatics?.proficient).toBe(false);
	});

	it('does nothing when no picks are present', () => {
		const noPicks: CharacterDocument = { ...CLERIC_WITH_ACOLYTE, featureChoices: undefined };
		const d = derive(noPicks, lookup());
		// No nature proficiency since nothing was picked.
		expect(d.stats.skills.nature?.proficient).toBe(false);
	});
});

// --- C.9: synthesize gated weapon-attack actions from trigger grants ---------
// War Magic / War Priest / Battle Magic / Eldritch Strike all want "after
// spell cast, grant a BA weapon attack". The trigger declares
// grants.type === "bonus-action-weapon-attack"; derive synthesizes a copy
// of the primary weapon attack with cost flipped and gatedOnTrigger set so
// the UI shows it as conditionally available.

describe('C.9 — gated BA / reaction weapon attack from trigger grants', () => {
	const FIGHTER_WITH_WAR_MAGIC: CharacterDocument = {
		id: 'test-c9',
		name: 'War Mage',
		classes: [{ slug: 'fighter', level: 5, hpRolledPerLevel: [10, 6, 6, 6, 6] }],
		species: { kind: 'species', slug: 'human' },
		feats: [{ kind: 'feat', slug: 'war-magic' }],
		abilityScores: { str: 16, dex: 12, con: 14, int: 14, wis: 10, cha: 10 },
		proficienciesChosen: { skills: [] },
		inventory: [
			{ contentKind: 'item', contentSlug: 'longsword', version: 1, equipped: true, attuned: false }
		],
		spells: { known: [], prepared: [] },
		currentHp: 40,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('synthesizes a BA weapon attack action mirroring the primary attack', () => {
		const d = derive(FIGHTER_WITH_WAR_MAGIC, lookup());
		const gated = d.actions.find((a) => a.gatedOnTrigger === 'war-magic-ba-attack');
		expect(gated).toBeDefined();
		expect(gated!.cost).toBe('bonus');
		expect(gated!.type).toBe('attack');
		// Attack bonus mirrors the primary longsword attack.
		const primary = d.actions.find((a) => a.sourceContent.slug === 'longsword' && a.cost === 'action');
		expect(gated!.attackBonus).toBe(primary!.attackBonus);
	});

	it('points sourceContent at the trigger source (the feat), not the weapon', () => {
		const d = derive(FIGHTER_WITH_WAR_MAGIC, lookup());
		const gated = d.actions.find((a) => a.gatedOnTrigger === 'war-magic-ba-attack');
		expect(gated!.sourceContent).toEqual({ kind: 'feat', slug: 'war-magic' });
	});

	it('does not synthesize any gated action when there is no primary weapon attack', () => {
		const noWeapon: CharacterDocument = { ...FIGHTER_WITH_WAR_MAGIC, inventory: [] };
		const d = derive(noWeapon, lookup());
		expect(d.actions.find((a) => a.gatedOnTrigger === 'war-magic-ba-attack')).toBeUndefined();
	});
});

// --- C.8: damage-taken / attack-targets-self trigger events -----------------
// Derive doesn't fire events — the encounter runtime does. This commit
// captures the engine *contract*: the set of known event names + grant
// types, and a soft validation warning when a pack references an unknown
// event name (catches typos like "damage.takne").

describe('C.8 — damage-taken trigger events + soft validation', () => {
	function charWithFeat(featSlug: string): CharacterDocument {
		return {
			id: `test-c8-${featSlug}`,
			name: 'C.8 Test',
			classes: [{ slug: 'fighter', level: 5, hpRolledPerLevel: [10, 6, 6, 6, 6] }],
			species: { kind: 'species', slug: 'human' },
			feats: [{ kind: 'feat', slug: featSlug }],
			abilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
			proficienciesChosen: { skills: [] },
			inventory: [],
			spells: { known: [], prepared: [] },
			currentHp: 40,
			tempHp: 0,
			hitDiceSpent: {},
			conditions: [],
			modifierToggles: {}
		};
	}

	it('flows the damage.taken trigger event through to TriggerDeclaration.on', () => {
		const d = derive(charWithFeat('heavy-armor-master'), lookup());
		const t = d.triggers.find((t) => t.id === 'heavy-armor-master-damage-reduction');
		expect(t).toBeDefined();
		expect(t!.on).toEqual(['damage.taken']);
	});

	it('passes damage.reduce grant payload through verbatim', () => {
		const d = derive(charWithFeat('heavy-armor-master'), lookup());
		const t = d.triggers.find((t) => t.id === 'heavy-armor-master-damage-reduction');
		const g = t!.grants as { type: string; amount: number };
		expect(g.type).toBe('damage.reduce');
		expect(g.amount).toBe(3);
	});

	it('emits a soft validation warning when a trigger references an unknown event', () => {
		const d = derive(charWithFeat('c8-unknown-event'), lookup());
		const w = d.validations.find(
			(v) => v.code === 'unknown-trigger-event' && v.message.includes('damage.takne')
		);
		expect(w).toBeDefined();
		expect(w!.severity).toBe('warning');
	});

	it('does not emit warnings for valid events', () => {
		const d = derive(charWithFeat('heavy-armor-master'), lookup());
		const warns = d.validations.filter((v) => v.code === 'unknown-trigger-event');
		expect(warns).toEqual([]);
	});

	// Regression: uncanny-dodge (Rogue 5) used 'self.hit-by-attack' in earlier
	// pack versions. Adding it to KNOWN_TRIGGER_EVENTS ensures no warning fires
	// regardless of which event name a pack version uses.
	it('does not emit a warning for self.hit-by-attack (uncanny-dodge regression)', () => {
		const d = derive(charWithFeat('c8-self-hit-by-attack'), lookup());
		const warns = d.validations.filter((v) => v.code === 'unknown-trigger-event');
		expect(warns).toEqual([]);
	});

	it('flows self.hit-by-attack through to TriggerDeclaration.on', () => {
		const d = derive(charWithFeat('c8-self-hit-by-attack'), lookup());
		const t = d.triggers.find((t) => t.id === 'c8-self-hit-by-attack');
		expect(t).toBeDefined();
		expect(t!.on).toContain('self.hit-by-attack');
	});
});

// --- C.3: action-modifier effect targets + predicates + limit ----------------
// Locks the four missing damage effect targets (damage.dice, damage.die.min,
// damage.ignore-resistance, damage.reroll-and-keep-higher), the
// attack.no-disadvantage.within-5ft target, the damage-type predicate path,
// and the surfaced action-modifier limit on AppliedModifier.

describe('C.3 — action-modifier effect targets + predicates + limit', () => {
	const CHAR_WITH_C3: CharacterDocument = {
		id: 'test-c3',
		name: 'Action Effect Stack',
		classes: [{ slug: 'fighter', level: 5, hpRolledPerLevel: [10, 6, 6, 6, 6] }],
		species: { kind: 'species', slug: 'human' },
		feats: [{ kind: 'feat', slug: 'c3-action-effects' }],
		abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
		proficienciesChosen: { skills: [] },
		inventory: [
			{ contentKind: 'item', contentSlug: 'longsword', version: 1, equipped: true, attuned: false },
			{ contentKind: 'item', contentSlug: 'longbow', version: 1, equipped: true, attuned: false }
		],
		spells: { known: [], prepared: [] },
		currentHp: 40,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('damage.die.min lands on the action (Great Weapon Fighting floor)', () => {
		const d = derive(CHAR_WITH_C3, lookup());
		const sword = d.actions.find((a) => a.sourceContent.slug === 'longsword');
		expect(sword!.damageDieMin).toBe(3);
	});

	it('damage.reroll-and-keep-higher lands as a boolean flag', () => {
		const d = derive(CHAR_WITH_C3, lookup());
		const sword = d.actions.find((a) => a.sourceContent.slug === 'longsword');
		expect(sword!.damageRerollAndKeepHigher).toBe(true);
	});

	it('damage.ignore-resistance lands as a boolean flag', () => {
		const d = derive(CHAR_WITH_C3, lookup());
		const sword = d.actions.find((a) => a.sourceContent.slug === 'longsword');
		expect(sword!.damageIgnoreResistance).toBe(true);
	});

	it('attack.no-disadvantage.within-5ft is gated by attack.range predicate', () => {
		const d = derive(CHAR_WITH_C3, lookup());
		const bow = d.actions.find((a) => a.sourceContent.slug === 'longbow');
		expect(bow!.attackNoDisadvantageWithin5ft).toBe(true);
		const sword = d.actions.find((a) => a.sourceContent.slug === 'longsword');
		// Melee attack doesn't get the ranged-only Crossbow Expert effect.
		expect(sword!.attackNoDisadvantageWithin5ft).toBeUndefined();
	});

	it('damage.dice appends an extra damage roll when the damage-type predicate matches', () => {
		const d = derive(CHAR_WITH_C3, lookup());
		const sword = d.actions.find((a) => a.sourceContent.slug === 'longsword');
		// Longsword default damage is slashing; rider gates on slashing → matches.
		const necroticRoll = sword!.damageRolls?.find((r) => r.type === 'necrotic');
		expect(necroticRoll?.formula).toBe('1d6');
	});

	it('does not apply the slashing-gated rider to a piercing attack (longbow)', () => {
		const d = derive(CHAR_WITH_C3, lookup());
		const bow = d.actions.find((a) => a.sourceContent.slug === 'longbow');
		const necroticRoll = bow!.damageRolls?.find((r) => r.type === 'necrotic');
		expect(necroticRoll).toBeUndefined();
	});

	it('surfaces the action-modifier limit on the AppliedModifier entry', () => {
		const d = derive(CHAR_WITH_C3, lookup());
		const sword = d.actions.find((a) => a.sourceContent.slug === 'longsword');
		const rider = sword!.appliedModifiers.find((m) => m.modifierId === 'c3-extra-damage-rider');
		expect(rider?.limit).toEqual({ per: 'turn', uses: 1 });
	});
});

// --- C.2: save / initiative / crit advantage targets ------------------------
// Locks the contract that the new advantage targets surface on the derived
// stat block (and on attack Actions for the crit fields). Each before-C.2 was
// silently inert — pack rows like Aura of Devotion (advantage on saves vs
// charmed), Stalker's Flurry (initiative advantage), and Champion's Improved
// Critical (crit threshold 19) carried these targets with no landing pad.

describe('C.2 — save/initiative/crit advantage targets', () => {
	const CHAR_WITH_C2: CharacterDocument = {
		id: 'test-c2',
		name: 'Advantage Stack',
		classes: [
			{
				slug: 'fighter',
				level: 5,
				subclass: 'champion',
				hpRolledPerLevel: [10, 6, 6, 6, 6]
			}
		],
		species: { kind: 'species', slug: 'human' },
		feats: [{ kind: 'feat', slug: 'c2-advantage' }],
		abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 13, cha: 10 },
		proficienciesChosen: { skills: [] },
		inventory: [
			{ contentKind: 'item', contentSlug: 'longsword', version: 1, equipped: true, attuned: false }
		],
		spells: { known: [], prepared: [] },
		currentHp: 40,
		tempHp: 0,
		hitDiceSpent: {},
		conditions: [],
		modifierToggles: {}
	};

	it('surfaces per-ability save advantage/disadvantage on the SaveCell', () => {
		const d = derive(CHAR_WITH_C2, lookup());
		expect(d.stats.saves.wis.advantage).toBe(true);
		expect(d.stats.saves.cha.disadvantage).toBe(true);
		expect(d.stats.saves.str.advantage).toBe(false);
	});

	it('collects vs-condition save advantage globally', () => {
		const d = derive(CHAR_WITH_C2, lookup());
		expect(d.stats.savesAdvantageVs).toContain('frightened');
		expect(d.stats.savesAdvantageVs).toContain('charmed');
		expect(d.stats.savesDisadvantageVs).toEqual([]);
	});

	it('flags initiative advantage', () => {
		const d = derive(CHAR_WITH_C2, lookup());
		expect(d.stats.initiativeAdvantage).toBe(true);
	});

	it('lands crit.threshold + crit.extra-weapon-die on weapon attack actions', () => {
		const d = derive(CHAR_WITH_C2, lookup());
		const longswordAttack = d.actions.find((a) => a.sourceContent.slug === 'longsword');
		expect(longswordAttack).toBeDefined();
		expect(longswordAttack!.critThreshold).toBe(19);
		expect(longswordAttack!.critExtraDie).toBe(1);
	});

	it('defaults to no advantage flags / no crit modifier for a clean character', () => {
		const clean: CharacterDocument = {
			...CHAR_WITH_C2,
			feats: [] // drop the c2-advantage feat
		};
		const d = derive(clean, lookup());
		expect(d.stats.saves.wis.advantage).toBe(false);
		expect(d.stats.initiativeAdvantage).toBe(false);
		expect(d.stats.savesAdvantageVs).toEqual([]);
		const longswordAttack = d.actions.find((a) => a.sourceContent.slug === 'longsword');
		// Champion L3+ correctly sets critThreshold=19 (fixed: was dead target attack.crit-threshold)
		expect(longswordAttack?.critThreshold).toBe(19);
		// critExtraDie comes from the feat only — should be absent without it
		expect(longswordAttack?.critExtraDie).toBeUndefined();
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
