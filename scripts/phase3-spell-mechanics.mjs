#!/usr/bin/env node
// Phase-3 opportunistic backfill — adds activities[] to additional
// pack-note-referenced spells. Targets the long tail of spells called
// out across grimoire-packs subclass spellListAdditions notes (plant-
// growth, dominate-beast, protection-from-energy, blink, daylight,
// command, freedom-of-movement, calm-emotions, hideous-laughter,
// stoneskin, sending, seeming, scrying, commune-with-nature, tree-
// stride, flaming-sphere, darkness, magic-weapon, speak-with-animals,
// ice-storm, gaseous-form, arcane-eye).
//
// Same shape as scripts/phase2-spell-mechanics.mjs:
//   - idempotent on rows that already have activities[]
//   - patches in mechanical 'note' strings (short original summaries)
//   - --dry-run to preview.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);
const PACK_DIR = join(REPO_ROOT, 'content-packs', 'srd-5.2', 'spells');

const dryRun = process.argv.includes('--dry-run');

const PATCHES = {
  // ---- 1st level ----
  command: {
    activities: [
      {
        id: 'command-cast',
        type: 'save',
        name: 'Command',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 1 },
        scalesWithSlotLevel: { perSlotAbove: 1, addTargets: 1 },
        note: 'Speak a one-word command. WIS save negates; on failure target follows the order on its next turn (approach, drop, flee, grovel, halt).'
      }
    ]
  },
  'hideous-laughter': {
    activities: [
      {
        id: 'hideous-laughter-cast',
        type: 'save',
        name: 'Hideous Laughter',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 1 },
        note: 'WIS save negates; on failure target falls prone, becomes incapacitated, unable to stand for the duration. Re-save at end of each turn (advantage if damaged this turn). Creatures w/o INT 5+ are unaffected.'
      }
    ]
  },
  'speak-with-animals': {
    activities: [
      {
        id: 'speak-with-animals-cast',
        type: 'utility',
        name: 'Speak with Animals',
        cost: 'action',
        target: { affects: 'self' },
        note: "Communicate with beasts for 10 minutes. GM determines depth of interaction based on the animal's intelligence."
      }
    ]
  },
  // ---- 2nd level ----
  'calm-emotions': {
    activities: [
      {
        id: 'calm-emotions-cast',
        type: 'save',
        name: 'Calm Emotions',
        cost: 'action',
        save: { ability: 'cha', dc: { calc: 'spell' } },
        target: { affects: 'area', shape: 'radius', radius: 20 },
        note: 'Humanoids in a 20-ft radius (CHA save negates). Choose: suppress charmed/frightened, OR render apathetic (no attacks unless attacked). Concentration, 1 minute.'
      }
    ]
  },
  darkness: {
    activities: [
      {
        id: 'darkness-cast',
        type: 'utility',
        name: 'Darkness',
        cost: 'action',
        target: { affects: 'area', shape: 'radius', radius: 15 },
        note: 'A 15-ft radius sphere of magical darkness. Even darkvision cannot see through it. Concentration, up to 10 minutes.'
      }
    ]
  },
  'flaming-sphere': {
    activities: [
      {
        id: 'flaming-sphere-cast',
        type: 'save',
        name: 'Flaming Sphere',
        cost: 'action',
        save: { ability: 'dex', dc: { calc: 'spell' } },
        damage: {
          parts: [{ dice: '2d6', type: 'fire', halfOnSave: true }],
          scalesWithSlotLevel: { perSlotAbove: 2, addDice: '1d6' }
        },
        target: { affects: 'creature', count: 1 },
        note: 'Conjure a 5-ft sphere. Ram a creature (DEX save: 2d6 fire, half on success). Bonus action to move 30 ft. Concentration, 1 minute.'
      }
    ]
  },
  'magic-weapon': {
    activities: [
      {
        id: 'magic-weapon-cast',
        type: 'utility',
        name: 'Magic Weapon',
        cost: 'bonus',
        target: { affects: 'creature', count: 1 },
        scalesWithSlotLevel: { perSlotAbove: 2, addBonusStep: 1 },
        note: 'Touch a nonmagical weapon. It becomes magical with +1 to attack/damage rolls (upcast: +2 at 4th, +3 at 6th). Concentration, 1 hour.'
      }
    ]
  },
  // ---- 3rd level ----
  blink: {
    activities: [
      {
        id: 'blink-cast',
        type: 'utility',
        name: 'Blink',
        cost: 'action',
        target: { affects: 'self' },
        note: 'At end of each turn, roll 1d20. On 11+, vanish into the Ethereal Plane until start of next turn. Reappear in an empty space within 10 ft. Duration: 1 minute (no concentration).'
      }
    ]
  },
  daylight: {
    activities: [
      {
        id: 'daylight-cast',
        type: 'utility',
        name: 'Daylight',
        cost: 'action',
        target: { affects: 'area', shape: 'radius', radius: 60 },
        note: 'A point sheds bright light in 60-ft radius and dim light 60 ft further. Counts as sunlight. Suppressed by darkness of higher level. Duration: 1 hour.'
      }
    ]
  },
  'gaseous-form': {
    activities: [
      {
        id: 'gaseous-form-cast',
        type: 'utility',
        name: 'Gaseous Form',
        cost: 'action',
        target: { affects: 'creature', count: 1 },
        note: 'Target becomes a misty cloud (10 ft fly speed, can pass through openings). Resistance to nonmagical damage, advantage on STR/DEX/CON saves, immune to nonmagical weapons. Concentration, 1 hour.'
      }
    ]
  },
  'plant-growth': {
    activities: [
      {
        id: 'plant-growth-cast',
        type: 'utility',
        name: 'Plant Growth',
        cost: 'action',
        target: { affects: 'area', shape: 'radius', radius: 100 },
        note: 'Two modes. Action: enrich a 1/2-mile-radius area for one year (2x crop yield). 1 minute: overgrow a 100-ft radius — difficult terrain, costs 4x movement, lasts indefinitely.'
      }
    ]
  },
  'protection-from-energy': {
    activities: [
      {
        id: 'protection-from-energy-cast',
        type: 'utility',
        name: 'Protection from Energy',
        cost: 'action',
        target: { affects: 'creature', count: 1 },
        note: 'Target gains resistance to one damage type (acid, cold, fire, lightning, or thunder) of your choice. Concentration, 1 hour.'
      }
    ]
  },
  sending: {
    activities: [
      {
        id: 'sending-cast',
        type: 'utility',
        name: 'Sending',
        cost: 'action',
        target: { affects: 'creature', count: 1 },
        note: 'Send a 25-word message to a creature you know. They receive it and may reply (also 25 words). Range: any distance, including other planes (chance to fail across planes).'
      }
    ]
  },
  // ---- 4th level ----
  'arcane-eye': {
    activities: [
      {
        id: 'arcane-eye-cast',
        type: 'utility',
        name: 'Arcane Eye',
        cost: 'action',
        target: { affects: 'self' },
        note: 'Create an invisible magical eye that you can see through (darkvision 30 ft). Action to move it up to 30 ft in any direction. Concentration, 1 hour.'
      }
    ]
  },
  'dominate-beast': {
    activities: [
      {
        id: 'dominate-beast-cast',
        type: 'save',
        name: 'Dominate Beast',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 1 },
        scalesWithSlotLevel: { perSlotAbove: 4, addDurationStep: 1 },
        note: 'Beast target (WIS save negates). On failure, charmed and you may telepathically command. Target re-saves when damaged. Concentration, 1 minute (longer with upcast).'
      }
    ]
  },
  'freedom-of-movement': {
    activities: [
      {
        id: 'freedom-of-movement-cast',
        type: 'utility',
        name: 'Freedom of Movement',
        cost: 'action',
        target: { affects: 'creature', count: 1 },
        note: "Target's movement is unimpeded by difficult terrain, magical effects that reduce speed, paralysis, or restraints. Underwater movement at normal speed. Duration: 1 hour."
      }
    ]
  },
  'ice-storm': {
    activities: [
      {
        id: 'ice-storm-cast',
        type: 'save',
        name: 'Ice Storm',
        cost: 'action',
        save: { ability: 'dex', dc: { calc: 'spell' } },
        damage: {
          parts: [
            { dice: '2d8', type: 'bludgeoning', halfOnSave: true },
            { dice: '4d6', type: 'cold', halfOnSave: true }
          ],
          scalesWithSlotLevel: { perSlotAbove: 4, addDice: '1d8', addDiceType: 'bludgeoning' }
        },
        target: { affects: 'area', shape: 'cylinder', radius: 20, height: 40 },
        note: 'Each creature in cylinder: DEX save. On failure 2d8 bludgeoning + 4d6 cold (half on success). Area becomes difficult terrain.'
      }
    ]
  },
  stoneskin: {
    activities: [
      {
        id: 'stoneskin-cast',
        type: 'utility',
        name: 'Stoneskin',
        cost: 'action',
        target: { affects: 'creature', count: 1 },
        note: 'Target gains resistance to nonmagical bludgeoning, piercing, and slashing damage. Material: 100 gp diamond dust. Concentration, 1 hour.'
      }
    ]
  },
  // ---- 5th level ----
  'commune-with-nature': {
    activities: [
      {
        id: 'commune-with-nature-cast',
        type: 'utility',
        name: 'Commune with Nature',
        cost: '1 minute',
        target: { affects: 'self' },
        note: 'Become aware of nature within 3 miles (or 300 ft underground). Learn up to three facts about terrain/bodies of water/plants/creatures/buildings/celestial bodies. Cannot be cast indoors.'
      }
    ]
  },
  scrying: {
    activities: [
      {
        id: 'scrying-cast',
        type: 'save',
        name: 'Scrying',
        cost: '10 minutes',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 1 },
        note: 'Choose a creature; it makes a WIS save (modifier based on familiarity). On failure, a sensor lets you see/hear from its location for the duration. Concentration, 10 minutes.'
      }
    ]
  },
  seeming: {
    activities: [
      {
        id: 'seeming-cast',
        type: 'save',
        name: 'Seeming',
        cost: 'action',
        save: { ability: 'cha', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 1 },
        note: 'Disguise any number of willing creatures (visual illusion only). Unwilling creatures get a CHA save. Physical interaction reveals it. Lasts 8 hours.'
      }
    ]
  },
  'tree-stride': {
    activities: [
      {
        id: 'tree-stride-cast',
        type: 'utility',
        name: 'Tree Stride',
        cost: 'action',
        target: { affects: 'self' },
        note: 'Once per turn, use 5 ft of movement to step into a living tree and emerge from a tree of the same kind within 500 ft. Concentration, 1 minute.'
      }
    ]
  }
};

