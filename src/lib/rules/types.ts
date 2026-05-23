// TypeScript types for the rules engine. See docs/rules-engine.md for the
// contract narrative; this file is just the types those words describe.

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITIES: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

export type AbilityScores = Record<AbilityKey, number>;

export interface ContentRef {
  kind: string;
  slug: string;
  version?: number; // omit → latest
  /** Author of the homebrew row this ref targets. Omitted/null for pack
   *  content (SRD, grimoire-packs). Required when the character has chosen
   *  a row reached through a subscription so the lookup can disambiguate
   *  two authors' same-slug homebrew on the same sheet. */
  authorUserId?: string | null;
  choices?: Record<string, unknown>;
}

export interface ClassEntry {
  slug: string;
  level: number;
  subclass?: string;
  /** Length === level; the actual HP added at each level (avg or rolled). */
  hpRolledPerLevel: number[];
}

export interface InventorySlot {
  contentKind: string;
  contentSlug: string;
  version?: number;
  /** Homebrew author when the item came from /homebrew/browse (subscription
   *  or fork that points at someone else's row). Null/absent for pack items. */
  authorUserId?: string | null;
  equipped: boolean;
  attuned: boolean;
  charges?: number;
  slot?: string;
}

export interface CharacterDocument {
  id: string;
  name: string;
  alignment?: string;

  classes: ClassEntry[];
  species: ContentRef;
  subspecies?: ContentRef;
  background?: ContentRef;
  feats: ContentRef[];

  abilityScores: AbilityScores;
  proficienciesChosen: {
    skills?: string[];
    tools?: string[];
    languages?: string[];
  };

  inventory: InventorySlot[];
  spells: { known: ContentRef[]; prepared: string[] };

  currentHp: number;
  tempHp: number;
  hitDiceSpent: Record<string, number>;
  conditions: string[];
  /** Stacking level for conditions that accumulate (e.g. exhaustion 1–10).
   *  Key is the condition slug; value is the current stack count (≥ 1).
   *  Absence of a key means the condition has no stack (level 0 / off). */
  conditionStacks?: Record<string, number>;

  modifierToggles: Record<string, boolean>;
  /** Player picks for subclass-feature menus (Acolyte of Nature, Aspect of
   *  the Wilds, Student of War, etc.). Keyed by the feature row's slug.
   *  Value shape mirrors `ContentRef.choices`: a record of choice-decl
   *  keys (e.g. `skillProficiency`, `language`) to the picked value. */
  featureChoices?: Record<string, Record<string, unknown>>;
  /** Player picks declared on the subclass row itself (rare — most subclass
   *  picks live on the per-level feature row instead). Keyed by subclass
   *  slug. */
  subclassChoices?: Record<string, Record<string, unknown>>;
  /** Per-resource counter keyed by resource id (see derive().resources[].id). */
  resourcesSpent?: Record<string, number>;
  /** Whether the character has already used their action slot this turn.
   *  Set when a plan with cost='action' resolves; resets on turn-rise. */
  actionUsedThisRound?: boolean;
  /** Whether the character has already used their bonus action this turn. */
  bonusActionUsedThisRound?: boolean;
  /** Whether the character has already used their reaction in the current
   *  round. Auto-resets when their turn comes back around (planner watches
   *  the SSE activeParticipantId for the rising edge), or on any rest. */
  reactionUsedThisRound?: boolean;
  /** Feet of movement already consumed this turn. Capped at the character's
   *  walking speed; resets on turn-rise. */
  movementUsedThisRound?: number;
  /** Active concentration target. v0: free-text label declared by the player;
   *  ends voluntarily, on long rest, or when a new concentration starts.
   *  Damage-triggered CON saves are DM-adjudicated. */
  concentrating?: { label: string; sinceRound?: number } | null;
  /** Per-activation player state, keyed by `activation.id` declared on a
   *  feature/spell row. Tracks whether the activation is currently on,
   *  uses remaining (for per-rest activations), and the picked variant
   *  for activations with a variants[] menu. derive() reads this to
   *  decide whether to inject the activation's `condition` slug into the
   *  resolved condition set (which gates appliesWhen.condition modifiers
   *  on stat/action/outbound shapes). */
  activations?: Record<string, ActivationState>;
  /** Buffs received from an ally's spell cast (Shield of Faith, Bless,
   *  Haste, Heroism, etc.). Recipient-side model: the buff record lives
   *  on the target's own sheet — the player or DM adds an entry when an
   *  ally casts on them. derive() processes each entry by force-loading
   *  the spell row's modifiers and injecting its activation condition,
   *  so the buff's mechanical effect (e.g. +2 AC) flows through the
   *  same pipeline as self-cast activations. No cross-character RPC,
   *  no concentration cascade — the recipient removes the entry when
   *  the buff ends. */
  receivedBuffs?: ReceivedBuff[];
  /** Action ids (derived.actions[].id) the player has pinned. The planner
   *  surfaces these at the top of the picker. */
  favoriteActionIds?: string[];
}

