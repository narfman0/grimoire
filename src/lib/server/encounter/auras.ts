// Encounter outbound-effects (aura) consumer. Pure function: given a
// target participant and the set of aura sources in the encounter,
// returns the aura applications that affect the target.
//
// Resolution of modifier values (chaMod, proficiencyBonus, etc.) is the
// caller's responsibility — outbound modifier values are intentionally
// preserved as tokens at derive() time so the consumer can decide
// whether each token resolves against the source's context (Aura of
// Protection: source paladin's CHA) or the target's context
// (Sentinel-style: target's proficiencyBonus). The encounter layer
// makes that call and routes the resolved modifier into the target's
// stat-modifier pipeline.
//
// Range checks use Chebyshev (chess-king) distance × 5 ft per square,
// matching 5e grid conventions. When either participant has no
// position, the range check is skipped (treated as in-range) so that
// theater-of-the-mind play still gets faction-correct aura behavior.

import type { OutboundEffect } from '$lib/rules/types';

export interface GridPosition {
  x: number;
  y: number;
}

export interface AuraSource {
  participantId: string;
  /** Faction identifier — same value across allies, different across
   *  enemies. The encounter caller decides what populates this; v0
   *  expects 'pc' / 'monsters' / etc. */
  factionId: string;
  position?: GridPosition;
  /** Whether the source is alive (currentHp > 0 and not unconscious).
   *  Required for `requiresAlive` aura gating. Treated as `true` when
   *  omitted so callers that don't track HP still get reasonable
   *  defaults. */
  isAlive?: boolean;
  /** Conditions currently active on the source. Required for
   *  `appliesWhen.condition` gating. */
  conditions?: string[];
  outboundEffects: OutboundEffect[];
}

export interface AuraTarget {
  participantId: string;
  factionId: string;
  position?: GridPosition;
}

export interface AuraApplication {
  sourceParticipantId: string;
  sourceContent: { kind: string; slug: string };
  auraId: string;
  auraName: string;
  /** Raw modifier rows from the aura. Values may contain unresolved
   *  tokens — the caller resolves them against source or target context
   *  as appropriate for the modifier shape. */
  modifiers: Array<Record<string, unknown>>;
}

/** Collect every aura application affecting `target` from `sources`.
 *  Pure: no side effects, no I/O. */
export function collectAurasFor(target: AuraTarget, sources: AuraSource[]): AuraApplication[] {
  const out: AuraApplication[] = [];
  for (const src of sources) {
    for (const aura of src.outboundEffects) {
      if (!auraApplies(src, aura, target)) continue;
      if (!Array.isArray(aura.modifiers) || aura.modifiers.length === 0) continue;
      out.push({
        sourceParticipantId: src.participantId,
        sourceContent: aura.sourceContent,
        auraId: aura.id,
        auraName: aura.name,
        modifiers: aura.modifiers
      });
    }
  }
  return out;
}

function auraApplies(src: AuraSource, aura: OutboundEffect, target: AuraTarget): boolean {
  // requiresAlive: aura suppressed when source is unconscious / dead.
  if (aura.requiresAlive && src.isAlive === false) return false;
  // appliesWhen.condition: source must currently have the condition.
  if (aura.appliesWhen?.condition && !src.conditions?.includes(aura.appliesWhen.condition)) {
    return false;
  }
  // Faction / self gating per aura.targets.
  switch (aura.targets) {
    case 'self':
      if (src.participantId !== target.participantId) return false;
      break;
    case 'ally':
      if (src.factionId !== target.factionId) return false;
      if (aura.excludeSelf && src.participantId === target.participantId) return false;
      break;
    case 'enemy':
      if (src.factionId === target.factionId) return false;
      break;
    case 'creature':
      if (aura.excludeSelf && src.participantId === target.participantId) return false;
      break;
    default:
      // Unknown targets value — fail-closed.
      return false;
  }
  // Range check. Skipped when either position is missing (theater-of-the-mind).
  if (src.position && target.position) {
    if (chebyshevDistanceFt(src.position, target.position) > aura.rangeFt) return false;
  }
  return true;
}

function chebyshevDistanceFt(a: GridPosition, b: GridPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
}
