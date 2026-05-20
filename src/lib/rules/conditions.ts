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

/** Canonical 5e SRD condition text for hover descriptions. Mirrors the
 *  `condition` content kind in the SRD pack; kept inline here so the UI
 *  doesn't have to round-trip the pack for tooltips. Each entry is a short
 *  prose blurb (multi-line with bullet-like prefixes). */
export const CONDITION_DESCRIPTIONS: Record<string, string> = {
  blinded:
    "A blinded creature can't see and automatically fails any ability check that requires sight.\nAttack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.",
  charmed:
    "A charmed creature can't attack the charmer or target the charmer with harmful abilities or magical effects.\nThe charmer has advantage on any ability check to interact socially with the creature.",
  deafened:
    "A deafened creature can't hear and automatically fails any ability check that requires hearing.",
  exhaustion:
    'Measured in six levels — effects stack:\n1: Disadvantage on ability checks.\n2: Speed halved.\n3: Disadvantage on attack rolls and saving throws.\n4: Hit point maximum halved.\n5: Speed reduced to 0.\n6: Death.\nA long rest reduces exhaustion by 1 (if the creature has eaten and drunk).',
  frightened:
    "A frightened creature has disadvantage on ability checks and attack rolls while the source of its fear is within line of sight.\nThe creature can't willingly move closer to the source of its fear.",
  grappled:
    "A grappled creature's speed becomes 0, and it can't benefit from any bonus to its speed.\nThe condition ends if the grappler is incapacitated.\nThe condition also ends if an effect removes the grappled creature from the reach of the grappler or grappling effect.",
  incapacitated:
    "An incapacitated creature can't take actions or reactions.",
  invisible:
    "An invisible creature is impossible to see without the aid of magic or a special sense. For hiding, the creature is heavily obscured.\nAttack rolls against the creature have disadvantage, and the creature's attack rolls have advantage.",
  paralyzed:
    "A paralyzed creature is incapacitated and can't move or speak.\nThe creature automatically fails Strength and Dexterity saving throws.\nAttack rolls against the creature have advantage.\nAny attack that hits the creature is a critical hit if the attacker is within 5 feet.",
  petrified:
    "A petrified creature is transformed, along with any nonmagical object it is wearing or carrying, into a solid inanimate substance (usually stone). Its weight increases by a factor of ten, and it ceases aging.\nThe creature is incapacitated, can't move or speak, and is unaware of its surroundings.\nAttack rolls against the creature have advantage.\nThe creature automatically fails Strength and Dexterity saving throws.\nThe creature has resistance to all damage.\nThe creature is immune to poison and disease.",
  poisoned:
    'A poisoned creature has disadvantage on attack rolls and ability checks.',
  prone:
    "A prone creature's only movement option is to crawl, unless it stands up and thereby ends the condition.\nThe creature has disadvantage on attack rolls.\nAn attack roll against the creature has advantage if the attacker is within 5 feet; otherwise, the attack roll has disadvantage.",
  rage:
    "Barbarian class state. While raging, the creature gains:\n- Advantage on Strength checks and Strength saving throws.\n- Bonus damage on melee weapon attacks using Strength (scales with class level).\n- Resistance to bludgeoning, piercing, and slashing damage.\nRage ends if the creature is knocked unconscious or hasn't attacked a hostile creature or taken damage since its last turn.",
  restrained:
    "A restrained creature's speed becomes 0, and it can't benefit from any bonus to its speed.\nAttack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.\nThe creature has disadvantage on Dexterity saving throws.",
  stunned:
    "A stunned creature is incapacitated, can't move, and can speak only falteringly.\nThe creature automatically fails Strength and Dexterity saving throws.\nAttack rolls against the creature have advantage.",
  unconscious:
    "An unconscious creature is incapacitated, can't move or speak, and is unaware of its surroundings.\nThe creature drops whatever it is holding and falls prone.\nThe creature automatically fails Strength and Dexterity saving throws.\nAttack rolls against the creature have advantage.\nAny attack that hits the creature is a critical hit if the attacker is within 5 feet."
};

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