export interface ReceivedBuff {
  /** Stable id for the entry, unique on this character. Distinct from
   *  the spell slug so the same spell can appear twice (e.g. multiple
   *  +1 enhancement spells from different casters, though that's
   *  usually nonsense). */
  id: string;
  /** Slug of the spell row to apply. */
  spellSlug: string;
  /** Cast slot, when the spell carries scalingByCastSlot in its
   *  activation template. Defaults to the spell's level if unset. */
  slot?: number;
  /** Variant pick when the spell's activation declares static
   *  variants[] (skipped for variantsFromWeapons — the recipient
   *  doesn't pick the touched weapon). */
  variant?: string;
  /** Optional free-text source attribution: "from Cleric Vortha",
   *  "from the Sanctuary cleric's wand", etc. Display-only. */
  sourceLabel?: string;
}

export interface ActivationState {
  /** Whether the activation is currently on. */
  active: boolean;
  /** Uses remaining for per-rest activations; omit / null for unlimited. */
  usesRemaining?: number;
  /** For activations with variants[], the picked variant id. The picked
   *  variant's modifiers are synthesized when active=true. */
  variant?: string;
  /** For activations cast at a spell slot, the picked slot level. The
   *  engine resolves `scalingByCastSlot` value shapes against this slot
   *  at variant-modifier synthesis time so Magic Weapon's +1/+2/+3 by
   *  cast slot, Elemental Weapon's 1d4/2d4/3d4 by cast slot, etc., flow
   *  through correctly. When omitted, scaling values default to their
   *  baseSlotLevel row in the table. */
  slot?: number;
  /** Round number when this activation was last toggled on. Set by the
   *  encounter runtime when an in-encounter activation fires; the sheet
   *  ignores it. */
  activatedAtRound?: number;
}

export interface ContentRow {
  kind: string;
  slug: string;
  version: number;
  source: string;
  name: string;
  data: Record<string, unknown>;
}

export type ContentLookup = (ref: ContentRef) => ContentRow | undefined;

/** Stable key for keyed-content maps shipped from server → client. Author
 *  '_' means "global / pack content"; any other suffix is a user UUID. */
export function contentMapKey(kind: string, slug: string, authorUserId?: string | null): string {
  return `${kind}/${slug}/${authorUserId ?? '_'}`;
}

/** Build a ContentLookup over an author-keyed map (see contentMapKey). The
 *  server's buildContentLookup populates `map` in that shape; clients that
 *  receive the shipped map can reuse this helper instead of re-deriving the
 *  same fallback semantics. */
export function lookupFromMap(map: Record<string, ContentRow>): ContentLookup {
  return (ref) => {
    const exact = map[contentMapKey(ref.kind, ref.slug, ref.authorUserId)];
    if (exact) return exact;
    if (ref.authorUserId != null) return map[contentMapKey(ref.kind, ref.slug, null)];
    // Ref has no author hint and no global row matches. Fall back to any
    // owner-scoped row in the map. Inventory slots authored before we
    // started stamping authorUserId on add stay un-stamped, so a homebrew
    // item with no pack-row twin would otherwise silently fail to resolve.
    // `map` is already scoped by buildContentLookup to (pack + character
    // owner + subscribed authors), so any leftover match is appropriate.
    const prefix = `${ref.kind}/${ref.slug}/`;
    for (const key in map) {
      if (key.startsWith(prefix)) return map[key];
    }
    return undefined;
  };
}

