// Opportunity attacks: who gets one when a creature walks away.
//
// Movement is the one 5e reaction trigger the encounter runtime had no
// prompt for. The board already knew the geometry — `threatenedCells`
// draws every hostile melee envelope, and a planned path is stored on the
// turn plan — but nothing compared the two, so a PC could stroll out of a
// glaive-wielder's reach unmolested.
//
// The 2024 rule: you provoke when you *leave* a cell within an enemy's
// reach, not when you enter or move within it. So a walk that starts
// adjacent and ends adjacent still provokes if it ever steps out of the
// envelope; circling a creature at melee range never does.
//
// Pure and sibling-only, per the purity guard on this directory.

import { footprintCells, type Grid } from './geometry';
import { cellKey, inBounds, type Cell } from './types';

/** A creature that might take an opportunity attack. */
export interface ThreatenedBy {
  participantId: string;
  cell: Cell;
  team: string;
  /** Melee reach in feet; defaults to 5. */
  reachFt?: number;
  sizeCells?: number;
}

export interface OaProvoker {
  participantId: string;
  /** The cell the mover was in when it left this creature's reach — the
   *  square the attack happens from, and useful in the prompt text. */
  fromCell: Cell;
}

/** The cells one creature threatens, as cellKey strings. Chebyshev square
 *  around every cell of its footprint, matching `threatenedCells` (which
 *  unions the same envelope across a whole side). */
function envelopeOf(grid: Grid, t: ThreatenedBy): Set<string> {
  const out = new Set<string>();
  const reachCells = Math.max(1, Math.round((t.reachFt ?? 5) / grid.cellFt));
  for (const foot of footprintCells(t.cell, t.sizeCells ?? 1)) {
    for (let dy = -reachCells; dy <= reachCells; dy++) {
      for (let dx = -reachCells; dx <= reachCells; dx++) {
        const c = { x: foot.x + dx, y: foot.y + dy };
        if (inBounds(grid, c)) out.add(cellKey(c));
      }
    }
  }
  return out;
}

/** Enemies of `moverTeam` whose reach the `path` steps out of.
 *
 *  `path` is the mover's route including its starting cell. One provoker
 *  per creature however many times the path re-enters and leaves their
 *  reach: a creature has one reaction, so a second exit isn't a second
 *  attack. The cell reported is the first exit, which is where the DM
 *  resolves it from.
 *
 *  Allies never provoke, and a creature standing in its own threatened
 *  square doesn't provoke itself. */
export function oaProvokers(
  grid: Grid,
  path: Cell[],
  moverTeam: string,
  others: ThreatenedBy[]
): OaProvoker[] {
  if (path.length < 2) return [];
  const provokers: OaProvoker[] = [];
  for (const t of others) {
    if (t.team === moverTeam) continue;
    const envelope = envelopeOf(grid, t);
    for (let i = 1; i < path.length; i++) {
      const wasInside = envelope.has(cellKey(path[i - 1]));
      const nowInside = envelope.has(cellKey(path[i]));
      if (wasInside && !nowInside) {
        provokers.push({ participantId: t.participantId, fromCell: path[i - 1] });
        break;
      }
    }
  }
  return provokers;
}

/** Does this turn plan suppress opportunity attacks?
 *
 *  Disengage is the one that actually does. Checked loosely across the
 *  action and bonus-action slots and their labels, because the id space is
 *  a mix of content ids ('action:disengage'), bare action names typed by
 *  the DM, and the panel's common-action labels ('Disengage'). Matching
 *  loosely errs toward *not* prompting, which is the quieter failure: a
 *  missed prompt is a DM's judgement call, a spurious one interrupts the
 *  table every time someone shifts. */
export function planSuppressesOa(plan: {
  actionId?: string;
  actionLabel?: string;
  bonusActionId?: string;
  bonusActionLabel?: string;
} | null | undefined): boolean {
  if (!plan) return false;
  const haystack = [plan.actionId, plan.actionLabel, plan.bonusActionId, plan.bonusActionLabel]
    .filter((s): s is string => typeof s === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes('disengage');
}
