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
