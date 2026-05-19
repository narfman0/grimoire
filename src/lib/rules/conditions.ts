/** Master list of conditions surfaced as quick-pick buttons in the character
 *  and encounter UIs. Sourced from the SRD `condition` content kind plus
 *  class-state conditions (rage, etc.) that drive engine modifiers. Future
 *  work: filter to class-applicable conditions per character. */
export const COMMON_CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'rage',
  'restrained',
  'stunned',
  'unconscious'
] as const;

export type CommonCondition = (typeof COMMON_CONDITIONS)[number];

/** Static implication graph mirroring `data.implies` in the SRD condition rows. */
export const CONDITION_IMPLIES: Partial<Record<string, string[]>> = {
  unconscious: ['prone', 'incapacitated'],
  paralyzed: ['incapacitated'],
  petrified: ['incapacitated'],
  stunned: ['incapacitated']
};

/** Returns the set of conditions transitively implied by `active` (not including `active` itself). */
export function impliedBy(active: string[]): Map<string, string> {
  const result = new Map<string, string>(); // implied slug → direct source slug
  const visited = new Set(active);
  const queue = [...active];
  while (queue.length > 0) {
    const slug = queue.shift()!;
    for (const imp of CONDITION_IMPLIES[slug] ?? []) {
      if (!visited.has(imp)) {
        visited.add(imp);
        queue.push(imp);
        result.set(imp, slug);
      }
    }
  }
  return result;
}
