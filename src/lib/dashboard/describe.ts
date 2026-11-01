// One-line text for a combat (action_log) entry. Pure and isomorphic. Takes
// fields that have ALREADY been through redaction ($lib/realtime/action-log)
// and labels that are already player-visible — it composes, it never decides
// what may be shown.

export interface CombatLine {
  actor: string | null;
  target: string | null;
  actionLabel: string;
  hit: string | null;
  damageRoll: number | null;
}

const HIT_WORDS: Record<string, string> = {
  hit: 'hit',
  miss: 'miss',
  crit: 'critical hit',
  fumble: 'fumble'
};

export function describeCombatEntry(e: CombatLine): string {
  let out = e.actor ? `${e.actor}: ${e.actionLabel}` : e.actionLabel;
  if (e.target) out += ` → ${e.target}`;
  const bits: string[] = [];
  if (e.hit) bits.push(HIT_WORDS[e.hit] ?? e.hit);
  if (e.damageRoll != null) bits.push(`${e.damageRoll} dmg`);
  if (bits.length > 0) out += ` (${bits.join(', ')})`;
  return out;
}
