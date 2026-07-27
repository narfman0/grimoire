// One-line display summaries for the canonical structured trigger-grant
// shapes (damage.rider / condition.rider / hp.max-reduce, plus the d20 /
// save / reroll / contingency / absorption display contracts). Shared by
// the sheet's trigger list and the encounter reaction prompts — the
// runtime stays DM-adjudicated; these strings render the structured
// fields instead of parsing prose. Grant types that are runtime
// contracts rather than display riders return null.

export function grantSummary(
  grants: { type: string; [k: string]: unknown } | undefined
): string | null {
  if (!grants) return null;
  if (grants.type === 'damage.rider') {
    const g = grants as {
      amount?: string;
      damageType?: string;
      save?: { ability?: string; dc?: number; half?: boolean };
    };
    let s = `+${g.amount ?? '?'} ${g.damageType ?? ''} on hit`.trim();
    if (g.save)
      s += ` (${(g.save.ability ?? '?').toUpperCase()} DC ${g.save.dc ?? '?'} ${g.save.half ? 'half' : 'negates'})`;
    return s;
  }
  if (grants.type === 'condition.rider') {
    const g = grants as {
      condition?: string;
      save?: { ability?: string; dc?: number };
      duration?: { value?: number; units?: string };
    };
    let s = `target ${(g.condition ?? '?').replace(/-/g, ' ')} on hit`;
    if (g.save) s += ` (${(g.save.ability ?? '?').toUpperCase()} DC ${g.save.dc ?? '?'} negates)`;
    if (g.duration?.value != null) s += `, ${g.duration.value} ${g.duration.units ?? ''}`;
    return s;
  }
  if (grants.type === 'hp.max-reduce') {
    const g = grants as { amount?: string };
    return `target's HP maximum reduced by ${g.amount ?? '?'}`;
  }
  if (grants.type === 'd20.replace') {
    const g = grants as { value?: number };
    return `use ${g.value ?? '?'} in place of the d20 roll`;
  }
  if (grants.type === 'save.convert-fail-to-success') {
    return 'the failed save becomes a success';
  }
  if (grants.type === 'reroll.grant') {
    const g = grants as { die?: string };
    return g.die
      ? `reroll: roll an extra ${g.die} and choose which to use`
      : 'reroll the triggering d20';
  }
  if (grants.type === 'contingency.revive') {
    const g = grants as { hp?: number | string };
    return `instead of dying, return with ${g.hp ?? 1} HP`;
  }
  if (grants.type === 'spell.absorb') {
    const g = grants as { maxLevels?: number };
    return `absorb the triggering spell${g.maxLevels != null ? ` (up to ${g.maxLevels} total levels)` : ''}`;
  }
  return null;
}
