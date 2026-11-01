// Wire shape of the party dashboard — the payload behind the spectator view
// (/watch/[token]) and the table view (/c/[code]/table). Built server-side by
// $lib/server/party-dashboard, always through the PLAYER lens: whoever asks,
// the payload carries only what a player in the campaign may see.

export interface DashboardSpellSlot {
  level: number;
  max: number;
  used: number;
}

export interface DashboardResource {
  id: string;
  name: string;
  current: number;
  max: number;
}

export interface DashboardItem {
  /** Display name only — never the item's description prose. */
  name: string;
  equipped: boolean;
  attuned: boolean;
  charges: number | null;
}

export interface DashboardPartyMember {
  id: string;
  name: string;
  portrait: string | null;
  /** "Fighter 3 / Wizard 1". */
  classLine: string;
  level: number;
  /** False for a stub character with no document yet — every stat below is
   *  null/empty in that case. */
  hasSheet: boolean;
  currentHp: number | null;
  maxHp: number | null;
  tempHp: number;
  ac: number | null;
  conditions: string[];
  concentrating: string | null;
  deathSaves: { successes: number; failures: number } | null;
  spellSlots: DashboardSpellSlot[];
  resources: DashboardResource[];
  inventory: DashboardItem[];
}

export interface DashboardCombatant {
  id: string;
  /** Player-visible label: the real name for PCs and identity-revealed
   *  creatures, "Enemy N" otherwise. */
  name: string;
  kind: string;
  characterId: string | null;
  initiative: number | null;
  /** Exact numbers only when a player may see them (PCs, vitals-revealed
   *  creatures); null otherwise — `hpBucket` is then the only HP signal. */
  currentHp: number | null;
  maxHp: number | null;
  tempHp: number;
  hpBucket: string;
  conditions: string[];
  concentrating: string | null;
}

export interface DashboardEncounter {
  id: string;
  name: string;
  status: string;
  round: number;
  activeParticipantId: string | null;
  combatants: DashboardCombatant[];
}

export interface TimelineEntry {
  id: string;
  /** ms since epoch. */
  at: number;
  /** 'combat' rows come from action_log. */
  source: 'combat';
  /** Character this entry is about (actor or target), for filtering. */
  characterIds: string[];
  /** Human-readable line, composed server-side from redacted fields. */
  summary: string;
  encounterName: string | null;
  round: number | null;
  hpBefore: number | null;
  hpAfter: number | null;
  /** At least one field was withheld from this viewer. */
  redacted: boolean;
}

/** Table view (DM) quick HP control, dispatched by PartyDashboard. Party
 *  members are addressed by character, combatants by participant. */
export interface AdjustEvent {
  target:
    | { kind: 'character'; id: string }
    | { kind: 'participant'; id: string; encounterId: string };
  mode: 'damage' | 'heal';
  amount: number;
}

export interface PartyDashboard {
  campaign: { name: string };
  party: DashboardPartyMember[];
  encounter: DashboardEncounter | null;
  log: TimelineEntry[];
}