// --- output types ---

export interface AbilityCell {
  score: number;
  mod: number;
}

export interface SaveCell {
  bonus: number;
  proficient: boolean;
  /** Unconditional advantage on this save (e.g. Resilient + Aura of Devotion).
   *  When true, every roll on this save is made with advantage regardless of
   *  what's being saved against. */
  advantage: boolean;
  disadvantage: boolean;
}

export interface SkillCell {
  bonus: number;
  ability: AbilityKey;
  proficient: boolean;
  expertise: boolean;
}

export interface StatBlock {
  abilities: Record<AbilityKey, AbilityCell>;
  saves: Record<AbilityKey, SaveCell>;
  skills: Record<string, SkillCell>;
  ac: number;
  hp: { current: number; max: number; temp: number };
  speeds: Record<string, number>;
  proficiencyBonus: number;
  initiative: number;
  /** Whether the character rolls initiative with advantage (Feywild Gift,
   *  Dread Ambusher, etc.). The encounter layer chooses how to use it. */
  initiativeAdvantage: boolean;
  /** Conditions/circumstances under which every save is made with advantage
   *  (e.g. "advantage on saves against being Frightened"). The
   *  damage/condition resolution layer matches the condition slug against
   *  this list. */
  savesAdvantageVs: string[];
  savesDisadvantageVs: string[];
  passivePerception: number;
  spellSaveDC: number | null;
  spellAttackBonus: number | null;
  spellcastingAbility: AbilityKey | null;
  spellSlots: Record<number, { max: number; used: number }>;
  totalLevel: number;
  resistances: Set<string>;
  immunities: Set<string>;
  vulnerabilities: Set<string>;
  /** Qualifiers per damage type, when the resist/immune/vulnerable applies
   *  only under a condition (`nonmagical`, `spell`, or a creature-type
   *  slug). Unqualified entries do not appear here. The flat
   *  resistances/immunities/vulnerabilities sets still contain every type
   *  for backward compatibility — the UI can iterate them; the
   *  damage-resolution layer consults these maps to decide whether the
   *  incoming damage actually qualifies. An unqualified entry trumps a
   *  qualified one (an unconditional resistance wins). */
  resistanceQualifiers: Record<string, string>;
  immunityQualifiers: Record<string, string>;
  vulnerabilityQualifiers: Record<string, string>;
  senses: Record<string, number>; // darkvision, tremorsense, …
  /** Languages known. Populated from proficienciesChosen.languages plus any
   *  `proficiency.language.<slug>` modifier (class/species/feature/feat). */
  languages: string[];
  /** Tool proficiencies. Populated from proficienciesChosen.tools plus any
   *  `proficiency.tool.<slug>` modifier. */
  tools: string[];
  /** Armor proficiencies (`light`, `medium`, `heavy`, `shields`, plus any
   *  homebrew slug). Populated from `proficiency.armor.<slug>` modifiers. */
  armorProficiencies: string[];
  /** Weapon proficiency categories / slugs (`simple`, `martial`, individual
   *  weapon slugs like `longsword`). Populated from
   *  `proficiency.weapon.<slug>` modifiers. The class-based heuristic in
   *  computeAttackProficiency falls back to this set. */
  weaponProficiencies: string[];
  /** All attack rolls against this creature have Advantage (Paralyzed,
   *  Stunned, Unconscious, Petrified, Restrained, Blinded). Read by the
   *  encounter layer when adjudicating incoming attacks. */
  attackedAdvantage: boolean;
  /** All attack rolls against this creature have Disadvantage (Invisible). */
  attackedDisadvantage: boolean;
  /** Melee attack rolls against this creature have Advantage (Prone). */
  attackedByMeleeAdvantage: boolean;
  /** Ranged attack rolls against this creature have Disadvantage (Prone). */
  attackedByRangedDisadvantage: boolean;
  /** Any attack that hits this creature within 5 ft is a Critical Hit
   *  (Paralyzed, Petrified, Unconscious). Read by the encounter layer. */
  attackedWithin5ftAutoCrit: boolean;
}

