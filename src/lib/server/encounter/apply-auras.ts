// Outbound-effects consumer. Builds an overlay of aura-sourced
// modifiers that an encounter caller can fold into a target's effective
// stats. Wraps `collectAurasFor` (which returns the raw aura
// applications) and resolves the modifier value tokens that auras
// commonly carry (`'chaMod'`, `'proficiencyBonus'`, etc.) against the
// source's resolution context.
//
// The encounter page is the intended consumer: when it wants to render
// a target participant's effective AC / saves / skills it walks every
// other participant's `outboundEffects`, calls `applyAuras(target,
// sources)`, and adds the returned overlay onto the base derived
// numbers. derive() itself does NOT consume auras — sheet-time stats
// are inherent to the character; aura overlays are encounter-time.
//
// Modifier resolution scope: aura modifier rows are passed through
// `derive()` at the source's sheet-time, so the modifier `value` is
// usually a literal number that derive() already resolved. The
// fallback handling here covers the legacy token form (`'chaMod'`,
// etc.) that some pack rows still author — we resolve those against
// the source's stat block when the caller provides it.

import type { StatBlock } from '$lib/rules/types';
import {
  collectAurasFor,
  type AuraSource,
  type AuraTarget,
  type AuraApplication,
  type GridPosition
} from './auras';

/** One aura-sourced stat-modifier ready for the caller to add into the
 *  target's effective stats. */
export interface AuraOverlayModifier {
  /** Stat target (`save.str`, `ac`, `skill.athletics`, ...). Mirrors
   *  the engine's stat-modifier `target` field. */
  target: string;
  /** Numeric delta to add. Aura modifiers always combine by addition in
   *  v0 — multi-source aura stacking is the caller's concern (5e rules
   *  generally cap aura stacking to one source per save). */
  value: number;
  /** Provenance: which participant + aura the value came from. */
  source: {
    participantId: string;
    auraId: string;
    auraName: string;
    sourceContent: { kind: string; slug: string };
  };
}

/** Aura source extended with the data needed to resolve modifier value
 *  tokens against the source's context. */
export interface AuraSourceWithContext extends AuraSource {
  /** Source's stat block — used to resolve tokens like `'chaMod'`,
   *  `'proficiencyBonus'`, or any other key that maps to a numeric
   *  field on `StatBlock`. Optional: when omitted, token-shaped values
   *  are dropped (the literal-number values still flow through). */
  stats?: Pick<StatBlock, 'abilities' | 'proficiencyBonus'>;
}

/** Resolve the aura overlay for `target` from `sources`. Returns the
 *  flat list of modifier rows the caller adds into the target's
 *  effective stats. Multiple overlays may target the same stat — the
 *  caller decides whether to stack them or pick the highest (5e tends
 *  to pick highest for "+CHA mod from one paladin").
 *
 *  Pure: no side effects, no I/O. */
export function applyAuras(
  target: AuraTarget,
  sources: AuraSourceWithContext[]
): AuraOverlayModifier[] {
  const apps = collectAurasFor(target, sources);
  const out: AuraOverlayModifier[] = [];
  for (const app of apps) {
    const src = sources.find((s) => s.participantId === app.sourceParticipantId);
    for (const m of app.modifiers) {
      const target = (m as { target?: unknown }).target;
      const value = (m as { value?: unknown }).value;
      if (typeof target !== 'string') continue;
      const resolved = resolveValue(value, src);
      if (resolved === undefined) continue;
      out.push({
        target,
        value: resolved,
        source: {
          participantId: app.sourceParticipantId,
          auraId: app.auraId,
          auraName: app.auraName,
          sourceContent: app.sourceContent
        }
      });
    }
  }
  return out;
}

/** Sum the overlay deltas per stat target. Useful when the caller just
 *  wants the net effect ("+5 to all saves from all active auras"). */
export function aggregateAuraOverlays(
  overlays: AuraOverlayModifier[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of overlays) {
    out[o.target] = (out[o.target] ?? 0) + o.value;
  }
  return out;
}

function resolveValue(
  value: unknown,
  src: AuraSourceWithContext | undefined
): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  if (!src?.stats) return undefined;
  switch (value) {
    case 'chaMod':
      return src.stats.abilities?.cha?.mod;
    case 'strMod':
      return src.stats.abilities?.str?.mod;
    case 'dexMod':
      return src.stats.abilities?.dex?.mod;
    case 'conMod':
      return src.stats.abilities?.con?.mod;
    case 'intMod':
      return src.stats.abilities?.int?.mod;
    case 'wisMod':
      return src.stats.abilities?.wis?.mod;
    case 'proficiencyBonus':
      return src.stats.proficiencyBonus ?? undefined;
    default:
      return undefined;
  }
}

// Re-export the GridPosition type so callers needing to pass positions
// don't have to import from two locations.
export type { GridPosition };
