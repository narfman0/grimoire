#!/usr/bin/env node
// One-shot Phase-2 hand-authoring script for content-packs/srd-5.2/spells.
// Adds activities[] / upcastScaling / scalesWithSlotLevel to a curated list
// of high-impact spells whose slug-stub rows shipped in Phase 1.
//
// Idempotent on already-mechanized rows: if a row already has
// `data.activities`, it's left alone. Re-running the script after a
// partial edit will skip those.
//
// Spell content is derived from RAW mechanical facts. Brief 'note'
// strings on each activity are short original mechanical summaries.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);
const PACK_DIR = join(REPO_ROOT, 'content-packs', 'srd-5.2', 'spells');

const dryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Authored mechanics — slug → activities[] (and optional `note` patch).
//
// Each entry produces ONE activities[0] populating the cast surface.
// scalesWithSlotLevel handles upcast variants.
// ---------------------------------------------------------------------------

const PATCHES = {
  // ---- 1st level ----
  bane: {
    activities: [
      {
        id: 'bane-cast',
        type: 'save',
        name: 'Bane',
        cost: 'action',
        save: { ability: 'cha', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 3 },
        scalesWithSlotLevel: { perSlotAbove: 1, addTargets: 1 },
        note: 'Up to three creatures (CHA save negates) subtract 1d4 from each attack roll and saving throw for the duration.'
      }
    ]
  },
  'charm-person': {
    activities: [
      {
        id: 'charm-person-cast',
        type: 'save',
        name: 'Charm Person',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 1 },
        scalesWithSlotLevel: { perSlotAbove: 1, addTargets: 1 },
        note: "Humanoid (WIS save negates, advantage if in combat). On a failure, target is charmed by the caster for 1 hour or until harmed."
      }
    ]
  },
  // ---- 2nd level ----
  'detect-thoughts': {
    activities: [
      {
        id: 'detect-thoughts-cast',
        type: 'save',
        name: 'Detect Thoughts',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 1 },
        note: 'Read surface thoughts of a creature within 30 ft. Probe deeper on a failed WIS save. Concentration, up to 1 minute.'
      }
    ]
  },
  'lesser-restoration': {
    activities: [
      {
        id: 'lesser-restoration-cast',
        type: 'utility',
        name: 'Lesser Restoration',
        cost: 'action',
        target: { affects: 'creature', count: 1 },
        note: 'End one disease, or one condition affecting the target: blinded, deafened, paralyzed, or poisoned.'
      }
    ]
  },
  'mirror-image': {
    activities: [
      {
        id: 'mirror-image-cast',
        type: 'utility',
        name: 'Mirror Image',
        cost: 'action',
        target: { affects: 'self' },
        note: 'Three illusory duplicates appear. Each time you are targeted by an attack, a duplicate is hit instead (AC 10 + DEX mod) until destroyed.'
      }
    ]
  },
  moonbeam: {
    activities: [
      {
        id: 'moonbeam-cast',
        type: 'save',
        name: 'Moonbeam',
        cost: 'action',
        save: { ability: 'con', dc: { calc: 'spell' } },
        damage: {
          parts: [{ dice: '2d10', type: 'radiant', halfOnSave: true }],
          scalesWithSlotLevel: { perSlotAbove: 2, addDice: '1d10' }
        },
        target: { affects: 'area', shape: 'cylinder', radius: 5, height: 40 },
        note: 'Creatures entering the cylinder or starting their turn there make a CON save; 2d10 radiant on failure, half on success. Shapechangers have disadvantage and revert.'
      }
    ]
  },
  'pass-without-trace': {
    activities: [
      {
        id: 'pass-without-trace-cast',
        type: 'utility',
        name: 'Pass Without Trace',
        cost: 'action',
        target: { affects: 'area', shape: 'radius', radius: 30 },
        note: 'You and allies within 30 ft gain +10 to Stealth checks and cannot be tracked except by magic. Concentration, up to 1 hour.'
      }
    ]
  },
  'see-invisibility': {
    activities: [
      {
        id: 'see-invisibility-cast',
        type: 'utility',
        name: 'See Invisibility',
        cost: 'action',
        target: { affects: 'self' },
        note: 'For 1 hour, you see invisible creatures and objects and into the Ethereal Plane.'
      }
    ]
  },
  suggestion: {
    activities: [
      {
        id: 'suggestion-cast',
        type: 'save',
        name: 'Suggestion',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 1 },
        note: 'Suggest a reasonable activity (1-2 sentences) to a target that can hear/understand you. WIS save negates; on failure, target pursues the activity for the duration (up to 8 hours). Concentration.'
      }
    ]
  },
  // ---- 3rd level ----
  'dispel-magic': {
    activities: [
      {
        id: 'dispel-magic-cast',
        type: 'utility',
        name: 'Dispel Magic',
        cost: 'action',
        target: { affects: 'creature', count: 1 },
        note: 'Target one creature/object/effect within 120 ft. End any spell of 3rd level or lower automatically. For higher levels, make a spellcasting check DC 10+spell level; success ends it.',
        scalesWithSlotLevel: { perSlotAbove: 3, addAutoDispelLevel: 1 }
      }
    ]
  },
  fear: {
    activities: [
      {
        id: 'fear-cast',
        type: 'save',
        name: 'Fear',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'area', shape: 'cone', length: 30 },
        note: 'Each creature in a 30-ft cone makes a WIS save. On a failure, drops what it holds and is frightened. While frightened, it must Dash away. Repeat save at end of each turn.'
      }
    ]
  },
  'guiding-bolt': {
    activities: [
      {
        id: 'guiding-bolt-cast',
        type: 'attack',
        name: 'Guiding Bolt',
        cost: 'action',
        attack: {
          ability: 'spellcasting',
          classification: 'spell',
          range: 'ranged',
          damage: [{ dice: '4d6', type: 'radiant' }]
        },
        damage: {
          parts: [{ dice: '4d6', type: 'radiant' }],
          scalesWithSlotLevel: { perSlotAbove: 1, addDice: '1d6' }
        },
        target: { affects: 'creature', count: 1 },
        note: 'On hit: 4d6 radiant. The next attack roll against the target before the end of your next turn has advantage.'
      }
    ]
  },
  'sleet-storm': {
    activities: [
      {
        id: 'sleet-storm-cast',
        type: 'save',
        name: 'Sleet Storm',
        cost: 'action',
        save: { ability: 'dex', dc: { calc: 'spell' } },
        target: { affects: 'area', shape: 'cylinder', radius: 20, height: 40 },
        note: 'Difficult terrain, heavily obscured. Open flames are doused. Creatures in the area make a DEX save on cast or fall prone. Concentrating creatures make a CON save or lose concentration.'
      }
    ]
  },
  slow: {
    activities: [
      {
        id: 'slow-cast',
        type: 'save',
        name: 'Slow',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'area', shape: 'cube', size: 40, count: 6 },
        note: 'Up to six creatures in a 40-ft cube (WIS save negates). Failed targets have speed halved, -2 AC and DEX saves, no reactions, and may take only one of action/bonus action per turn.'
      }
    ]
  },
  // ---- 4th level ----
  'phantasmal-killer': {
    activities: [
      {
        id: 'phantasmal-killer-cast',
        type: 'save',
        name: 'Phantasmal Killer',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        damage: {
          parts: [{ dice: '4d10', type: 'psychic' }],
          scalesWithSlotLevel: { perSlotAbove: 4, addDice: '1d10' }
        },
        target: { affects: 'creature', count: 1 },
        note: 'Target makes a WIS save or becomes frightened. While frightened, it makes another WIS save at end of each turn; on failure takes 4d10 psychic.'
      }
    ]
  },
  // ---- 5th level ----
  'arcane-hand': {
    activities: [
      {
        id: 'arcane-hand-cast',
        type: 'attack',
        name: "Arcane Hand (Bigby's Hand)",
        cost: 'action',
        attack: {
          ability: 'spellcasting',
          classification: 'spell',
          range: 'ranged',
          damage: [{ dice: '4d8', type: 'force' }]
        },
        damage: {
          parts: [{ dice: '4d8', type: 'force' }],
          scalesWithSlotLevel: { perSlotAbove: 5, addDice: '2d8' }
        },
        target: { affects: 'creature', count: 1 },
        note: 'Conjure a Large hand. Bonus action to direct: Clenched Fist (4d8 force on hit), Forceful Hand (push/shove), Grasping Hand (grapple), Interposing Hand (half cover).'
      }
    ]
  },
  'dominate-person': {
    activities: [
      {
        id: 'dominate-person-cast',
        type: 'save',
        name: 'Dominate Person',
        cost: 'action',
        save: { ability: 'wis', dc: { calc: 'spell' } },
        target: { affects: 'creature', count: 1 },
        note: 'Humanoid target (WIS save negates). On failure, charmed and you can telepathically command. Target re-saves whenever it takes damage. Concentration, up to 1 minute (longer with higher slots).',
        scalesWithSlotLevel: { perSlotAbove: 5, addDurationStep: 1 }
      }
    ]
  },
  'flame-strike': {
    activities: [
      {
        id: 'flame-strike-cast',
        type: 'save',
        name: 'Flame Strike',
        cost: 'action',
        save: { ability: 'dex', dc: { calc: 'spell' } },
        damage: {
          parts: [
            { dice: '4d6', type: 'fire', halfOnSave: true },
            { dice: '4d6', type: 'radiant', halfOnSave: true }
          ],
          scalesWithSlotLevel: { perSlotAbove: 5, addDice: '1d6', addDiceType: 'split' }
        },
        target: { affects: 'area', shape: 'cylinder', radius: 10, height: 40 },
        note: 'DEX save: 4d6 fire + 4d6 radiant, half on success. Upcast: +1d6 of each per slot above 5th.'
      }
    ]
  },
  'greater-restoration': {
    activities: [
      {
        id: 'greater-restoration-cast',
        type: 'utility',
        name: 'Greater Restoration',
        cost: 'action',
        target: { affects: 'creature', count: 1 },
        note: 'Reduce target’s exhaustion by one, OR end charmed/petrified/cursed, one reduction to ability/HP max, or any spell with that effect.'
      }
    ]
  },
  // ---- 6th level ----
  // ---- 9th level ----
  'true-resurrection': {
    activities: [
      {
        id: 'true-resurrection-cast',
        type: 'utility',
        name: 'True Resurrection',
        cost: '1 hour',
        target: { affects: 'creature', count: 1 },
        note: 'Restore life to a creature dead up to 200 years. Closes all wounds, restores missing body parts, cures all diseases/poisons and conditions.'
      }
    ]
  },
  'power-word-kill': {
    activities: [
      {
        id: 'power-word-kill-cast',
        type: 'utility',
        name: 'Power Word Kill',
        cost: 'action',
        target: { affects: 'creature', count: 1 },
        note: 'Target one creature you can see within 60 ft. If it has 100 hit points or fewer, it dies. Otherwise no effect.'
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
