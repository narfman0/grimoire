// Save-DC extraction from statblock action prose.
//
// A monster's breath weapon spells out its own DC — "each creature in
// that area must make a DC 15 Dexterity saving throw" — but the DM was
// retyping it into the resolve panel every round, and every target's 🎲
// rolled a bare d20 with no modifier. Both halves of the data are
// already on the page; this is the parser that connects them.
//
// Pure: a string in, a {dc, ability} out. Deliberately conservative —
// an unrecognized phrasing yields null and the DM types the DC exactly
// as they do today.

import type { AbilityKey } from '$lib/rules/types';

const ABILITY_BY_NAME: Record<string, AbilityKey> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
  str: 'str',
  dex: 'dex',
  con: 'con',
  int: 'int',
  wis: 'wis',
  cha: 'cha'
};

/** Display names for the ability the save is against. */
export const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA'
};

export interface ParsedSave {
  dc: number;
  /** Null when the prose gives a DC but no ability we recognize — the DC
   *  is still worth pre-filling. */
  ability: AbilityKey | null;
}

/** Two orderings show up in printed statblocks and homebrew alike:
 *
 *    "must make a DC 15 Dexterity saving throw"
 *    "must succeed on a Dexterity saving throw (DC 15)"
 *
 *  plus the bare "DC 15 saving throw" with no ability named. */
const DC_THEN_ABILITY = /\bDC\s*(\d{1,2})\s+([A-Za-z]+)\s+saving\s+throw/i;
const ABILITY_THEN_DC = /\b([A-Za-z]+)\s+saving\s+throw[^.]{0,40}?\bDC\s*(\d{1,2})/i;
const BARE_DC = /\bDC\s*(\d{1,2})\b/i;

/** Parse the first save this text describes. Null when there's no DC.
 *
 *  First match wins: a multi-clause description ("DC 15 Dex save for half,
 *  then a DC 13 Con save") pre-fills the DC that comes first, which is the
 *  one the DM resolves first. */
export function parseSaveFromProse(text: string | null | undefined): ParsedSave | null {
  if (!text) return null;
  const forward = DC_THEN_ABILITY.exec(text);
  if (forward) {
    return { dc: Number(forward[1]), ability: abilityFrom(forward[2]) };
  }
  const backward = ABILITY_THEN_DC.exec(text);
  if (backward) {
    return { dc: Number(backward[2]), ability: abilityFrom(backward[1]) };
  }
  // "saving throw" with a DC somewhere in the sentence but in neither
  // shape — still worth the DC. Requires the phrase so a spell attack's
  // "DC 15" for something else doesn't masquerade as a save.
  if (/saving\s+throw/i.test(text)) {
    const bare = BARE_DC.exec(text);
    if (bare) return { dc: Number(bare[1]), ability: null };
  }
  return null;
}

function abilityFrom(word: string): AbilityKey | null {
  return ABILITY_BY_NAME[word.trim().toLowerCase()] ?? null;
}

/** Shape of a statblock action as far as this module cares. Structured
 *  fields win over prose: a homebrew row that states its DC outright
 *  shouldn't depend on how its description is phrased. */
export interface SaveBearingAction {
  description?: string;
  saveDC?: number;
  saveAbility?: string;
}

export function saveForAction(action: SaveBearingAction | null | undefined): ParsedSave | null {
  if (!action) return null;
  if (typeof action.saveDC === 'number' && Number.isFinite(action.saveDC)) {
    return {
      dc: Math.floor(action.saveDC),
      ability: action.saveAbility ? abilityFrom(action.saveAbility) : null
    };
  }
  return parseSaveFromProse(action.description);
}
