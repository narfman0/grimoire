/** Display label for an Action.cost value. Action costs can be the literal
 *  strings 'action' | 'bonus' | 'reaction' | 'free' or structured objects for
 *  movement / limited-use abilities. */
export function costLabel(cost: unknown): string {
  if (cost === 'action') return 'Action';
  if (cost === 'bonus') return 'Bonus';
  if (cost === 'reaction') return 'Reaction';
  if (cost === 'free') return 'Free';
  if (cost && typeof cost === 'object') {
    if ('movement' in cost) {
      const c = cost as { movement: number };
      return `${c.movement} ft move`;
    }
    if ('uses' in cost) {
      const c = cost as { uses: number; per: string };
      return `${c.uses}/${c.per}`;
    }
  }
  return String(cost ?? '');
}

/** Which action-economy slot a cost consumes. Returns null for 'free' or any
 *  shape that doesn't map onto the three core slots — those don't grey out
 *  picker entries when their slot is already spent. */
export function slotForCost(cost: unknown): 'action' | 'bonus' | 'reaction' | null {
  if (cost === 'action') return 'action';
  if (cost === 'bonus') return 'bonus';
  if (cost === 'reaction') return 'reaction';
  return null;
}
