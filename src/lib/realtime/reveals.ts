// DM secrecy / reveals model. Per-participant flags persisted in
// participants.reveals_json. Server load layers (encounter page + character
// planner) consume parseReveals() and project the participant shape into a
// redacted form for non-DM viewers. The DM UI uses these helpers too to
// render reveal-chip toggles.
//
// See docs in /home/narfman0/.claude/plans/zippy-wishing-kahn.md for the
// scope decisions (three coarse buckets, hidden flag, default-all-false for
// non-PCs, default-all-true for PCs).

export interface ParticipantReveals {
  /** Real creature name + kind/type. */
  identity: boolean;
  /** Exact HP numbers + AC. (HP bucket is always shown regardless.) */
  vitals: boolean;
  /** Stat block expansion: attacks, traits, abilities, resistances, description. */
  combat: boolean;
  /** Entirely suppress this participant from the player view (slot disappears). */
  hidden: boolean;
}

export const PC_DEFAULT_REVEALS: ParticipantReveals = {
  identity: true,
  vitals: true,
  combat: true,
  hidden: false
};

export const NPC_DEFAULT_REVEALS: ParticipantReveals = {
  identity: false,
  vitals: false,
  combat: false,
  hidden: false
};

export function defaultRevealsFor(kind: string): ParticipantReveals {
  return kind === 'pc' ? PC_DEFAULT_REVEALS : NPC_DEFAULT_REVEALS;
}

export function parseReveals(json: string | null | undefined): ParticipantReveals {
  if (!json) return NPC_DEFAULT_REVEALS;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    return {
      identity: obj.identity === true,
      vitals: obj.vitals === true,
      combat: obj.combat === true,
      hidden: obj.hidden === true
    };
  } catch {
    return NPC_DEFAULT_REVEALS;
  }
}

export type HpBucket = 'healthy' | 'wounded' | 'bloodied' | 'critical' | 'defeated' | 'unknown';

/** Coarse HP visibility for players whose `vitals` flag is false. Always
 *  computed for both DM and player; DM also sees the exact number. */
export function hpBucket(
  cur: number | null | undefined,
  max: number | null | undefined
): HpBucket {
  if (cur == null || max == null || max <= 0) return 'unknown';
  if (cur <= 0) return 'defeated';
  const pct = cur / max;
  if (pct <= 0.25) return 'critical';
  if (pct <= 0.5) return 'bloodied';
  if (pct < 1) return 'wounded';
  return 'healthy';
}

export const HP_BUCKET_LABELS: Record<HpBucket, string> = {
  healthy: 'Healthy',
  wounded: 'Wounded',
  bloodied: 'Bloodied',
  critical: 'Critical',
  defeated: 'Defeated',
  unknown: 'Unknown'
};