export interface AppliedModifier {
  modifierId: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  /** Surface the limit declared on an action-modifier so the UI can show
   *  "1/turn", "1/short-rest", etc. The encounter runtime consumes the same
   *  shape from the resources model to actually enforce uses. */
  limit?: { per: string; uses: number };
}

export interface Action {
  id: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  type: string;
  cost: ActionCost;
  range?: { value: number; units: string };
  attackBonus?: number;
  damageRolls?: Array<{ formula: string; type: string }>;
  saveDC?: { ability: string; value: number };
  attackAbility?: AbilityKey;
  attackRange?: 'melee' | 'ranged';
  weaponProperties?: string[];
  /** How the action selects affected creatures. Heuristic in derive(): self
   *  when range.units === 'self' or range.value === 0 with no attack/save;
   *  single when there's an attack roll; multi when there's a save DC with
   *  no attack; single fallback otherwise. Content rows can override via a
   *  `target` field on the spell/feature row or per-activity. */
  targetMode: 'self' | 'single' | 'multi';
  targetCount?: number;
  /** Number of times this attack action may be made as part of a single
   *  action (populated by Extra Attack feature; 1 = no extra attacks). */
  attackCount?: number;
  /** Natural-roll threshold at which this attack crits. Default 20.
   *  Champion's Improved Critical pushes it to 19, Superior Critical to 18.
   *  The crit.threshold modifier target is applied via DOWNGRADE mode. */
  critThreshold?: number;
  /** Number of extra weapon dice rolled on a crit (Savage Attacks etc.). */
  critExtraDie?: number;
  /** Minimum value on every damage die rolled (Great Weapon Fighting reroll
   *  1s and 2s — modeled here as a floor of 3). */
  damageDieMin?: number;
  /** Damage from this attack ignores the target's resistance (Magic Weapon
   *  master / certain feature riders). */
  damageIgnoreResistance?: boolean;
  /** Reroll all damage dice once and keep the higher result (Savage Attacker
   *  feat). */
  damageRerollAndKeepHigher?: boolean;
  /** Ranged attacks made with this action don't suffer disadvantage when an
   *  enemy is within 5 ft (Crossbow Expert). */
  attackNoDisadvantageWithin5ft?: boolean;
  /** This attack ignores half and three-quarters cover (Sharpshooter). */
  attackIgnoresCover?: boolean;
  /** Ranged attacks made with this action don't suffer disadvantage from
   *  long range (Sharpshooter). */
  attackNoDisadvantageLongRange?: boolean;
  /** Trigger id this action is gated on. When set, the action is only
   *  available *after* the named trigger has fired this turn/round (e.g.
   *  War Magic grants a bonus-action weapon attack after casting a
   *  cantrip — the BA attack is gated on the spell-cast trigger). The UI
   *  shows the action with a "available after X" hint; the encounter
   *  runtime gates execution. */
  gatedOnTrigger?: string;
  /** For leveled spells whose damage / target count / heal scales with
   *  the slot level expended. The base values on this Action are written
   *  for `baseSlotLevel`; the encounter runtime / planner picks an
   *  actual slot and calls `applyUpcast(action, slot)` to get the
   *  scaled Action. Absent → no scaling (cantrips with character-level
   *  scaling use the activity's `perTotalLevel` table, not this field). */
  upcastScaling?: UpcastScaling;
  /** Side effects on the caster that apply when this Action resolves —
   *  granted resources / temp HP / conditions. Surfaced from a spell or
   *  feature activity's `grants` field. Encounter runtime / planner
   *  folds these into character state (e.g. tempHp into HpState.tempHp
   *  via applyDamageDelta). Spells like Armor of Agathys (5 temp HP on
   *  cast) drive this. */
  grants?: ActionGrants;
  appliedModifiers: AppliedModifier[];
}

