// Party fixture roster. Both the test suite and the sheet preview pages
// import from here. The two characters together exercise most of the
// rules-engine surface and span both packs (SRD + grimoire-packs).

import type { CharacterDocument } from '$lib/rules/types';
import { CHARACTER as HALF_ORC } from './half-orc-zealot-barbarian';
import { CHARACTER as TORTLE } from './tortle-chronurgy-wizard';

export const PARTY: Record<string, { slug: string; character: CharacterDocument; label: string }> = {
  'half-orc-zealot-barbarian': {
    slug: 'half-orc-zealot-barbarian',
    character: HALF_ORC,
    label: 'Vorm — Half-Orc Path of the Zealot Barbarian L3'
  },
  'tortle-chronurgy-wizard': {
    slug: 'tortle-chronurgy-wizard',
    character: TORTLE,
    label: "Ray'Quasar — Tortle Chronurgy Magic Wizard 10"
  }
};

export type PartySlug = keyof typeof PARTY;