// ---------------------------------------------------------------------------

const files = readdirSync(PACK_DIR).filter((f) => f.endsWith('.json'));
let patched = 0;
let skipped = 0;
const notFound = new Set(Object.keys(PATCHES));

for (const f of files) {
  const fpath = join(PACK_DIR, f);
  const arr = JSON.parse(readFileSync(fpath, 'utf8'));
  let dirty = false;
  for (const row of arr) {
    const patch = PATCHES[row.slug];
    if (!patch) continue;
    notFound.delete(row.slug);
    if (Array.isArray(row.data?.activities) && row.data.activities.length > 0) {
      skipped++;
      console.log(`  skip ${row.slug} (already has activities)`);
      continue;
    }
    row.data.activities = patch.activities;
    dirty = true;
    patched++;
    console.log(`  patch ${row.slug} → ${patch.activities.length} activity`);
  }
  if (dirty && !dryRun) {
    writeFileSync(fpath, JSON.stringify(arr, null, 2) + '\n');
  }
}

console.log('');
console.log(`Patched: ${patched}`);
console.log(`Skipped (already mechanized): ${skipped}`);
if (notFound.size > 0) {
  console.log(`Not found in pack: ${[...notFound].join(', ')}`);
}
if (dryRun) console.log('\n--dry-run: no files written.');