export interface ActionGrants {
  /** Temp HP granted to the caster on resolution. Numeric values are
   *  resolved against the caster's context at derive() time; dice
   *  formulas (e.g. '1d4+4' for False Life) pass through as strings for
   *  the runtime / player to roll. Casting at a higher slot scales via
   *  UpcastScaling.extraTempHpPerSlot (numeric additions stack on top
   *  of the formula as a separate display: '1d4+4 (+5 per slot above 1)'). */
  tempHp?: number | string;
}

export interface UpcastScaling {
  /** Slot level the base values on this Action are written for.
   *  Casting at slot < baseSlotLevel is illegal (engine clamps).
   *  Casting at slot >= baseSlotLevel applies (slot - baseSlotLevel)
   *  steps of each scaling field. */
  baseSlotLevel: number;
  /** Per-slot-above-base extra damage roll added to the first damage
   *  part (Fireball: '1d6'; Burning Hands: '1d6'). */
  extraDamagePerSlot?: string;
  /** Per-slot-above-base flat damage add to the first damage part
   *  (Inflict Wounds: 1d10 per slot, but the prose phrases as flat
   *  additional dice — same shape as extraDamagePerSlot for that case;
   *  this field is reserved for rare numeric-only adds). */
  extraFlatDamagePerSlot?: number;
  /** Per-slot-above-base extra target count (Magic Missile: 1 dart per
   *  slot; Hold Person: 1 additional target per slot). */
  extraTargetsPerSlot?: number;
  /** Per-slot-above-base extra heal die (Cure Wounds: '1d8'; Healing
   *  Word: '1d4'). Applied to the activity's heal-die formula. */
  extraHealPerSlot?: string;
  /** Per-slot-above-base extra temp HP granted on cast (Armor of
   *  Agathys: 5 per slot; False Life: 5 per slot). Stacks onto
   *  Action.grants.tempHp. */
  extraTempHpPerSlot?: number;
}

export type ActionCost =
  | 'action'
  | 'bonus'
  | 'reaction'
  | 'free'
  | { uses: number; per: 'turn' | 'round' | 'short-rest' | 'long-rest' | 'day' }
  /** Movement-only action (Disengage replaced by movement-style content, etc.).
   *  `feet` is the cost from the character's movement speed budget for the turn. */
  | { movement: number };

/** Known trigger event names. The engine validates trigger declarations
 *  against this list and emits a soft validation warning on unknowns so
 *  pack authors get feedback on typos. The encounter runtime is what
 *  actually fires events. Add new names here when a pack legitimately
 *  needs a new lifecycle hook. */
export const KNOWN_TRIGGER_EVENTS = [
  // Attack lifecycle (self-as-attacker)
  'attack.declare',
  'attack.hit',
  'attack.crit',
  'attack.miss',
  'attack.reduce-to-zero',
  // Save / check / ability-check lifecycle
  'save.declare',
  'save.fail',
  'check.declare',
  // Damage taken (self-as-target)
  'damage.taken',
  'attack.targets-self.declare',
  'attack.targets-self.hit',
  // Spell lifecycle
  'spell.cast',
  'spell.slot-spent',
  // Turn / round lifecycle
  'turn.start',
  'turn.end',
  'round.start',
  // Rest lifecycle
  'rest.short-rest.end',
  'rest.long-rest.end',
  // Ally / enemy lifecycle
  'creature.attack.hit',
  'creature.takes-fall-damage',
  'creature.turn-start',
  'creature.reduce-to-zero',
  'enemy.reduce-to-zero',
  'enemy.dies-within-range'
] as const;
export type TriggerEvent = (typeof KNOWN_TRIGGER_EVENTS)[number];

/** Grant payload on a TriggerDeclaration. Discriminated by `type`. The
 *  encounter runtime maps each grant to a player choice (e.g. "do you want
 *  to use Heavy Armor Master to reduce this damage?"). */
export type TriggerGrant =
  | { type: 'force-reroll' }
  | { type: 'damage.reduce'; amount: number | string }
  | { type: 'damage.reflect'; amount: number | string }
  | { type: 'impose-disadvantage'; on: 'attack' | 'save' | 'check' }
  | { type: 'convert-hit-to-miss' }
  | { type: 'bonus-action-weapon-attack' }
  | { type: 'reaction-weapon-attack' }
  | { type: string; [k: string]: unknown }; // forward-compat: unknown grant shapes still pass through

export interface TriggerDeclaration {
  id: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  on: string[];
  scope?: unknown;
  grants?: TriggerGrant | unknown;
  limit?: { per: string; uses: number };
}

export interface Resource {
  id: string;
  name: string;
  max: number;
  used: number;
  per: string;
  sourceContent: { kind: string; slug: string };
  /** Condition slug auto-applied when the player consumes this resource. */
  appliesCondition?: string;
}

export interface ValidationIssue {
  severity: 'warning' | 'error';
  code: string;
  message: string;
}

export interface AvailableToggle {
  id: string;
  name: string;
  defaultEnabled: boolean;
  currentlyEnabled: boolean;
  sourceContent: { kind: string; slug: string };
}

/** Effects this character emanates onto allies/enemies within a radius —
 *  Paladin auras, Bardic Inspiration, Aura of Warding, etc. The encounter
 *  layer reads this manifest and applies the contained modifiers to
 *  affected creature tokens. Derive only emits the declaration. */
export interface OutboundEffect {
  id: string;
  sourceContent: { kind: string; slug: string };
  name: string;
  /** Radius in feet, measured from this character's space. */
  rangeFt: number;
  /** Selector for affected creatures. `ally` includes self by default
   *  unless `excludeSelf` is set; `creature` matches anyone in range. */
  targets: 'ally' | 'enemy' | 'creature' | 'self';
  excludeSelf?: boolean;
  /** Whether the effect requires the source to be conscious / not
   *  incapacitated. Encounter layer enforces. */
  requiresAlive?: boolean;
  /** Stat-modifier entries applied to each affected creature. */
  modifiers?: Array<Record<string, unknown>>;
  /** Gated on a condition the source must be in (Rage, Concentrating). */
  appliesWhen?: { condition?: string };
}

export interface Derived {
  stats: StatBlock;
  actions: Action[];
  triggers: TriggerDeclaration[];
  resources: Resource[];
  validations: ValidationIssue[];
  toggles: AvailableToggle[];
  /** Spell slugs auto-prepared by a feature/subclass/feat `spellListAdditions`
   *  field. Composited with the player's `character.spells.prepared` list.
   *  The UI labels them as "always prepared from <source>". */
  alwaysPreparedFromContent: string[];
  /** Aura/multi-target effects this character emanates onto nearby
   *  creatures. Consumed by the encounter layer to derive ally-side
   *  modifiers. */
  outboundEffects: OutboundEffect[];
  /** Overlay HP pools — independent HP buckets that absorb damage before
   *  the character's main HP and that can persist across encounters.
   *  Emitted from `overlay-hp-pool` modifier rows on features like
   *  Arcane Ward. Pool current values are tracked by the encounter
   *  runtime; derive() only declares the pool's existence, max, and
   *  refresh policy. */
  overlayHpPools: OverlayHpPool[];
  /** Per-feature menu picks that the player either has recorded or still
   *  needs to record. Emitted from any active feature / subclass row
   *  carrying a `data.choices` declaration. The UI walks this to render
   *  picker affordances (skill prof, expertise, language, sub-feature, …)
   *  and writes selections back into `character.featureChoices[slug]`
   *  (or `character.subclassChoices[slug]` for subclass-row picks). */
  pendingFeatureChoices: PendingFeatureChoice[];
  /** Player-toggleable activations declared on active feature / spell rows
   *  (Bladesong, Rage, Form of Dread, Magic Weapon, etc.). The sheet
   *  renders a toggle per entry; toggling on writes
   *  `character.activations[id].active = true`, which derive() reads back
   *  on the next pass to inject the activation's `condition` slug into
   *  resolved conditions (gating appliesWhen.condition modifiers) and
   *  to synthesize the picked variant's modifiers when applicable. */
  availableActivations: AvailableActivation[];
  /** Denormalized equipped-inventory summary, shared by the AC formula
   *  and the activation auto-cancel walk. armorType is null when the
   *  character has no armor body slot equipped (i.e. unarmored). shield
   *  reflects whether any equipped item is `armorType: 'shield'`. */
  equipped: EquippedInventory;
}

export interface EquippedInventory {
  armorType: 'light' | 'medium' | 'heavy' | null;
  shield: boolean;
}

export interface ActivationDuration {
  value: number;
  units: 'round' | 'turn' | 'minute' | 'hour';
}

export interface ActivationVariant {
  id: string;
  label: string;
  /** Modifier rows synthesized when this variant is the picked variant
   *  AND the parent activation is active. Same shape as modifierFromChoice
   *  option modifiers — stat-modifier / action-modifier / overlay-hp-pool. */
  modifiers?: Array<Record<string, unknown>>;
}

/** Authored on a feature / spell / item row's `data.activations[]`. */
export interface ActivationDeclaration {
  /** Stable slug used as the key in `character.activations`. Distinct
   *  from `condition` (the slug injected into resolvedConditions when
   *  active) so multiple activations can target the same condition slug
   *  if needed. */
  id: string;
  name: string;
  description?: string;
  /** Action economy cost to activate. Display-only — the planner uses
   *  this to surface "BA to start" in the activation panel. */
  cost?: 'action' | 'bonus' | 'reaction' | 'free' | 'none';
  /** Display-only duration string the sheet renders alongside the toggle.
   *  Game-time only — the engine doesn't tick a count-down. Player toggles
   *  off manually when the in-fiction duration ends. */
  duration?: ActivationDuration | 'persistent';
  /** Per-rest use cap. `max` is evaluated via evaluateValue — accepts
   *  literal numbers, magic strings ('proficiencyBonus', 'wisMod',
   *  `classLevel:<slug>`, arithmetic like 'max(1, intMod)'), and the
   *  perClass-table shape used by activity-level uses for things like
   *  rage (`{perClass: 'barbarian', table: [2,2,3,3,3,4,…]}`). `per`
   *  controls when refreshActivations() resets uses back to max. */
  uses?: {
    max: number | string | { perClass: string; table: Array<number | string> };
    per: 'short-rest' | 'long-rest' | 'day';
  };
  /** True if this activation requires concentration. Toggling on cancels
   *  any other concentration the character is currently maintaining. */
  concentration?: boolean;
  /** Mutually-exclusive band — only one activation per group can be
   *  active at a time. Toggling one on auto-cancels others in the group
   *  (Wild Heart Aspect: owl/panther/salmon are in the same group; Rage
   *  of the Wilds: bear/eagle/wolf are in the same group). */
  group?: string;
  /** Slug injected into resolvedConditions when active=true. Existing
   *  appliesWhen.condition modifiers gated on this slug fire on the
   *  next derive() pass. */
  condition: string;
  /** Conditions and inventory states whose presence auto-cancels this
   *  activation. String entries match the character's conditions[] list
   *  (e.g. "incapacitated"). Object entries match equipped inventory:
   *  `{wearing: 'armor.medium'|'armor.heavy'|'armor.light'|'shield'}`
   *  fires when the character currently has that armor type / a shield
   *  equipped. The activations module's auto-cancel walk evaluates both
   *  kinds against character + EquippedInventory state. */
  autoCancelOn?: AutoCancelEntry[];
  /** Variant menu — when set, the player picks one variant when
   *  activating; the picked variant's modifiers are synthesized while
   *  the activation is active (replaces the now-deprecated
   *  modifierFromChoice usage for activation-tied picks). */
  variants?: ActivationVariant[];
  /** Dynamic per-weapon variants. When set, derive() generates a
   *  variant per equipped weapon in the character's inventory and
   *  exposes the menu on availableActivations[]. On activation, the
   *  picked weapon's slug is substituted for any `"__weapon__"` string
   *  literal in the template (typically in an action-modifier's
   *  `appliesTo.predicates[].weapon.slug`). Powers spells like Magic
   *  Weapon / Elemental Weapon that enchant "the weapon you touched"
   *  rather than all weapons. Mutually exclusive with `variants[]` —
   *  authoring both is a content bug. */
  variantsFromWeapons?: { modifiers: Array<Record<string, unknown>> };
}

/** A condition slug, or an inventory-state predicate, that can appear
 *  in an activation's autoCancelOn list. */
export type AutoCancelEntry = string | InventoryPredicate;

/** Inventory-state predicate for activation auto-cancel. `armor.light`
 *  / `armor.medium` / `armor.heavy` match the equipped armor's
 *  `armorType` (the unarmored case is when no armor is equipped, and
 *  matches none of these). `shield` matches any equipped shield. */
export interface InventoryPredicate {
  wearing: 'armor.light' | 'armor.medium' | 'armor.heavy' | 'shield';
}

/** Per-character snapshot of an authored activation declaration plus the
 *  player's current state. */
export interface AvailableActivation {
  id: string;
  name: string;
  sourceContent: { kind: string; slug: string };
  description?: string;
  cost?: ActivationDeclaration['cost'];
  /** Display-only duration string (e.g. "1 minute", "persistent"). */
  duration?: string;
  /** Per-rest cap; null = unlimited. */
  usesMax: number | null;
  /** Uses remaining; null = unlimited. */
  usesRemaining: number | null;
  /** Refresh policy from the declaration's `uses.per`, null when unlimited. */
  refreshOn: 'short-rest' | 'long-rest' | 'day' | null;
  concentration?: boolean;
  group?: string;
  condition: string;
  autoCancelOn?: AutoCancelEntry[];
  variants?: Array<{ id: string; label: string }>;
  /** Currently-picked variant id, when the activation has variants. */
  activeVariant?: string;
  /** Set when the activation's modifier templates reference one or
   *  more `scalingByCastSlot` value shapes. The panel renders a slot
   *  picker; synthesis substitutes the picked slot into the scaling
   *  table. `baseSlotLevel` is the spell's base slot — the picker's
   *  minimum. */
  slotScaling?: { baseSlotLevel: number };
  /** Currently-picked cast slot for this activation. Defaults to
   *  slotScaling.baseSlotLevel when unset; only meaningful when
   *  slotScaling is set on the manifest. */
  activeSlot?: number;
  /** Whether the activation is currently on. */
  active: boolean;
}

export interface PendingFeatureChoice {
  featureSlug: string;
  featureName: string;
  /** Source row kind. v0: 'feature' | 'subclass' (the only two kinds
   *  whose picks the engine reads from a per-slug map). */
  kind: string;
  /** Declared choice slots from the row's data.choices. Slot name (e.g.
   *  'skillProficiency', 'expertise', 'language', 'feature', 'spell')
   *  maps to the slot's declaration object (allowedSkills, allowedSpells,
   *  allowedAbilities, etc.). */
  declarations: Record<string, Record<string, unknown>>;
  /** Picks the player has recorded so far for this row, keyed by slot
   *  name. Missing keys → that slot is unresolved. */
  picks: Record<string, unknown>;
  /** True when at least one declared slot has no pick recorded. */
  unresolved: boolean;
}

export interface OverlayHpPool {
  /** Stable id derived from the source row + modifier index. */
  id: string;
  /** Content row that declared the pool. */
  sourceContent: { kind: string; slug: string };
  /** Display name. */
  name: string;
  /** Maximum HP of this pool, evaluated against character context at
   *  derive() time. */
  max: number;
  /** When the pool refreshes to max. `'manual'` means it never auto-
   *  refreshes — the consumer (typically the feature itself) controls
   *  restoration (Arcane Ward refreshes on cast, not on rest). */
  refreshOn: 'short-rest' | 'long-rest' | 'manual';
}
