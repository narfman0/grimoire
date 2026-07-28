// Orchestrator for the rules engine. Six phases per docs/rules-engine.md:
//   1. resolve active content
//   2. compose stat block
//   3. assemble activities
//   4. apply action modifiers
//   5. register triggers
//   6. validate
//
// Pure function. No I/O, no clock, no random.

import {
  applyCrossRowUpgrades,
  applyUpgradeValue,
  NO_OP,
  UPGRADE_TARGET_PREFIX,
  type UpgradeModifier,
  type UpgradeTargetRow
} from './cross-row-upgrades';
import {
  predicateFromQualifierString,
  type DamageSourcePredicate
} from './damage-source';
import { abilityModifier, evaluateValue, proficiencyBonusFor, rageDamageFor, type EvalContext } from './evaluate';
import { applyFormModifiers, isFormScoped } from './form-modifiers';
import { applyNumericMode, defaultPriority, type Mode } from './modes';
import { monsterDerive } from './monster-derive';
import { predicateMatches, validatePredicateBlock, type PredicateContext } from './predicates';
import { SKILLS, SKILL_ABILITY } from './skills';
import { slugify } from './slug';
import { applyUpcast } from './upcast';
import type {
  AbilityCell,
  AbilityKey,
  Action,
  ActivationDeclaration,
  ActivationDuration,
  ActivationWard,
  ActiveForm,
  AvailableActivation,
  AppliedModifier,
  AvailableToggle,
  CharacterDocument,
  ContentLookup,
  ContentRef,
  ContentRow,
  Derived,
  DerivedCompanion,
  ManeuverDecl,
  ManeuverEffect,
  ManeuverRider,
  ManeuverSaveEffect,
  OutboundEffect,
  OverlayHpPool,
  PendingFeatureChoice,
  PendingItemChoice,
  Resource,
  ResolvedClassResource,
  SaveAdvantageSourceQualified,
  SaveCell,
  SkillCell,
  StatBlock,
  StoredSpell,
  TriggerDeclaration,
  TriggerGrant,
  ValidationIssue
} from './types';
import { ABILITIES, KNOWN_TRIGGER_EVENTS } from './types';
import { coerceRandomTable, validateRandomTable } from './random-tables';

interface ActiveContent {
  ref: ContentRef;
  row: ContentRow;
  data: Record<string, unknown>;
  /** For item-sourced entries: the originating inventory slot's state.
   *  Carried so appliesWhen.requires gates ('equipped:attuned') and the
   *  requiresAttunement wholesale rule can be evaluated per entry, and
   *  so per-slot player picks (`choices`) resolve at realize time.
   *  `index` is the slot's position in character.inventory — the key
   *  under which the sheet writes picks back. Absent for every non-item
   *  source. */
  inventorySlot?: {
    equipped: boolean;
    attuned: boolean;
    index: number;
    choices?: Record<string, unknown>;
    stored?: StoredSpell[];
  };
}

/** Gate for item-sourced content entries (modifiers, triggers,
 *  activities, activations, charge pools) against the originating
 *  inventory slot.
 *
 *  `appliesWhen.requires` values:
 *    - 'equipped'         — satisfied whenever the item is equipped (the
 *      baseline: only equipped items produce refs at all).
 *    - 'equipped:attuned' — additionally requires the slot to be attuned.
 *    - 'equipped:offHand' — v1: treated as plain 'equipped'. There is no
 *      hand model yet; when one lands, this should also check the slot's
 *      hand assignment.
 *  Unknown requires strings are treated as satisfied (fail-open, matching
 *  the engine's forward-compat posture).
 *
 *  Additionally, an item row with `data.requiresAttunement: true` whose
 *  slot is NOT attuned is inert wholesale — every entry is skipped UNLESS
 *  the entry explicitly declares `requires: 'equipped'` (rare: a property
 *  that works while merely holding the unattuned item). Non-item sources
 *  (no inventory slot) always pass. */
function itemRequirementMet(source: ActiveContent, appliesWhen: unknown): boolean {
  const slot = source.inventorySlot;
  if (!slot) return true;
  const requires = (appliesWhen as { requires?: unknown } | null | undefined)?.requires;
  if (requires === 'equipped:attuned') return slot.attuned === true;
  if (source.data.requiresAttunement === true && !slot.attuned) {
    return requires === 'equipped';
  }
  return true;
}

/** An active row's `activities[]` minus entries whose
 *  appliesWhen.requires gate is unmet (see itemRequirementMet). Rows
 *  without an inventory slot pass through untouched. */
function gatedActivities(a: ActiveContent): Array<Record<string, unknown>> {
  const acts = (a.data.activities as Array<Record<string, unknown>> | undefined) ?? [];
  if (!a.inventorySlot) return acts;
  return acts.filter((act) => itemRequirementMet(a, act.appliesWhen));
}

/** Validate an authored `sourcePredicate` field on a stat-modifier row
 *  and lift it into the structured DamageSourcePredicate shape.
 *  Returns undefined for malformed or absent input — callers fall back
 *  to the source-agnostic qualifier-string path. */
function coerceSourcePredicate(raw: unknown): DamageSourcePredicate | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== 'string') return undefined;
  if (r.kind === 'spell') return { kind: 'spell' };
  if (r.kind === 'magical') return { kind: 'magical' };
  if (r.kind === 'creatureType') {
    if (typeof r.value !== 'string' || !r.value) return undefined;
    return { kind: 'creatureType', value: r.value };
  }
  return undefined;
}

/** Narrow a raw trigger `grants` payload to the TriggerGrant union. Any
 *  object carrying a string `type` passes through — the union's catch-all
 *  arm keeps unknown grant shapes forward-compatible. Shapes without a
 *  `type` discriminant are dropped (they were already inert downstream —
 *  every consumer switches on `grants.type`). */
function coerceTriggerGrant(raw: unknown): TriggerGrant | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  if (typeof (raw as { type?: unknown }).type !== 'string') return undefined;
  return raw as TriggerGrant;
}

/** Read an authored activation `ward` block into the canonical shape.
 *  Deliberately soft: any non-empty string is a legal creature-type slug
 *  (no validation gate — homebrew types pass); malformed blocks return
 *  undefined and the activation simply has no ward line. */
function coerceActivationWard(raw: unknown): ActivationWard | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const o = raw as { creatureTypes?: unknown; radiusFt?: unknown; barrier?: unknown };
  if (!Array.isArray(o.creatureTypes)) return undefined;
  const creatureTypes = o.creatureTypes.filter(
    (t): t is string => typeof t === 'string' && t.length > 0
  );
  if (creatureTypes.length === 0) return undefined;
  return {
    creatureTypes,
    ...(typeof o.radiusFt === 'number' ? { radiusFt: o.radiusFt } : {}),
    ...(o.barrier === true ? { barrier: true } : {})
  };
}

interface ActiveModifier {
  id: string; // for action modifiers; auto-generated for stat modifiers
  kind: 'stat-modifier' | 'action-modifier' | 'trigger' | 'overlay-hp-pool';
  source: ActiveContent;
  raw: Record<string, unknown>;
}

/** Route one raw `modifiers[]` entry into the allMods sink under its
 *  declared kind (stat-modifier / action-modifier / overlay-hp-pool;
 *  unknown kinds are dropped). The three id strings preserve each call
 *  site's exact id template: `stat` always wins for stat-modifiers
 *  (authored `m.id` is ignored there), while action / overlay honor an
 *  authored `m.id` and fall back to their template. */
function classifyModifier(
  m: Record<string, unknown>,
  ids: { stat: string; action: string; overlay: string },
  source: ActiveContent,
  sink: ActiveModifier[]
): void {
  const kind = (m.kind as string | undefined) ?? 'stat-modifier';
  if (kind === 'stat-modifier') {
    sink.push({ id: ids.stat, kind: 'stat-modifier', source, raw: m });
  } else if (kind === 'action-modifier') {
    sink.push({
      id: (m.id as string | undefined) ?? ids.action,
      kind: 'action-modifier',
      source,
      raw: m
    });
  } else if (kind === 'overlay-hp-pool') {
    sink.push({
      id: (m.id as string | undefined) ?? ids.overlay,
      kind: 'overlay-hp-pool',
      source,
      raw: m
    });
  }
}

/** True when any active stat-modifier sets `target` to literal true —
 *  the shared shape of the boolean flag channels (attacked.advantage,
 *  deathsave.advantage, tag.*, armor.ignore-*, …). */
function hasBooleanTarget(mods: ActiveModifier[], target: string): boolean {
  return mods.some(
    (m) => m.kind === 'stat-modifier' && m.raw.target === target && m.raw.value === true
  );
}

/** The equipped body-armor row (category=armor, armorType !== 'shield'),
 *  if any. Last equipped row wins, mirroring computeAC's selection. */
function findEquippedArmor(active: ActiveContent[]): ActiveContent | undefined {
  let armor: ActiveContent | undefined;
  for (const a of active) {
    if (a.row.kind !== 'item') continue;
    if ((a.data.category as string | undefined) !== 'armor') continue;
    if ((a.data.armorType as string | undefined) === 'shield') continue;
    armor = a;
  }
  return armor;
}

/** Mutable state threaded through the phase 3-6 helpers below derive().
 *  Phases 1-2 build these locals inside derive() (they are mutation-heavy
 *  and stay inline for now); phases 3-6 read and extend them via this
 *  explicit context so derive() reads as a sequence of phase calls. */
interface DerivePhaseState {
  character: CharacterDocument;
  content: ContentLookup;
  active: ActiveContent[];
  allMods: ActiveModifier[];
  /** Modifiers flagged `appliesToForm: true` — pulled out of `allMods`
   *  before phase 2 so they never touch the base sheet. Folded into the
   *  polymorph form snapshot by resolveActiveForm. */
  formScopedMods: ActiveModifier[];
  ctx: EvalContext;
  validations: ValidationIssue[];
  resolvedConditions: Set<string>;
  stats: StatBlock;
  actions: Action[];
  triggers: TriggerDeclaration[];
  /** Merged (base weapon + item) row data per synthesized bound-weapon
   *  action id (see resolveBoundWeaponSynthesis). Phase 4 consults this
   *  before the item's own row so predicate matching (`weapon.kind` etc.)
   *  sees the bound base's weaponType/properties instead of the enspelled
   *  item's bare row. */
  boundWeaponData: Map<string, Record<string, unknown>>;
}

/** Specs for the six feat-choice kinds that synthesize a stat-modifier from a
 *  player pick (asi, skillProficiency, expertise, savingThrow, language,
 *  toolProficiency). Spell + feature picks have different shapes (deferred
 *  refs, multi-select) and stay inline. */
interface FeatModifierChoiceSpec {
  /** Used both for the modifier id and as the field key in decl/picks. */
  declKey: string;
  /** Suffix appended to `feat/{slug}/` for the modifier id. */
  idSuffix: string;
  /** Field on the pick object that holds the chosen value (e.g. 'ability'). */
  pickField: string;
  /** Field on the decl object that holds the allow-list (e.g. 'allowedAbilities'). */
  allowedField?: string;
  /** Used when the decl omits its allow-list (asi's six abilities, etc.).
   *  When undefined, an absent allow-list means "anything goes". */
  defaultAllowed?: string[];
  /** Expertise accepts the literal string 'proficient' in place of an array,
   *  meaning "restrict to skills the character is already proficient in" —
   *  the UI enforces; the engine accepts any pick. */
  allowProficient?: boolean;
  /** Prefixed onto the pick to form the modifier target, e.g. 'ability' + pick
   *  'str' → 'ability.str'. */
  targetPrefix: string;
  mode: 'ADD' | 'OVERRIDE';
  /** Constant or a function of the decl entry (asi uses decl.bonus ?? 1). */
  value: number | boolean | ((decl: Record<string, unknown>) => number | boolean);
  /** Kind of state checked for the `elseAlready` conditional-routing path.
   *  When the player's pick is already in this proficiency set, derive()
   *  emits the alternate modifier instead of the default. Set per spec —
   *  only proficiency-grant specs declare a state kind; asi / language /
   *  tool / etc. skip this concept. */
  elseAlreadyStateKind?: 'skill' | 'save' | 'language' | 'tool';
}

const FEAT_MODIFIER_CHOICE_SPECS: readonly FeatModifierChoiceSpec[] = [
  {
    declKey: 'asi',
    idSuffix: 'asi',
    pickField: 'ability',
    allowedField: 'allowedAbilities',
    defaultAllowed: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
    targetPrefix: 'ability',
    mode: 'ADD',
    value: (decl) => (decl.bonus as number | undefined) ?? 1
  },
  {
    declKey: 'skillProficiency',
    idSuffix: 'skill-prof',
    pickField: 'skill',
    allowedField: 'allowedSkills',
    targetPrefix: 'proficiency.skill',
    mode: 'OVERRIDE',
    value: true,
    elseAlreadyStateKind: 'skill'
  },
  {
    declKey: 'expertise',
    idSuffix: 'expertise',
    pickField: 'skill',
    allowedField: 'allowedSkills',
    allowProficient: true,
    targetPrefix: 'expertise.skill',
    mode: 'OVERRIDE',
    value: true
  },
  {
    declKey: 'savingThrow',
    idSuffix: 'save-prof',
    pickField: 'ability',
    allowedField: 'allowedAbilities',
    targetPrefix: 'proficiency.save',
    mode: 'OVERRIDE',
    value: true,
    elseAlreadyStateKind: 'save'
  },
  {
    declKey: 'language',
    idSuffix: 'language',
    pickField: 'language',
    allowedField: 'allowedLanguages',
    targetPrefix: 'proficiency.language',
    mode: 'OVERRIDE',
    value: true,
    elseAlreadyStateKind: 'language'
  },
  {
    declKey: 'toolProficiency',
    idSuffix: 'tool-prof',
    pickField: 'tool',
    allowedField: 'allowedTools',
    targetPrefix: 'proficiency.tool',
    mode: 'OVERRIDE',
    value: true,
    elseAlreadyStateKind: 'tool'
  }
];

function isChoiceAllowed(
  allowed: string[] | 'proficient' | undefined,
  pick: string,
  defaultAllowed: string[] | undefined,
  allowProficient: boolean | undefined
): boolean {
  if (allowed === 'proficient') return !!allowProficient;
  if (!allowed) return defaultAllowed ? defaultAllowed.includes(pick) : true;
  return allowed.includes(pick);
}

/** Locate the player's pick storage for a given active content row when
 *  the row declares `data.choices`. Returns the (decl, picks) pair the
 *  caller drives FEAT_MODIFIER_CHOICE_SPECS against. Returns undefined
 *  when the row has no choices declaration. */
/**
 * Whether a single declared choice slot still needs more player input.
 *
 * Scalar slots (`skillProficiency`, `language`, `feature`, `asi`,
 * `savingThrow`, `expertise`, `toolProficiency`, `modifierFromChoice`)
 * are unresolved iff the player has recorded nothing.
 *
 * Plural / multi-pick slots (`skillProficiencies`, `languages`,
 * `toolProficiencies`, `expertises`, `spell`) honour the `picks: N` cap
 * the declaration ships: the slot is unresolved when the recorded array
 * has fewer than N entries. When `picks` is absent the slot is
 * unresolved iff the array is missing entirely (back-compat — open
 * plural picks are author intent, not a partial state).
 */
function isSlotUnresolved(
  slotKey: string,
  decl: Record<string, unknown> | undefined,
  pick: unknown,
  ctx?: EvalContext
): boolean {
  // The spell slot is plural but its payload shape is
  // `{ spells: [...] }`, not a bare array.
  if (slotKey === 'spell') {
    const cap = (decl?.picks as number | undefined) ?? undefined;
    const spells = (pick as { spells?: unknown[] } | undefined)?.spells;
    if (cap == null) return spells == null;
    return !Array.isArray(spells) || spells.length < cap;
  }
  // Maneuver slot: choices.maneuvers = { picks: <number | string | perClass-table>, allowedIds?: [...] }
  // picks.maneuvers = [{ maneuverId: '...' }, ...]
  if (slotKey === 'maneuvers') {
    const picksDeclared = decl?.picks;
    let cap: number | undefined;
    if (typeof picksDeclared === 'number') {
      cap = picksDeclared;
    } else if (picksDeclared != null && ctx) {
      const resolved = evaluateValue(picksDeclared, ctx);
      if (typeof resolved === 'number') cap = Math.max(0, Math.floor(resolved));
    }
    if (cap == null || cap === 0) return !Array.isArray(pick);
    return !Array.isArray(pick) || pick.length < cap;
  }
  const PLURAL_SLOTS = new Set([
    'skillProficiencies',
    'languages',
    'toolProficiencies',
    'expertises'
  ]);
  if (PLURAL_SLOTS.has(slotKey)) {
    const cap = (decl?.picks as number | undefined) ?? undefined;
    if (cap == null) return pick == null;
    return !Array.isArray(pick) || pick.length < cap;
  }
  // Multi-pick feature slot: choices.feature = { picks: N, allowedFeatures: [...] }
  // picks.feature = { features: string[] } when N > 1; { feature: string } when N === 1.
  if (slotKey === 'feature') {
    const cap = (decl?.picks as number | undefined) ?? 1;
    if (cap <= 1) return pick == null;
    const features = (pick as { features?: unknown[] } | undefined)?.features;
    return !Array.isArray(features) || features.length < cap;
  }
  // Option-menu slot: choices.modifierFromChoice = { picks?, options: [...] }
  // picks.modifierFromChoice = { option: 'x' } (cap 1) or
  //                            { options: ['x','y'] } (cap > 1).
  // `picks` accepts the evaluateValue shapes, so a perClass table drives
  // milestone growth (Rune Knight: 2 runes at fighter 3 → 5 at 18).
  if (slotKey === 'modifierFromChoice') {
    const picksDeclared = decl?.picks;
    let cap = 1;
    if (typeof picksDeclared === 'number') {
      cap = picksDeclared;
    } else if (picksDeclared != null && ctx) {
      const resolved = evaluateValue(picksDeclared, ctx);
      if (typeof resolved === 'number') cap = Math.max(0, Math.floor(resolved));
    }
    const p = pick as { option?: string; options?: unknown[] } | undefined;
    const chosen = new Set<string>();
    if (typeof p?.option === 'string' && p.option) chosen.add(p.option);
    if (Array.isArray(p?.options)) {
      for (const o of p.options) if (typeof o === 'string' && o) chosen.add(o);
    }
    return chosen.size < Math.max(1, cap);
  }
  // Scalar slot — any non-null pick counts as resolved. (The picker UI
  // is responsible for shape correctness; derive() just checks
  // presence.)
  return pick == null;
}

function resolveChoicePicks(
  a: ActiveContent,
  character: CharacterDocument
): { decl: Record<string, Record<string, unknown> | undefined>; picks: Record<string, Record<string, unknown> | undefined> } | undefined {
  const decl = (a.data.choices ?? null) as Record<string, Record<string, unknown> | undefined> | null;
  if (!decl) return undefined;
  let picksRaw: Record<string, unknown> | undefined;
  switch (a.row.kind) {
    case 'feat':
      picksRaw = character.feats.find((f) => f.slug === a.row.slug)?.choices;
      break;
    case 'species':
      if (character.species.slug === a.row.slug) picksRaw = character.species.choices;
      break;
    case 'subspecies':
      if (character.subspecies?.slug === a.row.slug) picksRaw = character.subspecies?.choices;
      break;
    case 'background':
      if (character.background?.slug === a.row.slug) picksRaw = character.background?.choices;
      break;
    case 'feature':
      picksRaw = character.featureChoices?.[a.row.slug];
      break;
    case 'subclass':
      picksRaw = character.subclassChoices?.[a.row.slug];
      break;
    default:
      picksRaw = undefined;
  }
  const picks = (picksRaw ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return { decl, picks };
}

/** One option of a `choices.modifierFromChoice` menu. Beyond the
 *  synthesized `modifiers[]`, an option may carry its own `uses` pool —
 *  Rune Knight runes each have a 1/short-rest invocation on top of their
 *  passive rider. */
interface MenuOption {
  id?: string;
  label?: string;
  name?: string;
  modifiers?: Array<Record<string, unknown>>;
  uses?: { max?: number | string | object; per?: string };
  description?: string;
}

/** Resolve the picked options of a row's `choices.modifierFromChoice`
 *  menu, in declaration order (NOT pick order) so the synthesized ids and
 *  resources are stable regardless of the order the player clicked.
 *
 *  Pick shapes, both accepted:
 *    picks.modifierFromChoice = { option: 'fire' }              — single
 *    picks.modifierFromChoice = { options: ['fire', 'stone'] }  — multi
 *
 *  The declaration's `picks: N` is metadata for the picker UI; the engine
 *  records what the player chose without enforcing the count (same
 *  posture as every other allow-list in the choice DSL). */
function resolvePickedMenuOptions(
  a: ActiveContent,
  character: CharacterDocument
): MenuOption[] {
  const declPicks = resolveChoicePicks(a, character);
  if (!declPicks) return [];
  const decl = declPicks.decl.modifierFromChoice as
    | { options?: MenuOption[] }
    | undefined;
  if (!decl || !Array.isArray(decl.options)) return [];
  const raw = declPicks.picks.modifierFromChoice as
    | { option?: string; options?: string[] }
    | undefined;
  if (!raw) return [];
  const picked = new Set<string>();
  if (typeof raw.option === 'string' && raw.option) picked.add(raw.option);
  if (Array.isArray(raw.options)) {
    for (const o of raw.options) if (typeof o === 'string' && o) picked.add(o);
  }
  if (picked.size === 0) return [];
  return decl.options.filter((o) => typeof o?.id === 'string' && picked.has(o.id));
}

export function derive(character: CharacterDocument, content: ContentLookup): Derived {
  // -------------------------------------------------------------------------
  // PHASE 1 — resolve active content
  // -------------------------------------------------------------------------

  const totalLevel = character.classes.reduce((acc, c) => acc + c.level, 0);
  const proficiencyBonus = proficiencyBonusFor(totalLevel || 1);

  const refs: Array<{
    ref: ContentRef;
    sourceKind: string;
    /** Originating inventory slot state, for item refs only. */
    slot?: ActiveContent['inventorySlot'];
  }> = [];
  refs.push({ ref: character.species, sourceKind: 'species' });
  if (character.subspecies) refs.push({ ref: character.subspecies, sourceKind: 'subspecies' });
  if (character.background) refs.push({ ref: character.background, sourceKind: 'background' });
  for (const c of character.classes) {
    refs.push({ ref: { kind: 'class', slug: c.slug }, sourceKind: 'class' });
    if (c.subclass)
      refs.push({ ref: { kind: 'subclass', slug: c.subclass }, sourceKind: 'subclass' });
  }
  for (const f of character.feats) refs.push({ ref: f, sourceKind: 'feat' });

  // Items (each inventory slot points to a content row by (kind, slug)).
  // The slot's equipped/attuned state rides along so attunement gates
  // (appliesWhen.requires) can be evaluated per active entry.
  for (let slotIndex = 0; slotIndex < character.inventory.length; slotIndex++) {
    const slot = character.inventory[slotIndex];
    if (!slot.equipped) continue;
    refs.push({
      ref: { kind: slot.contentKind, slug: slot.contentSlug, version: slot.version },
      sourceKind: 'item',
      slot: {
        equipped: slot.equipped,
        attuned: slot.attuned === true,
        index: slotIndex,
        ...(slot.choices && typeof slot.choices === 'object' ? { choices: slot.choices } : {}),
        ...(Array.isArray(slot.stored) ? { stored: slot.stored } : {})
      }
    });
  }

  // Prepared spells. (Known but not prepared spells aren't active for prep casters.)
  for (const s of character.spells.known) {
    if (character.spells.prepared.includes(s.slug)) {
      refs.push({ ref: s, sourceKind: 'spell' });
    }
  }

  // Conditions (e.g. rage, frightened).
  // Resolve implies chains: a condition may imply other conditions (e.g.
  // unconscious implies prone + incapacitated). Walk transitively with a
  // cycle guard so the active condition set is fully expanded before we
  // push refs.
  const resolvedConditions = new Set<string>(character.conditions);
  const conditionQueue = [...character.conditions];
  while (conditionQueue.length > 0) {
    const slug = conditionQueue.shift()!;
    const condRow = content({ kind: 'condition', slug });
    if (!condRow) continue;
    const implied = (condRow.data.implies as string[] | undefined) ?? [];
    for (const imp of implied) {
      if (!resolvedConditions.has(imp)) {
        resolvedConditions.add(imp);
        conditionQueue.push(imp);
      }
    }
  }
  for (const c of resolvedConditions) {
    refs.push({ ref: { kind: 'condition', slug: c }, sourceKind: 'condition' });
  }

  const active: ActiveContent[] = [];
  const validations: ValidationIssue[] = [];
  for (const { ref, slot } of refs) {
    const row = content(ref);
    if (!row) {
      validations.push({
        severity: 'warning',
        code: 'content-missing',
        message: `content not found: ${ref.kind}/${ref.slug}${ref.version ? '@v' + ref.version : ''}`
      });
      continue;
    }
    active.push({ ref, row, data: row.data, ...(slot ? { inventorySlot: slot } : {}) });
  }

  // Walk active content and pull in any feature slugs they reference.
  // Features carry their own modifiers/activities; they're loaded just like
  // any other content kind. We accept two shapes for the references:
  //   `features`         — engine-native: array of strings or { slug, level }
  //   `subclassFeatures` — 5etools-imported: array of { level, name, ... }
  // For the 5etools shape we slugify the `name` and treat it as a feature
  // ref. If no matching feature row exists in the content map, the lookup
  // below silently skips it — display-only fields stay available on the
  // subclass row for the sheet to render, but produce no rules effect.
  const featureRefs: Array<{ ref: ContentRef; ownerSlug: string; ownerKind: string; level: number }> = [];
  /** Refs deferred from feat-choice synthesis (spell + feature picks). Resolved
   *  in the feature-ref walk below so their modifiers/activities/triggers
   *  feed back into derive like any other active content. */
  const deferredRefs: ContentRef[] = [];
  for (const a of active) {
    const features = (a.data.features as Array<string | { slug: string; level?: number; minLevel?: number }> | undefined) ?? [];
    for (const f of features) {
      if (typeof f === 'string') {
        featureRefs.push({
          ref: { kind: 'feature', slug: f },
          ownerSlug: a.row.slug,
          ownerKind: a.row.kind,
          level: 1
        });
      } else if (f && typeof f === 'object' && 'slug' in f) {
        const featLevel = (f as { level?: number; minLevel?: number }).level ?? (f as { minLevel?: number }).minLevel ?? 1;
        const classLevel = classLevelFor(character, a.row.slug);
        if (a.row.kind === 'class' && classLevel < featLevel) continue;
        featureRefs.push({
          ref: { kind: 'feature', slug: f.slug },
          ownerSlug: a.row.slug,
          ownerKind: a.row.kind,
          level: featLevel
        });
      }
    }
    const inlineFeatures =
      (a.data.subclassFeatures as Array<{ name?: string; level?: number }> | undefined) ?? [];
    for (const f of inlineFeatures) {
      if (!f?.name) continue;
      const slug = slugify(f.name);
      const featLevel = f.level ?? 1;
      // Subclass features unlock at a per-class level; gate by parent class.
      if (a.row.kind === 'subclass') {
        const parentSlug = (a.data.parentClass as string | undefined) ?? '';
        if (parentSlug && classLevelFor(character, parentSlug) < featLevel) continue;
      }
      featureRefs.push({
        ref: { kind: 'feature', slug },
        ownerSlug: a.row.slug,
        ownerKind: a.row.kind,
        level: featLevel
      });
    }
  }
  for (const { ref: r } of featureRefs) {
    const row = content(r);
    if (!row) continue;
    // Feature applicability: minLevel against owning class/subclass/species level.
    const data = row.data;
    const ownerKind = data.ownerKind as string | undefined;
    const ownerSlug = data.ownerSlug as string | undefined;
    const minLevel = (data.minLevel as number | undefined) ?? 1;
    if (ownerKind === 'class' && ownerSlug) {
      if (classLevelFor(character, ownerSlug) < minLevel) continue;
    } else if (ownerKind === 'subclass' && ownerSlug) {
      const parentClass = character.classes.find((c) => c.subclass === ownerSlug);
      if (parentClass && parentClass.level < minLevel) continue;
    }
    active.push({ ref: r, row, data });
  }

  // Receiver-side buffs: when an ally casts a buff spell on this
  // character (Shield of Faith, Bless, Longstrider, etc.), the
  // recipient adds an entry to character.receivedBuffs. derive()
  // force-loads the spell row into `active` here so its raw
  // modifiers[] flow through allMods like any other active content;
  // the activation block below injects the spell's activation
  // condition into resolvedConditions so the appliesWhen.condition
  // gates fire. The Activations panel skips these spells (they're
  // rendered in the separate Received-Buffs panel).
  const receivedBuffSpellSlugs = new Set<string>();
  for (const rb of character.receivedBuffs ?? []) {
    if (!rb || typeof rb.spellSlug !== 'string') continue;
    receivedBuffSpellSlugs.add(rb.spellSlug);
    const spellRow = content({ kind: 'spell', slug: rb.spellSlug });
    if (!spellRow) continue;
    if (active.some((a) => a.row.kind === 'spell' && a.row.slug === rb.spellSlug)) continue;
    active.push({
      ref: { kind: 'spell', slug: rb.spellSlug },
      row: spellRow,
      data: spellRow.data
    });
  }

  // C.4 — collect spell-list additions and free-cast budget from active
  // content. spellListAdditions push spells into deferredRefs so they're
  // active for action realization; alwaysPreparedFromContent surfaces them
  // on Derived so the UI can label "from <feature>".
  const alwaysPreparedFromContent = new Set<string>();
  const freeCastEntries: Array<{
    slug: string;
    per: string;
    uses: number;
    sourceContent: { kind: string; slug: string };
  }> = [];
  for (const a of active) {
    const additions = a.data.spellListAdditions as string[] | undefined;
    if (Array.isArray(additions)) {
      for (const slug of additions) {
        alwaysPreparedFromContent.add(slug);
        deferredRefs.push({ kind: 'spell', slug });
      }
    }
    const freeCasts = a.data.freeCasts as
      | Array<{ slug?: string; per?: string; uses?: number }>
      | undefined;
    if (Array.isArray(freeCasts)) {
      for (const fc of freeCasts) {
        if (!fc?.slug || !fc?.per) continue;
        // Pull the spell row in too so the cast surface (action) exists.
        alwaysPreparedFromContent.add(fc.slug);
        deferredRefs.push({ kind: 'spell', slug: fc.slug });
        freeCastEntries.push({
          slug: fc.slug,
          per: fc.per,
          uses: fc.uses ?? 1,
          sourceContent: { kind: a.row.kind, slug: a.row.slug }
        });
      }
    }
  }

  // Baseline proficiency sets — used by the `elseAlready` conditional-routing
  // branch in choice synthesis (below) to decide whether a player's pick
  // already exists on the character, in which case the alternate modifier
  // is emitted instead of the default.
  //
  // Ordering choice: only non-choice grants count toward "already
  // proficient." Sources included:
  //   1. character.proficienciesChosen.{skills,languages,tools}
  //   2. class.saves arrays (canonical save-proficient list per class row)
  //   3. data.modifiers entries on any active row whose target prefixes
  //      `proficiency.skill.` / `proficiency.save.` / `proficiency.language.`
  //      / `proficiency.tool.` (covers class/species/background/feature/feat
  //      static grants)
  //
  // Intentionally NOT included: choice-driven grants from other features
  // (i.e. another iron-mind-style feature whose pick happens to be the
  // same skill). This is order-deterministic and matches RAW intent —
  // the "already have proficiency" prerequisite is a base-character
  // state, not a stacking interaction with another simultaneous pick.
  const baselineSkillProfs = new Set<string>(character.proficienciesChosen.skills ?? []);
  const baselineSaveProfs = new Set<string>();
  const baselineLanguageProfs = new Set<string>(character.proficienciesChosen.languages ?? []);
  const baselineToolProfs = new Set<string>(character.proficienciesChosen.tools ?? []);
  for (const c of character.classes) {
    const classRow = content({ kind: 'class', slug: c.slug });
    if (!classRow) continue;
    const saves = (classRow.data.saves as string[] | undefined) ?? [];
    for (const s of saves) baselineSaveProfs.add(s);
  }
  for (const a of active) {
    const mods = (a.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const m of mods) {
      if (m.kind !== 'stat-modifier') continue;
      if (m.value !== true) continue;
      const t = m.target;
      if (typeof t !== 'string') continue;
      if (t.startsWith('proficiency.skill.')) baselineSkillProfs.add(t.slice('proficiency.skill.'.length));
      else if (t.startsWith('proficiency.save.')) baselineSaveProfs.add(t.slice('proficiency.save.'.length));
      else if (t.startsWith('proficiency.language.')) baselineLanguageProfs.add(t.slice('proficiency.language.'.length));
      else if (t.startsWith('proficiency.tool.')) baselineToolProfs.add(t.slice('proficiency.tool.'.length));
    }
  }
  function isAlreadyProficient(stateKind: string, pick: string): boolean {
    switch (stateKind) {
      case 'skill': return baselineSkillProfs.has(pick);
      case 'save': return baselineSaveProfs.has(pick);
      case 'language': return baselineLanguageProfs.has(pick);
      case 'tool': return baselineToolProfs.has(pick);
      default: return false;
    }
  }

  // Build raw modifier/activity/trigger lists from active content.
  const allMods: ActiveModifier[] = [];
  for (const a of active) {
    const mods = (a.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    for (let i = 0; i < mods.length; i++) {
      // Attunement / requires gate: item-sourced modifiers whose
      // appliesWhen.requires is unmet (or whose attunement item isn't
      // attuned) never enter allMods, so every downstream consumer
      // (applyTarget, applyActionModifiers, resistances, senses, the
      // item-bonus reroute) sees a consistent view.
      if (!itemRequirementMet(a, mods[i].appliesWhen)) continue;
      classifyModifier(
        mods[i],
        {
          stat: `${a.row.kind}/${a.row.slug}/mod/${i}`,
          action: `${a.row.kind}/${a.row.slug}/amod/${i}`,
          overlay: `${a.row.kind}/${a.row.slug}/overlay/${i}`
        },
        a,
        allMods
      );
    }
    const triggers = (a.data.triggers as Array<Record<string, unknown>> | undefined) ?? [];
    for (let i = 0; i < triggers.length; i++) {
      const t = triggers[i];
      if (!itemRequirementMet(a, t.appliesWhen)) continue;
      allMods.push({
        id: (t.id as string) ?? `${a.row.kind}/${a.row.slug}/trig/${i}`,
        kind: 'trigger',
        source: a,
        raw: t
      });
    }

    // 2024 background ASI choices: the player picked +2/+1 or +1/+1/+1
    // distribution onto the background's `abilityChoices`. The choice lives
    // on character.background.choices.asis; synthesize stat-modifiers from
    // it here so phase 2 picks them up like any other ability bump.
    if (a.row.kind === 'background' && character.background?.slug === a.row.slug) {
      const allowed = (a.data.abilityChoices as string[] | undefined) ?? [];
      const asis = (character.background.choices as
        | { asis?: Array<{ ability: string; bonus: number }> }
        | undefined)?.asis ?? [];
      for (let i = 0; i < asis.length; i++) {
        const asi = asis[i];
        if (!allowed.includes(asi.ability)) continue; // illegal choice — drop
        allMods.push({
          id: `background/${a.row.slug}/asi/${i}`,
          kind: 'stat-modifier',
          source: a,
          raw: {
            kind: 'stat-modifier',
            target: `ability.${asi.ability}`,
            mode: 'ADD',
            value: asi.bonus
          }
        });
      }
    }

    // Feat choices: feats with `data.choices` declare optional player picks
    // (Skill Expert: ability +1 / skill prof / expertise; Fey Touched, etc.).
    // The pick lives on the matching character.feats[i].choices entry.
    // Synthesise stat-modifiers from the pairing so the rest of derive
    // sees them as normal grants. Shape:
    //   data.choices: {
    //     asi?: { bonus: number; allowedAbilities?: string[] },
    //     skillProficiency?: { allowedSkills?: string[] },
    //     expertise?: { allowedSkills?: string[] | 'proficient' }
    //   }
    //   feat.choices: {
    //     asi?: { ability: string },
    //     skillProficiency?: { skill: string },
    //     expertise?: { skill: string }
    //   }
    // Resolve the picks-storage source for this row's kind. C.5 widened
    // choice-synthesis from feat-only to any content kind that ships a
    // `data.choices` decl with player picks on the character document.
    const declPicks = resolveChoicePicks(a, character);
    if (declPicks) {
      const { decl, picks } = declPicks;
      for (const spec of FEAT_MODIFIER_CHOICE_SPECS) {
        const declEntry = decl[spec.declKey];
        const pickEntry = picks[spec.declKey];
        if (!declEntry || !pickEntry) continue;
        const pick = pickEntry[spec.pickField] as string | undefined;
        if (!pick) continue;
        const allowed = spec.allowedField
          ? (declEntry[spec.allowedField] as string[] | 'proficient' | undefined)
          : undefined;
        if (!isChoiceAllowed(allowed, pick, spec.defaultAllowed, spec.allowProficient)) continue;
        // Conditional routing — if the pick is already proficient on this
        // character (baseline non-choice state) AND the decl ships an
        // `elseAlready` override, emit the alternate modifier instead of
        // the default. Powers "Gain proficiency in X; if you already have
        // proficiency, gain Expertise instead" feature shapes
        // (Iron Mind, Elegant Courtier, etc.).
        let targetPrefix = spec.targetPrefix;
        let mode: 'ADD' | 'OVERRIDE' = spec.mode;
        let value: number | boolean = typeof spec.value === 'function' ? spec.value(declEntry) : spec.value;
        let idSuffix = spec.idSuffix;
        const elseAlready = declEntry.elseAlready as
          | { targetPrefix?: string; mode?: 'ADD' | 'OVERRIDE'; value?: number | boolean }
          | undefined;
        if (
          elseAlready &&
          spec.elseAlreadyStateKind &&
          isAlreadyProficient(spec.elseAlreadyStateKind, pick)
        ) {
          if (typeof elseAlready.targetPrefix === 'string') targetPrefix = elseAlready.targetPrefix;
          if (elseAlready.mode === 'ADD' || elseAlready.mode === 'OVERRIDE') mode = elseAlready.mode;
          if (typeof elseAlready.value === 'number' || typeof elseAlready.value === 'boolean') {
            value = elseAlready.value;
          }
          idSuffix = `${spec.idSuffix}-else`;
        }
        allMods.push({
          id: `${a.row.kind}/${a.row.slug}/${idSuffix}`,
          kind: 'stat-modifier',
          source: a,
          raw: {
            kind: 'stat-modifier',
            target: `${targetPrefix}.${pick}`,
            mode,
            value
          }
        });
      }
      // Feature-pick: any content kind with choices.feature defers loading of
      // the chosen sub-feature (e.g. Giant Ancestry picking an ancestry type).
      // Single-pick: picks.feature = { feature: "slug" }
      // Multi-pick (picks > 1): picks.feature = { features: ["slug-a", "slug-b"] }
      const featureDecl = decl.feature as { allowedFeatures?: string[]; picks?: number } | undefined;
      if (featureDecl) {
        const pickCount = featureDecl.picks ?? 1;
        if (pickCount > 1) {
          const featureSlugs = (picks.feature as { features?: string[] } | undefined)?.features ?? [];
          for (const fp of featureSlugs) {
            if (!fp) continue;
            if (!featureDecl.allowedFeatures || featureDecl.allowedFeatures.includes(fp)) {
              deferredRefs.push({ kind: 'feature', slug: fp });
            }
          }
        } else {
          const featurePick = (picks.feature as { feature?: string } | undefined)?.feature;
          if (featurePick) {
            if (!featureDecl.allowedFeatures || featureDecl.allowedFeatures.includes(featurePick)) {
              deferredRefs.push({ kind: 'feature', slug: featurePick });
            }
          }
        }
      }
      // Feat-pick: any content kind with choices.feat defers loading of the
      // chosen feat (e.g. Custom Lineage granting a free feat at level 1).
      // Declaration: choices.feat = { allowedFeats?: string[] | 'all' }
      // Pick:        <content>.choices.feat = { slug: "polearm-master" }
      const featPickDecl = decl.feat as { allowedFeats?: string[] | 'all' } | undefined;
      const featPickSlug = (picks.feat as { slug?: string } | undefined)?.slug;
      if (featPickDecl && featPickSlug) {
        const allowed = featPickDecl.allowedFeats;
        if (!allowed || allowed === 'all' || allowed.includes(featPickSlug)) {
          deferredRefs.push({ kind: 'feat', slug: featPickSlug });
        }
      }
      // Multi-pick expertise: choices.expertises = { allowedSkills: [...] | "proficient" }
      // picks.expertises = [{ skill: "arcana" }, { skill: "perception" }]
      // "allowedSkills": "proficient" means the player must already be proficient.
      // The engine emits expertise modifiers; UI enforces the proficient constraint.
      const expertisesDecl = decl.expertises as
        | { allowedSkills?: string[] | 'proficient' }
        | undefined;
      const expertisesPicks = picks.expertises as Array<{ skill?: string }> | undefined;
      if (expertisesDecl && Array.isArray(expertisesPicks)) {
        for (let i = 0; i < expertisesPicks.length; i++) {
          const pick = expertisesPicks[i]?.skill;
          if (!pick) continue;
          allMods.push({
            id: `${a.row.kind}/${a.row.slug}/expertise-${i}`,
            kind: 'stat-modifier',
            source: a,
            raw: { kind: 'stat-modifier', target: `expertise.skill.${pick}`, mode: 'OVERRIDE', value: true }
          });
        }
      }
      // Multi-pick skill proficiency: choices.skillProficiencies = { allowedSkills?: [...] }
      // picks.skillProficiencies = [{ skill: "arcana" }, { skill: "history" }, ...]
      // Emits proficiency.skill.<slug> OVERRIDE true for each picked skill.
      const skillProfsDecl = decl.skillProficiencies as { allowedSkills?: string[] } | undefined;
      const skillProfsPicks = picks.skillProficiencies as Array<{ skill?: string }> | undefined;
      if (skillProfsDecl && Array.isArray(skillProfsPicks)) {
        for (let i = 0; i < skillProfsPicks.length; i++) {
          const pick = skillProfsPicks[i]?.skill;
          if (!pick) continue;
          if (skillProfsDecl.allowedSkills && !skillProfsDecl.allowedSkills.includes(pick)) continue;
          allMods.push({
            id: `${a.row.kind}/${a.row.slug}/skill-prof-${i}`,
            kind: 'stat-modifier',
            source: a,
            raw: { kind: 'stat-modifier', target: `proficiency.skill.${pick}`, mode: 'OVERRIDE', value: true }
          });
        }
      }
      // Spell-pick: choices.spell = { allowedSpells?: [...] }
      // picks.spell = { spells: ["fireball", "hold-monster"] }
      // Adds chosen spells as deferred active-content refs so their actions
      // are synthesized (Magical Secrets, Magical Initiate, etc.).
      const spellDecl = decl.spell as { allowedSpells?: string[] } | undefined;
      const spellPick = picks.spell as { spells?: string[] } | undefined;
      if (spellDecl && Array.isArray(spellPick?.spells)) {
        for (const slug of spellPick.spells) {
          if (spellDecl.allowedSpells && !spellDecl.allowedSpells.includes(slug)) continue;
          deferredRefs.push({ kind: 'spell', slug });
        }
      }
      // Multi-pick language: choices.languages = { allowedLanguages?: [...], picks?: N }
      // picks.languages = [{ language: "draconic" }, { language: "dwarvish" }]
      // Emits proficiency.language.<slug> OVERRIDE true for each picked language.
      // `picks` is the prose-declared count; engine treats it as a hint and
      // applies every pick in the array (the UI is responsible for the cap).
      const languagesDecl = decl.languages as { allowedLanguages?: string[]; picks?: number } | undefined;
      const languagesPicks = picks.languages as Array<{ language?: string }> | undefined;
      if (languagesDecl && Array.isArray(languagesPicks)) {
        for (let i = 0; i < languagesPicks.length; i++) {
          const pick = languagesPicks[i]?.language;
          if (!pick) continue;
          if (languagesDecl.allowedLanguages && !languagesDecl.allowedLanguages.includes(pick)) continue;
          allMods.push({
            id: `${a.row.kind}/${a.row.slug}/language-${i}`,
            kind: 'stat-modifier',
            source: a,
            raw: { kind: 'stat-modifier', target: `proficiency.language.${pick}`, mode: 'OVERRIDE', value: true }
          });
        }
      }
      // Multi-pick tool proficiency: choices.toolProficiencies = { allowedTools?: [...], picks?: N }
      // picks.toolProficiencies = [{ tool: "smiths-tools" }, { tool: "carpenters-tools" }]
      const toolProfsDecl = decl.toolProficiencies as { allowedTools?: string[]; picks?: number } | undefined;
      const toolProfsPicks = picks.toolProficiencies as Array<{ tool?: string }> | undefined;
      if (toolProfsDecl && Array.isArray(toolProfsPicks)) {
        for (let i = 0; i < toolProfsPicks.length; i++) {
          const pick = toolProfsPicks[i]?.tool;
          if (!pick) continue;
          if (toolProfsDecl.allowedTools && !toolProfsDecl.allowedTools.includes(pick)) continue;
          allMods.push({
            id: `${a.row.kind}/${a.row.slug}/tool-prof-${i}`,
            kind: 'stat-modifier',
            source: a,
            raw: { kind: 'stat-modifier', target: `proficiency.tool.${pick}`, mode: 'OVERRIDE', value: true }
          });
        }
      }
      // Union-shape pick: choices.modifierFromChoice = {
      //   label?: 'Aspect of the Wilds',
      //   options: [
      //     { id: 'owl',     label: 'Owl',     modifiers: [...] },
      //     { id: 'panther', label: 'Panther', modifiers: [...] },
      //     ...
      //   ]
      // }
      // picks.modifierFromChoice = { option: 'owl' }              — single
      // picks.modifierFromChoice = { options: ['fire', 'stone'] } — multi
      // Every picked option's `modifiers[]` are synthesized as if they had
      // been declared on this row directly. Unblocks "pick one of these
      // distinct modifier sets" patterns (Aspect of the Wilds, Kobold
      // Legacy, Transmuter's Stone, Shifter shifting variants) and the
      // multi-pick menus (Rune Knight runes). An option may also declare
      // its own `uses` pool — collectResources emits one Resource per
      // picked option that has one.
      for (const chosen of resolvePickedMenuOptions(a, character)) {
        if (!Array.isArray(chosen.modifiers)) continue;
        for (let i = 0; i < chosen.modifiers.length; i++) {
          classifyModifier(
            chosen.modifiers[i],
            {
              stat: `${a.row.kind}/${a.row.slug}/mfc/${chosen.id}/${i}`,
              action: `${a.row.kind}/${a.row.slug}/mfc/${chosen.id}/amod/${i}`,
              overlay: `${a.row.kind}/${a.row.slug}/mfc/${chosen.id}/overlay/${i}`
            },
            a,
            allMods
          );
          // trigger / outbound shapes inside an option aren't synthesized
          // in v0 — only modifier-kind effects. Add if/when needed.
        }
      }
    }
    if (a.row.kind === 'feat') {
      const featRef = character.feats.find((f) => f.slug === a.row.slug);
      // Feats with `asiBudget` (e.g. Ability Score Improvement) use an asis
      // array on their choices — same shape as background.choices.asis —
      // rather than the single-pick choices.asi approach. This lets the player
      // split the budget (+2/+1+1) freely.
      const asiBudget = a.data.asiBudget as number | undefined;
      if (asiBudget != null) {
        const allowed =
          (a.data.abilityChoices as string[] | undefined) ??
          ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        const asiPicks =
          (featRef?.choices as { asis?: Array<{ ability: string; bonus: number }> } | undefined)
            ?.asis ?? [];
        let spent = 0;
        for (let i = 0; i < asiPicks.length; i++) {
          const asi = asiPicks[i];
          if (!allowed.includes(asi.ability)) continue;
          if (typeof asi.bonus !== 'number' || asi.bonus < 1) continue;
          spent += asi.bonus;
          if (spent > asiBudget) break;
          allMods.push({
            id: `feat/${a.row.slug}/asis/${i}`,
            kind: 'stat-modifier',
            source: a,
            raw: {
              kind: 'stat-modifier',
              target: `ability.${asi.ability}`,
              mode: 'ADD',
              value: asi.bonus
            }
          });
        }
      }
    }
  }

  // Resolve refs deferred from feat-choice synthesis (spell + feature picks).
  // Push each into active, then re-extract their modifiers/activities/triggers
  // into allMods so they participate in phases 2+ like any other source.
  for (const r of deferredRefs) {
    const row = content(r);
    if (!row) continue;
    const data = row.data;
    const entry: ActiveContent = { ref: r, row, data };
    active.push(entry);
    const mods = (data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    for (let i = 0; i < mods.length; i++) {
      classifyModifier(
        mods[i],
        {
          stat: `${row.kind}/${row.slug}/mod/${i}`,
          action: `${row.kind}/${row.slug}/amod/${i}`,
          overlay: `${row.kind}/${row.slug}/overlay/${i}`
        },
        entry,
        allMods
      );
    }
    const triggers = (data.triggers as Array<Record<string, unknown>> | undefined) ?? [];
    for (let i = 0; i < triggers.length; i++) {
      const t = triggers[i];
      allMods.push({
        id: (t.id as string) ?? `${row.kind}/${row.slug}/trig/${i}`,
        kind: 'trigger',
        source: entry,
        raw: t
      });
    }
  }

  // Re-route item-sourced attack.bonus / damage.bonus stat-modifiers as
  // synthetic action-modifiers. Magic weapons and spell focuses encode
  // their +N enhancement as character-level stat-modifiers, but attack
  // and damage bonuses are inherently per-action — applyTarget can't
  // reach them at the character level. Push synthetic action-modifiers
  // scoped to the matching action so applyActionEffect handles them
  // uniformly in Phase 4.
  //
  // Scope rules:
  //   attack.bonus            → weapon attacks made with this item
  //   attack.bonus.melee      → ditto, melee only
  //   attack.bonus.ranged     → ditto, ranged only
  //   attack.bonus.spell      → any spell attack (item is a focus held
  //                              while casting; not source-scoped)
  //   damage.bonus[.*]        → mirrors attack.bonus shapes against
  //                              the damage.bonus action-effect target
  const itemBonusSynthesized: ActiveModifier[] = [];
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    if (m.source.row.kind !== 'item') continue;
    const target = (m.raw.target as string | undefined) ?? '';
    const isAttack = target === 'attack.bonus' || target.startsWith('attack.bonus.');
    const isDamage = target === 'damage.bonus' || target.startsWith('damage.bonus.');
    if (!isAttack && !isDamage) continue;
    const prefix = isAttack ? 'attack.bonus' : 'damage.bonus';
    const scope = target.slice(prefix.length); // '' | '.melee' | '.ranged' | '.spell'
    const itemSlug = m.source.row.slug;
    const predicates: Array<Record<string, unknown>> = [];
    if (scope === '.spell') {
      predicates.push({ 'attack.classification': 'spell' });
    } else {
      predicates.push({ 'weapon.slug': itemSlug });
      if (scope === '.melee' || scope === '.ranged') {
        predicates.push({ 'attack.range': scope.slice(1) });
      }
    }
    itemBonusSynthesized.push({
      id: `${m.id}/item-action-bonus`,
      kind: 'action-modifier',
      source: m.source,
      raw: {
        kind: 'action-modifier',
        name: (m.raw.name as string | undefined) ?? `${m.source.row.name ?? itemSlug} ${target}`,
        appliesWhen: m.raw.appliesWhen,
        appliesTo: { activityType: 'attack', predicates },
        effects: [
          {
            target: isAttack ? 'attack.roll' : 'damage.bonus',
            mode: (m.raw.mode as Mode | undefined) ?? 'ADD',
            value: m.raw.value
          }
        ]
      }
    });
  }
  for (const synth of itemBonusSynthesized) allMods.push(synth);

  // Form-scoped modifiers (`appliesToForm: true`) are pulled OUT of the
  // base modifier set before phase 2 composes anything — a druid in human
  // shape must not get Circle of the Moon's in-form AC floor. They land on
  // `Derived.activeForm.formModifiers` and are folded into the form
  // snapshot instead (see resolveActiveForm / applyFormModifiers).
  // `persistsInForm: true` is the opposite flag and stays in allMods.
  const formScopedMods: ActiveModifier[] = [];
  for (let i = allMods.length - 1; i >= 0; i--) {
    if (!isFormScoped(allMods[i].raw)) continue;
    formScopedMods.unshift(allMods[i]);
    allMods.splice(i, 1);
  }

  // -------------------------------------------------------------------------
  // PHASE 2 — compose stat block
  // -------------------------------------------------------------------------

  const classLevels: Record<string, number> = {};
  for (const c of character.classes) classLevels[c.slug] = c.level;

  // ctx is populated incrementally as phase 2 composes its derived fields:
  // ability mods land after phase 2(a), walkSpeed after phase 2(d). Modifiers
  // running before those phases see the zero defaults — in practice no
  // ability-score modifier references its own ability's mod, and speed
  // modifiers don't run before speed is built.
  const ctx: EvalContext = {
    totalLevel,
    proficiencyBonus,
    rageDamage: rageDamageFor(character, proficiencyBonus),
    classLevels,
    abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    walkSpeed: 0,
    conditionStacks: character.conditionStacks ?? {},
    // resolvedConditions reference is shared — we extend it with
    // activation-injected condition slugs after the activation walk
    // (see below). All appliesWhen.condition checks downstream read
    // from this set, so activation gating is uniform with character
    // conditions.
    resolvedConditions
  };

  // ACTIVATIONS — walk active content's `data.activations[]` declarations,
  // pair with character.activations state, build the Derived manifest,
  // inject active conditions into resolvedConditions, and synthesize
  // variant modifiers into allMods. Runs before phase 2(a) so the rest
  // of phase 2 sees the activation-gated modifiers fire correctly via
  // ctx.resolvedConditions checks in applyTarget. `uses.max` formulas
  // resolve against ctx as it stands now (proficiencyBonus + classLevels
  // available; abilityMods still zero — uses formulas based on ability
  // mods will read 0 until evaluated post-phase-2; note in pack content).
  const availableActivations: AvailableActivation[] = [];
  const charActivations = character.activations ?? {};
  for (const a of active) {
    // Skip spells that are present only because of a receivedBuff —
    // those render in the Received-Buffs panel, not the Activations
    // panel, and their condition injection happens in the parallel
    // block below.
    if (a.row.kind === 'spell' && receivedBuffSpellSlugs.has(a.row.slug)) continue;
    const decls = a.data.activations as ActivationDeclaration[] | undefined;
    if (!Array.isArray(decls)) continue;
    for (const decl of decls) {
      if (!decl || typeof decl.id !== 'string' || typeof decl.condition !== 'string') continue;
      // Attunement / requires gate — item activations (e.g. a cloak's
      // toggled effect) don't surface while the gate is unmet.
      if (!itemRequirementMet(a, decl.appliesWhen)) continue;
      const state = charActivations[decl.id];
      // Rest-pick activations: the activation is "active" whenever a
      // variant is recorded on state. The recorded pick survives until
      // the next matching rest (refreshActivations clears the variant
      // field, which flips the activation back off). No on/off toggle —
      // the panel renders a dropdown with an empty "pick at rest" option.
      const restPickRequired = decl.restPickRequired;
      const isActive =
        restPickRequired !== undefined
          ? typeof state?.variant === 'string' && state.variant.length > 0
          : state?.active === true;

      let usesMax: number | null = null;
      if (decl.uses && decl.uses.max !== undefined) {
        const evaluated = evaluateValue(decl.uses.max, ctx);
        if (typeof evaluated === 'number') usesMax = Math.max(0, Math.floor(evaluated));
      }
      const usesRemaining =
        state?.usesRemaining !== undefined && state?.usesRemaining !== null
          ? Math.max(0, state.usesRemaining)
          : usesMax;

      // Per-weapon dynamic variants: walk equipped inventory for items
      // tagged category=weapon and emit one variant per weapon. The
      // variant id is the weapon's content slug (substituted into the
      // modifier template at synthesis time). Mutually exclusive with
      // static `variants[]` — if both are authored, static wins.
      const variantsFromWeapons = decl.variantsFromWeapons as
        | { modifiers: Array<Record<string, unknown>> }
        | undefined;
      let dynamicVariants: Array<{ id: string; label: string }> | undefined;
      if (variantsFromWeapons && !decl.variants) {
        dynamicVariants = [];
        for (const slot of character.inventory) {
          if (!slot.equipped) continue;
          const itemRow = content({ kind: slot.contentKind, slug: slot.contentSlug });
          if (!itemRow || (itemRow.data as { category?: string }).category !== 'weapon') continue;
          dynamicVariants.push({
            id: slot.contentSlug,
            label: itemRow.name ?? slot.contentSlug
          });
        }
      }

      // Detect slot-aware scaling in the activation's modifier
      // templates. Walked across both the static variants[] and the
      // variantsFromWeapons template (whichever is authored). If any
      // `scalingByCastSlot` shape is found, the manifest carries
      // slotScaling so the panel renders a slot picker. The lowest
      // baseSlotLevel across all references determines the picker's
      // minimum (typically the spell's base level).
      let baseSlotLevel: number | null = null;
      if (variantsFromWeapons) {
        baseSlotLevel = findBaseSlotLevel(variantsFromWeapons.modifiers);
      }
      if (Array.isArray(decl.variants)) {
        for (const v of decl.variants) {
          if (!Array.isArray(v?.modifiers)) continue;
          const got = findBaseSlotLevel(v.modifiers);
          if (got !== null && (baseSlotLevel === null || got < baseSlotLevel))
            baseSlotLevel = got;
        }
      }
      const activeSlot =
        state?.slot !== undefined
          ? state.slot
          : baseSlotLevel !== null
            ? baseSlotLevel
            : undefined;

      const ward = coerceActivationWard(decl.ward);

      availableActivations.push({
        id: decl.id,
        name: decl.name ?? decl.id,
        sourceContent: { kind: a.row.kind, slug: a.row.slug },
        description: decl.description,
        cost: decl.cost,
        duration: formatActivationDuration(decl.duration),
        usesMax,
        usesRemaining,
        refreshOn: decl.uses?.per ?? null,
        ...(decl.concentration ? { concentration: true } : {}),
        ...(decl.group ? { group: decl.group } : {}),
        condition: decl.condition,
        ...(decl.autoCancelOn ? { autoCancelOn: decl.autoCancelOn } : {}),
        ...(decl.variants
          ? { variants: decl.variants.map((v) => ({ id: v.id, label: v.label })) }
          : dynamicVariants
            ? { variants: dynamicVariants }
            : {}),
        ...(baseSlotLevel !== null
          ? { slotScaling: { baseSlotLevel }, ...(activeSlot !== undefined ? { activeSlot } : {}) }
          : {}),
        ...(state?.variant ? { activeVariant: state.variant } : {}),
        ...(restPickRequired ? { restPickRequired } : {}),
        ...(decl.restPickLabel ? { restPickLabel: decl.restPickLabel } : {}),
        ...(ward ? { ward } : {}),
        active: isActive
      });

      if (isActive && decl.condition) {
        resolvedConditions.add(decl.condition);
      }

      // Variant modifier synthesis — only when active AND a variant is
      // picked. Routes stat-modifier / action-modifier / overlay-hp-pool
      // kinds through the standard allMods pipeline. Also resolves any
      // scalingByCastSlot value shapes against the picked slot when the
      // declaration is slot-aware.
      if (isActive && state?.variant && Array.isArray(decl.variants)) {
        const chosen = decl.variants.find((v) => v?.id === state.variant);
        if (chosen && Array.isArray(chosen.modifiers)) {
          for (let i = 0; i < chosen.modifiers.length; i++) {
            const tmpl = chosen.modifiers[i] as Record<string, unknown>;
            const m = (
              activeSlot !== undefined ? substituteScalingByCastSlot(tmpl, activeSlot) : tmpl
            ) as Record<string, unknown>;
            const baseId = `${a.row.kind}/${a.row.slug}/activation/${decl.id}/${state.variant}/${i}`;
            classifyModifier(m, { stat: baseId, action: baseId, overlay: baseId }, a, allMods);
          }
        }
      }

      // Per-weapon variant synthesis: substitute the picked weapon slug
      // into the modifier template's `"__weapon__"` placeholders, then
      // resolve any scalingByCastSlot shapes against the picked slot,
      // then push through the same allMods pipeline. Gate on the variant
      // actually existing in the current dynamic list — if the player
      // picked a weapon that's since been unequipped, no bonus is
      // synthesized (correct behavior).
      if (
        isActive &&
        state?.variant &&
        variantsFromWeapons &&
        dynamicVariants &&
        dynamicVariants.some((v) => v.id === state.variant)
      ) {
        for (let i = 0; i < variantsFromWeapons.modifiers.length; i++) {
          const tmpl = variantsFromWeapons.modifiers[i];
          let m: Record<string, unknown> = substituteWeaponPlaceholder(
            tmpl,
            state.variant
          ) as Record<string, unknown>;
          if (activeSlot !== undefined) {
            m = substituteScalingByCastSlot(m, activeSlot) as Record<string, unknown>;
          }
          const baseId = `${a.row.kind}/${a.row.slug}/activation/${decl.id}/${state.variant}/${i}`;
          classifyModifier(m, { stat: baseId, action: baseId, overlay: baseId }, a, allMods);
        }
      }
    }
  }

  // Receiver-side buffs (Phase A): inject activation conditions for each
  // entry in character.receivedBuffs. The spell's raw modifiers[] are
  // already in allMods (the spell row was force-loaded into active
  // above); their appliesWhen.condition gates fire when the condition
  // is in resolvedConditions. variant + slot picks from the
  // receivedBuff are not yet synthesized through the activation variant
  // pipeline (deferred — most receivable buffs are plain-modifier
  // spells like Shield of Faith / Longstrider that don't need it).
  for (const rb of character.receivedBuffs ?? []) {
    if (!rb || typeof rb.spellSlug !== 'string') continue;
    const spellRow = content({ kind: 'spell', slug: rb.spellSlug });
    if (!spellRow) continue;
    const decls = (spellRow.data.activations as ActivationDeclaration[] | undefined) ?? [];
    for (const decl of decls) {
      if (decl && typeof decl.condition === 'string') {
        resolvedConditions.add(decl.condition);
      }
    }
  }

  // (a) Ability scores
  const abilities: Record<AbilityKey, AbilityCell> = {} as Record<AbilityKey, AbilityCell>;
  for (const ab of ABILITIES) {
    const target = `ability.${ab}`;
    const score = applyTarget(allMods, character, target, character.abilityScores[ab], ctx);
    abilities[ab] = { score: typeof score === 'number' ? score : character.abilityScores[ab], mod: 0 };
  }
  for (const ab of ABILITIES) abilities[ab].mod = abilityModifier(abilities[ab].score);
  for (const ab of ABILITIES) ctx.abilityMods[ab] = abilities[ab].mod;

  // (b) HP max — sum of class HP rolls + (con mod * total level) + flat hp.max modifiers
  let hpBase = 0;
  for (const c of character.classes) {
    for (let lvl = 1; lvl <= c.level; lvl++) {
      hpBase += c.hpRolledPerLevel[lvl - 1] ?? 0;
    }
  }
  hpBase += abilities.con.mod * totalLevel;
  const hpMax = applyTarget(allMods, character, 'hp.max', hpBase, ctx) as number;

  // (c) AC — armor formula from equipped armor, else best unarmored formula.
  const ac = computeAC(character, active, abilities, allMods, ctx);

  // (d) Speeds — start from species walk, accumulate
  const speeds = computeSpeeds(active, allMods, character, ctx);
  // (d.5) Armor strength requirement (RAW): wearing armor whose
  // `strRequired` exceeds the STR *score* reduces every speed by 10 ft.
  // Applied after all other speed math, floored at 0. A mithral-style
  // `armor.ignore-str-requirement` modifier (boolean true, any active
  // source — the armor itself usually) waives the penalty; a mithral row
  // can equally just omit `strRequired`.
  const equippedArmor = findEquippedArmor(active);
  {
    const strRequired = equippedArmor?.data.strRequired;
    if (
      typeof strRequired === 'number' &&
      strRequired > abilities.str.score &&
      !hasBooleanTarget(allMods, 'armor.ignore-str-requirement')
    ) {
      for (const key of Object.keys(speeds)) speeds[key] = Math.max(0, speeds[key] - 10);
    }
  }
  ctx.walkSpeed = speeds.walk ?? 0;

  // (e) Saves — proficient = ability appears in any class's `saves`, OR a
  // content modifier targets `proficiency.save.<ability>` (feat/feature
  // grants like Resilient flow through here).
  //
  // Expertise (doubles the proficiency bonus on the save) is granted via
  // `expertise.save.<ability>` modifiers. Currently emitted only by the
  // `elseAlready` conditional-routing branch in choice synthesis, where
  // a "gain save proficiency, else expertise" feature shape resolves to
  // the expertise target when the character is already proficient.
  // Expertise implies proficiency.
  const saveProficiencies = new Set<AbilityKey>();
  const saveExpertise = new Set<AbilityKey>();
  for (const c of character.classes) {
    const classRow = content({ kind: 'class', slug: c.slug });
    if (!classRow) continue;
    const saves = (classRow.data.saves as AbilityKey[] | undefined) ?? [];
    for (const s of saves) saveProficiencies.add(s);
  }
  for (const a of active) {
    const mods = (a.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const m of mods) {
      if (
        m.kind === 'stat-modifier' &&
        typeof m.target === 'string' &&
        m.value === true
      ) {
        if (m.target.startsWith('proficiency.save.')) {
          saveProficiencies.add(m.target.slice('proficiency.save.'.length) as AbilityKey);
        } else if (m.target.startsWith('expertise.save.')) {
          const ab = m.target.slice('expertise.save.'.length) as AbilityKey;
          saveExpertise.add(ab);
          saveProficiencies.add(ab);
        }
      }
    }
  }
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const target = m.raw.target;
    if (typeof target !== 'string' || m.raw.value !== true) continue;
    if (target.startsWith('proficiency.save.')) {
      saveProficiencies.add(target.slice('proficiency.save.'.length) as AbilityKey);
    } else if (target.startsWith('expertise.save.')) {
      const ab = target.slice('expertise.save.'.length) as AbilityKey;
      saveExpertise.add(ab);
      saveProficiencies.add(ab);
    }
  }
  // Collect save advantage/disadvantage state. Targets:
  //   save.advantage.<ab>         — unconditional per-ability advantage
  //   save.disadvantage.<ab>      — same, disadvantage
  //   save.advantage.all          — every save has advantage
  //   save.advantage.vs-condition.<slug>  — every save vs <slug> has advantage
  //   save.disadvantage.vs-condition.<slug>
  //
  // A modifier carrying a `sourcePredicate` field on a
  // `save.advantage.<ab|all>` or `save.advantage.vs-condition.<slug>`
  // target is NOT folded into the source-agnostic sets above; instead
  // it lands on `savesAdvantageSourceQualified[]` so the encounter
  // runtime can evaluate the predicate against the actual save event.
  // This powers the Gnome's Magic Resistance ("advantage on saves
  // against magic") and Circle of the Land elemental/fey patterns.
  const saveAdvantage = new Set<AbilityKey>();
  const saveDisadvantage = new Set<AbilityKey>();
  const savesAdvantageVs = new Set<string>();
  const savesDisadvantageVs = new Set<string>();
  const savesAdvantageSourceQualified: SaveAdvantageSourceQualified[] = [];
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const target = m.raw.target;
    if (typeof target !== 'string' || m.raw.value !== true) continue;
    const sourcePredicate = coerceSourcePredicate(m.raw.sourcePredicate);
    const sourceContent = {
      kind: m.source.row.kind,
      slug: m.source.row.slug
    };
    if (target === 'save.advantage.all') {
      if (sourcePredicate) {
        savesAdvantageSourceQualified.push({
          ability: 'all',
          sourcePredicate,
          sourceContent
        });
      } else {
        for (const ab of ABILITIES) saveAdvantage.add(ab);
      }
    } else if (target === 'save.disadvantage.all') {
      for (const ab of ABILITIES) saveDisadvantage.add(ab);
    } else if (target.startsWith('save.advantage.vs-condition.')) {
      const condition = target.slice('save.advantage.vs-condition.'.length);
      if (sourcePredicate) {
        savesAdvantageSourceQualified.push({
          vsCondition: condition,
          sourcePredicate,
          sourceContent
        });
      } else {
        savesAdvantageVs.add(condition);
      }
    } else if (target.startsWith('save.disadvantage.vs-condition.')) {
      savesDisadvantageVs.add(target.slice('save.disadvantage.vs-condition.'.length));
    } else if (target.startsWith('save.advantage.')) {
      const ab = target.slice('save.advantage.'.length) as AbilityKey;
      if ((ABILITIES as readonly string[]).includes(ab)) {
        if (sourcePredicate) {
          savesAdvantageSourceQualified.push({
            ability: ab,
            sourcePredicate,
            sourceContent
          });
        } else {
          saveAdvantage.add(ab);
        }
      }
    } else if (target.startsWith('save.disadvantage.')) {
      const ab = target.slice('save.disadvantage.'.length) as AbilityKey;
      if ((ABILITIES as readonly string[]).includes(ab)) saveDisadvantage.add(ab);
    }
  }
  const saves: Record<AbilityKey, SaveCell> = {} as Record<AbilityKey, SaveCell>;
  for (const ab of ABILITIES) {
    const proficient = saveProficiencies.has(ab);
    const expertise = saveExpertise.has(ab);
    const base =
      abilities[ab].mod +
      (proficient ? proficiencyBonus : 0) +
      (expertise && proficient ? proficiencyBonus : 0);
    const bonus = applyTarget(allMods, character, `save.${ab}`, base, ctx) as number;
    saves[ab] = {
      bonus,
      proficient,
      expertise,
      advantage: saveAdvantage.has(ab),
      disadvantage: saveDisadvantage.has(ab)
    };
  }

  // (f) Skills
  const skillProficiencies = new Set<string>();
  const skillExpertise = new Set<string>();
  for (const skill of character.proficienciesChosen.skills ?? []) skillProficiencies.add(skill);
  for (const a of active) {
    // class/species/background/feat may grant fixed skill proficiencies via
    // stat modifiers. Two prefixes:
    //   `proficiency.skill.<slug>` — base proficiency
    //   `expertise.skill.<slug>`   — expertise (doubles proficiency bonus)
    // Both also flow through the synthesised stat-modifier list `allMods`,
    // so feat-choice and background-choice picks (which live in allMods,
    // not a.data.modifiers) are observed.
    const mods = (a.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const m of mods) {
      if (
        m.kind === 'stat-modifier' &&
        typeof m.target === 'string' &&
        m.value === true
      ) {
        if (m.target.startsWith('proficiency.skill.')) {
          skillProficiencies.add(m.target.slice('proficiency.skill.'.length));
        } else if (m.target.startsWith('expertise.skill.')) {
          skillExpertise.add(m.target.slice('expertise.skill.'.length));
        }
      }
    }
  }
  // Synthesised modifiers (from background-ASI / feat-choice loops) live in
  // allMods rather than per-content data — pull skill grants from there too.
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const target = m.raw.target;
    if (typeof target !== 'string' || m.raw.value !== true) continue;
    if (target.startsWith('proficiency.skill.')) {
      skillProficiencies.add(target.slice('proficiency.skill.'.length));
    } else if (target.startsWith('expertise.skill.')) {
      skillExpertise.add(target.slice('expertise.skill.'.length));
    }
  }
  // Jack of All Trades: add floor(PB/2) to non-proficient skill checks.
  const halfProfBonus = allMods.some(
    (m) => m.kind === 'stat-modifier' && m.raw.target === 'skill.half-proficiency-bonus' && m.raw.value === true
  ) ? Math.floor(proficiencyBonus / 2) : 0;
  // Skill + ability-check advantage channels. Boolean targets (value true):
  //   skill.advantage.<slug> / skill.disadvantage.<slug>
  //   skill.advantage.all    / skill.disadvantage.all
  //   check.advantage.<ab>   / check.disadvantage.<ab>  — every skill of
  //     that ability, plus recorded on stats.abilityCheckAdvantage for
  //     raw checks.
  // Numeric target: check.bonus.<ab> — added to every skill of that
  // ability (initiative deliberately stays separate; it has its own
  // `initiative` target).
  // Dice-valued targets (value: a die string like '1d4'):
  //   check.bonusDice.<ab>    — bonus die on every check of that ability
  //   skill.bonusDice.<slug>  — bonus die on one skill's checks
  // (strixhaven primers, guidance-style items). These never fold into
  // the numeric bonus — the roll-time consumer adds the die.
  // Both advantage and disadvantage can end up true — derive reports both;
  // cancellation is the roll-time runtime's business.
  const skillAdvantage = new Set<string>();
  const skillDisadvantage = new Set<string>();
  const checkAdvantage = new Set<AbilityKey>();
  const checkDisadvantage = new Set<AbilityKey>();
  const checkBonus: Partial<Record<AbilityKey, number>> = {};
  const checkBonusDice: Partial<Record<AbilityKey, string[]>> = {};
  const skillBonusDice: Record<string, string[]> = {};
  // d20 floors — "treat a d20 roll of N or lower as N" (Reliable Talent,
  // Circle of the Stars' Dragon, Silver Tongue, Ear for Deceit). Numeric,
  // implicitly UPGRADE: the highest floor wins and a declared mode is not
  // read. `check.d20Floor` covers every ability check (and folds into
  // every skill cell); `skill.d20Floor.<slug>` narrows to one skill;
  // `save.d20Floor` covers saving throws.
  let checkD20Floor = 0;
  let saveD20Floor = 0;
  const skillD20Floor: Record<string, number> = {};
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const t = m.raw.target;
    if (typeof t !== 'string') continue;
    if (m.raw.value === true) {
      if (t === 'skill.advantage.all') for (const s of SKILLS) skillAdvantage.add(s);
      else if (t === 'skill.disadvantage.all') for (const s of SKILLS) skillDisadvantage.add(s);
      else if (t.startsWith('skill.advantage.')) skillAdvantage.add(t.slice('skill.advantage.'.length));
      else if (t.startsWith('skill.disadvantage.')) skillDisadvantage.add(t.slice('skill.disadvantage.'.length));
      else if (t.startsWith('check.advantage.')) {
        const ab = t.slice('check.advantage.'.length) as AbilityKey;
        if ((ABILITIES as readonly string[]).includes(ab)) checkAdvantage.add(ab);
      } else if (t.startsWith('check.disadvantage.')) {
        const ab = t.slice('check.disadvantage.'.length) as AbilityKey;
        if ((ABILITIES as readonly string[]).includes(ab)) checkDisadvantage.add(ab);
      }
    }
    if (t.startsWith('check.bonusDice.')) {
      const ab = t.slice('check.bonusDice.'.length) as AbilityKey;
      if ((ABILITIES as readonly string[]).includes(ab) && typeof m.raw.value === 'string' && m.raw.value.length > 0) {
        (checkBonusDice[ab] ??= []).push(m.raw.value);
      }
    } else if (t.startsWith('skill.bonusDice.')) {
      const skill = t.slice('skill.bonusDice.'.length);
      if (typeof m.raw.value === 'string' && m.raw.value.length > 0) {
        (skillBonusDice[skill] ??= []).push(m.raw.value);
      }
    } else if (t.startsWith('check.bonus.')) {
      const ab = t.slice('check.bonus.'.length) as AbilityKey;
      if ((ABILITIES as readonly string[]).includes(ab)) {
        const v = evaluateValue(m.raw.value, ctx);
        if (typeof v === 'number') checkBonus[ab] = (checkBonus[ab] ?? 0) + v;
      }
    } else if (t === 'check.d20Floor' || t === 'save.d20Floor' || t.startsWith('skill.d20Floor.')) {
      const v = evaluateValue(m.raw.value, ctx);
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      const floor = Math.floor(v);
      if (t === 'check.d20Floor') checkD20Floor = Math.max(checkD20Floor, floor);
      else if (t === 'save.d20Floor') saveD20Floor = Math.max(saveD20Floor, floor);
      else {
        const skill = t.slice('skill.d20Floor.'.length);
        if (skill) skillD20Floor[skill] = Math.max(skillD20Floor[skill] ?? 0, floor);
      }
    }
  }
  // Equipped armor with stealthDisadvantage → disadvantage on Stealth
  // checks, unless a mithral-style `armor.ignore-stealth-disadvantage`
  // modifier is active (the armor row itself usually authors it).
  if (
    equippedArmor?.data.stealthDisadvantage === true &&
    !hasBooleanTarget(allMods, 'armor.ignore-stealth-disadvantage')
  ) {
    skillDisadvantage.add('stealth');
  }
  const skills: Record<string, SkillCell> = {};
  for (const skill of SKILLS) {
    const ability = SKILL_ABILITY[skill];
    const proficient = skillProficiencies.has(skill);
    const expertise = skillExpertise.has(skill);
    const base =
      abilities[ability].mod +
      (proficient ? proficiencyBonus : halfProfBonus) +
      (expertise && proficient ? proficiencyBonus : 0);
    const bonus =
      (applyTarget(allMods, character, `skill.${skill}`, base, ctx) as number) +
      (checkBonus[ability] ?? 0);
    const bonusDice = [...(skillBonusDice[skill] ?? []), ...(checkBonusDice[ability] ?? [])];
    const floor = Math.max(skillD20Floor[skill] ?? 0, checkD20Floor);
    skills[skill] = {
      bonus,
      ability,
      proficient,
      expertise,
      advantage: skillAdvantage.has(skill) || checkAdvantage.has(ability),
      disadvantage: skillDisadvantage.has(skill) || checkDisadvantage.has(ability),
      ...(bonusDice.length > 0 ? { bonusDice } : {}),
      ...(floor > 0 ? { d20Floor: floor } : {})
    };
  }
  const abilityCheckAdvantage: StatBlock['abilityCheckAdvantage'] = {};
  for (const ab of ABILITIES) {
    const adv = checkAdvantage.has(ab);
    const dis = checkDisadvantage.has(ab);
    if (adv && dis) abilityCheckAdvantage[ab] = 'both';
    else if (adv) abilityCheckAdvantage[ab] = 'advantage';
    else if (dis) abilityCheckAdvantage[ab] = 'disadvantage';
  }

  // (f.5) Languages + tools + armor/weapon proficiencies — explicit picks
  // plus any modifier targeting `proficiency.language.<slug>` /
  // `proficiency.tool.<slug>` / `proficiency.armor.<slug>` /
  // `proficiency.weapon.<slug>` (from class/species/feature/feat synthesis).
  const languages = new Set<string>(character.proficienciesChosen.languages ?? []);
  const tools = new Set<string>(character.proficienciesChosen.tools ?? []);
  const armorProficiencies = new Set<string>();
  const weaponProficiencies = new Set<string>();
  for (const a of active) {
    const mods = (a.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const m of mods) {
      if (m.kind !== 'stat-modifier' || m.value !== true) continue;
      const t = m.target;
      if (typeof t !== 'string') continue;
      if (t.startsWith('proficiency.language.')) languages.add(t.slice('proficiency.language.'.length));
      else if (t.startsWith('proficiency.tool.')) tools.add(t.slice('proficiency.tool.'.length));
      else if (t.startsWith('proficiency.armor.')) armorProficiencies.add(t.slice('proficiency.armor.'.length));
      else if (t.startsWith('proficiency.weapon.')) weaponProficiencies.add(t.slice('proficiency.weapon.'.length));
    }
  }
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier' || m.raw.value !== true) continue;
    const t = m.raw.target;
    if (typeof t !== 'string') continue;
    if (t.startsWith('proficiency.language.')) languages.add(t.slice('proficiency.language.'.length));
    else if (t.startsWith('proficiency.tool.')) tools.add(t.slice('proficiency.tool.'.length));
    else if (t.startsWith('proficiency.armor.')) armorProficiencies.add(t.slice('proficiency.armor.'.length));
    else if (t.startsWith('proficiency.weapon.')) weaponProficiencies.add(t.slice('proficiency.weapon.'.length));
  }

  // (g) Spellcasting
  const spellInfo = computeSpellcasting(character, active, abilities, proficiencyBonus, content);

  // Overlay spell-slot consumption from character.resourcesSpent. Slot keys
  // use `spell-slot/L<n>` so they don't collide with activity/trigger ids.
  // Capped at max so a stale spend value can't go negative.
  const slotSpent = character.resourcesSpent ?? {};
  for (const [lvlStr, slot] of Object.entries(spellInfo.slots)) {
    const lvl = Number(lvlStr);
    const used = slotSpent[`spell-slot/L${lvl}`] ?? 0;
    spellInfo.slots[lvl] = { max: slot.max, used: Math.min(slot.max, Math.max(0, used)) };
  }

  // (h) Resistances/immunities/vulnerabilities. The flat sets carry every
  // damage type granted; the qualifier maps carry the qualifier (nonmagical,
  // spell, creature-type slug) for entries that aren't unconditional. An
  // unconditional modifier trumps a later qualified one for the same type
  // (resistance to bludgeoning + resistance to nonmagical bludgeoning =>
  // unconditional resistance to bludgeoning).
  const resistances = new Set<string>();
  const immunities = new Set<string>();
  const vulnerabilities = new Set<string>();
  const resistanceQualifiers: Record<string, string> = {};
  const immunityQualifiers: Record<string, string> = {};
  const vulnerabilityQualifiers: Record<string, string> = {};
  // Structured source-predicate companions to the qualifier-string maps.
  // Populated whenever a modifier carries an explicit `sourcePredicate`
  // OR a legacy `qualifier` string with a source-side interpretation
  // ('spell', 'magical', 'creatureType:<slug>'). The 'nonmagical'
  // qualifier is damage-side, not source-side, so it doesn't populate
  // here. The encounter runtime reads these to filter resistances at
  // damage-application time via matchesDamageSource.
  const resistanceSourcePredicates: Record<string, DamageSourcePredicate> = {};
  const immunitySourcePredicates: Record<string, DamageSourcePredicate> = {};
  const vulnerabilitySourcePredicates: Record<string, DamageSourcePredicate> = {};
  const unconditional = {
    res: new Set<string>(),
    imm: new Set<string>(),
    vul: new Set<string>()
  };
  function recordQualified(
    set: Set<string>,
    quals: Record<string, string>,
    preds: Record<string, DamageSourcePredicate>,
    unc: Set<string>,
    type: string,
    qualifier: string | undefined,
    sourcePredicate: DamageSourcePredicate | undefined
  ): void {
    set.add(type);
    if (qualifier === undefined && sourcePredicate === undefined) {
      // Unconditional entry — wins over any prior qualified entry.
      unc.add(type);
      delete quals[type];
      delete preds[type];
    } else if (!unc.has(type)) {
      // Qualified entry — record the qualifier string AND the
      // structured predicate (if either is available). First-write-
      // wins per type, matching the existing semantics of `quals`.
      if (quals[type] === undefined && qualifier !== undefined) {
        quals[type] = qualifier;
      }
      if (preds[type] === undefined) {
        const pred = sourcePredicate ?? (qualifier !== undefined
          ? predicateFromQualifierString(qualifier)
          : undefined);
        if (pred) preds[type] = pred;
      }
    }
  }
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const target = m.raw.target as string;
    if (!target || m.raw.value !== true) continue;
    // Honor appliesWhen.condition — activation-gated immunities (Form
    // of Dread immunity.frightened, etc.) only fire when the relevant
    // condition is in resolvedConditions.
    const appliesWhen = m.raw.appliesWhen as { condition?: string } | undefined;
    if (
      appliesWhen?.condition &&
      !(ctx.resolvedConditions ?? new Set<string>()).has(appliesWhen.condition)
    )
      continue;
    const qualifier =
      typeof m.raw.qualifier === 'string' ? (m.raw.qualifier as string) : undefined;
    const sourcePredicate = coerceSourcePredicate(m.raw.sourcePredicate);
    if (target.startsWith('resistance.')) {
      recordQualified(
        resistances,
        resistanceQualifiers,
        resistanceSourcePredicates,
        unconditional.res,
        target.slice('resistance.'.length),
        qualifier,
        sourcePredicate
      );
    } else if (target.startsWith('immunity.')) {
      recordQualified(
        immunities,
        immunityQualifiers,
        immunitySourcePredicates,
        unconditional.imm,
        target.slice('immunity.'.length),
        qualifier,
        sourcePredicate
      );
    } else if (target.startsWith('vulnerability.')) {
      recordQualified(
        vulnerabilities,
        vulnerabilityQualifiers,
        vulnerabilitySourcePredicates,
        unconditional.vul,
        target.slice('vulnerability.'.length),
        qualifier,
        sourcePredicate
      );
    }
  }

  // (i) Senses
  const senses: Record<string, number> = {};
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const target = m.raw.target as string;
    if (!target) continue;
    if (target.startsWith('sense.')) {
      const senseName = target.slice('sense.'.length);
      const value = evaluateValue(m.raw.value, ctx);
      if (typeof value === 'number') {
        const current = senses[senseName] ?? 0;
        const mode = (m.raw.mode as Mode) ?? 'OVERRIDE';
        senses[senseName] = applyNumericMode(current, mode, value);
      }
    }
  }

  // (j) Curated trait flags — `trait.<slug>` boolean targets append the
  // slug. Any slug is allowed (no validation gate); canonical slugs are
  // documented in docs/rules-engine.md.
  const traits = new Set<string>();
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier' || m.raw.value !== true) continue;
    const t = m.raw.target;
    if (typeof t === 'string' && t.startsWith('trait.')) {
      const slug = t.slice('trait.'.length);
      if (slug.length > 0) traits.add(slug);
    }
  }

  // Passive Perception per RAW: 10 + Perception bonus, +5 with advantage
  // on the check, −5 with disadvantage. Simultaneous adv+dis cancel.
  const perceptionCell = skills.perception;
  const passivePerception =
    10 +
    perceptionCell.bonus +
    (perceptionCell.advantage && !perceptionCell.disadvantage ? 5 : 0) -
    (perceptionCell.disadvantage && !perceptionCell.advantage ? 5 : 0);

  const stats: StatBlock = {
    abilities,
    saves,
    skills,
    ac,
    hp: { current: character.currentHp, max: hpMax, temp: character.tempHp },
    speeds,
    proficiencyBonus,
    initiative: applyTarget(allMods, character, 'initiative', abilities.dex.mod, ctx) as number,
    initiativeAdvantage: allMods.some(
      (m) =>
        m.kind === 'stat-modifier' &&
        m.raw.target === 'initiative.advantage' &&
        m.raw.value === true
    ),
    savesAdvantageVs: [...savesAdvantageVs].sort(),
    savesDisadvantageVs: [...savesDisadvantageVs].sort(),
    passivePerception,
    spellSaveDC: spellInfo.dc,
    spellAttackBonus: spellInfo.attack,
    spellcastingAbility: spellInfo.ability,
    spellSlots: spellInfo.slots,
    totalLevel,
    resistances,
    immunities,
    vulnerabilities,
    resistanceQualifiers,
    immunityQualifiers,
    vulnerabilityQualifiers,
    resistanceSourcePredicates,
    immunitySourcePredicates,
    vulnerabilitySourcePredicates,
    savesAdvantageSourceQualified,
    senses,
    languages: [...languages].sort(),
    tools: [...tools].sort(),
    armorProficiencies: [...armorProficiencies].sort(),
    weaponProficiencies: [...weaponProficiencies].sort(),
    attackedAdvantage: allMods.some(
      (m) => m.kind === 'stat-modifier' && m.raw.target === 'attacked.advantage' && m.raw.value === true
    ),
    attackedDisadvantage: allMods.some(
      (m) => m.kind === 'stat-modifier' && m.raw.target === 'attacked.disadvantage' && m.raw.value === true
    ),
    attackedByMeleeAdvantage: allMods.some(
      (m) =>
        m.kind === 'stat-modifier' && m.raw.target === 'attacked-by-melee.advantage' && m.raw.value === true
    ),
    attackedByRangedDisadvantage: allMods.some(
      (m) =>
        m.kind === 'stat-modifier' &&
        m.raw.target === 'attacked-by-ranged.disadvantage' &&
        m.raw.value === true
    ),
    attackedWithin5ftAutoCrit: allMods.some(
      (m) =>
        m.kind === 'stat-modifier' &&
        m.raw.target === 'tag.attacked-within-5ft-auto-crit' &&
        m.raw.value === true
    ),
    abilityCheckAdvantage,
    abilityCheckBonusDice: checkBonusDice,
    ...(checkD20Floor > 0 ? { checkD20Floor } : {}),
    ...(saveD20Floor > 0 ? { saveD20Floor } : {}),
    traits: [...traits].sort(),
    incomingCritImmune: hasBooleanTarget(allMods, 'tag.incoming-crit-immune'),
    deathSaveAdvantage: hasBooleanTarget(allMods, 'deathsave.advantage'),
    hitDiceMaximized: hasBooleanTarget(allMods, 'hitDice.maximize')
  };

  const phase: DerivePhaseState = {
    character,
    content,
    active,
    allMods,
    formScopedMods,
    ctx,
    validations,
    resolvedConditions,
    stats,
    actions: [],
    triggers: [],
    boundWeaponData: new Map()
  };

  // -------------------------------------------------------------------------
  // PHASE 2.5 — cross-row upgrades. Rewrites another active row's `data`
  // (copy-on-write) before anything downstream reads it, so every phase-3+
  // consumer sees the upgraded declaration.
  // -------------------------------------------------------------------------
  applyDeclarationUpgrades(phase);

  // -------------------------------------------------------------------------
  // PHASE 3 — assemble activities (as concrete Actions)
  // -------------------------------------------------------------------------
  assembleActivities(phase);
  const { actions, triggers } = phase;

  // -------------------------------------------------------------------------
  // PHASE 4 — apply action modifiers
  // -------------------------------------------------------------------------
  applyActionModifiers(phase);

  // -------------------------------------------------------------------------
  // PHASE 5 — register triggers
  // -------------------------------------------------------------------------
  registerTriggers(phase);

  // -------------------------------------------------------------------------
  // PHASE 6 — validate (soft)
  // -------------------------------------------------------------------------

  runSoftValidations(phase);

  // -------------------------------------------------------------------------
  // Remaining Derived manifests, each assembled by its own helper.
  // -------------------------------------------------------------------------
  const resources = collectResources(phase, freeCastEntries);
  const toggles = collectToggles(phase);
  const outboundEffects = collectOutboundEffects(phase);
  synthesizePickedManeuvers(phase, outboundEffects);
  const pendingFeatureChoices = collectPendingFeatureChoices(phase);
  const pendingItemChoices = collectPendingItemChoices(phase);
  const overlayHpPools = collectOverlayHpPools(phase);
  const equipped = computeEquippedState(active);
  const activeForm = resolveActiveForm(phase);
  const companions = resolveCompanions(phase);
  const classResources = resolveClassResources(phase);

  return {
    stats,
    actions,
    triggers,
    resources,
    validations,
    toggles,
    alwaysPreparedFromContent: [...alwaysPreparedFromContent].sort(),
    outboundEffects,
    overlayHpPools,
    pendingFeatureChoices,
    pendingItemChoices,
    availableActivations,
    equipped,
    ...(activeForm !== undefined ? { activeForm } : {}),
    ...(companions !== undefined ? { companions } : {}),
    ...(classResources !== undefined ? { classResources } : {})
  };
}

/** PHASE 2.5 — cross-row upgrades (`upgrade.<rowSlug>.<path>`).
 *
 *  Runs after the stat block is composed (so `ctx` tokens resolve) and
 *  before phase 3, writing into a copy-on-write clone of the target row's
 *  `data`. Everything phase 3+ reads — activities, `uses` blocks, class
 *  resources, triggers, maneuvers, outbound effects, summons — therefore
 *  sees the upgraded numbers with no per-consumer plumbing.
 *
 *  Deliberate scope limit: phase 2 has already composed the stat block, so
 *  an upgrade aimed at a row's `modifiers[]` does NOT retroactively change
 *  stats. Stat numbers stack through their own targets (that's what ADD is
 *  for); this channel is for *declarations*. */
function applyDeclarationUpgrades(s: DerivePhaseState): void {
  const { character, active, allMods, ctx, validations } = s;

  const eligible = allMods.filter(
    (m) =>
      m.kind === 'stat-modifier' &&
      typeof m.raw.target === 'string' &&
      (m.raw.target as string).startsWith(UPGRADE_TARGET_PREFIX) &&
      modifierIsEligible(m, character, ctx)
  );
  if (eligible.length === 0) return;

  const mods: UpgradeModifier[] = sortByPriority(eligible).map((m) => ({
    target: m.raw.target as string,
    value: m.raw.value,
    mode: (m.raw.mode as Mode | undefined) ?? 'ADD',
    sourceSlug: m.source.row.slug
  }));

  const rows: UpgradeTargetRow[] = active.map((a) => ({
    slug: a.row.slug,
    get data() {
      return a.data;
    },
    setData(next: Record<string, unknown>) {
      a.data = next;
    }
  }));

  for (const w of applyCrossRowUpgrades(rows, mods, ctx)) {
    validations.push({ severity: 'warning', code: w.code, message: w.message });
  }
}

/** PHASE 3 — realize every active row's activities[] into concrete Actions:
 *  weapon-activity synthesis for bare items, character-wide crit defaults,
 *  and extra-attack aggregation. Pushes onto s.actions. */
function assembleActivities(s: DerivePhaseState): void {
  const { character, content, active, allMods, ctx, stats, actions } = s;

  // Character-wide crit defaults composed from modifier targets:
  //   crit.threshold        — natural roll required to crit (DOWNGRADE to 19/18)
  //   crit.extra-weapon-die — extra weapon dice on a crit (Savage Attacks)
  // These land on every weapon-attack action emitted below.
  const charCritThreshold = applyTarget(allMods, character, 'crit.threshold', 20, ctx);
  const charCritExtraDie = applyTarget(allMods, character, 'crit.extra-weapon-die', 0, ctx);

  for (const a of active) {
    // Attunement / requires gate filters item activities; an unattuned
    // attunement weapon falls back to the synthesized plain weapon
    // attack below (it still swings as a mundane weapon).
    let activities = gatedActivities(a);
    let realizeSource = a;
    if (activities.length === 0 && a.row.kind === 'item') {
      if (a.data.baseWeaponFromChoice === true) {
        // Generic-variant weapon (Flame Tongue "any sword"): the item's
        // attack is synthesized FROM the picked base weapon's row. An
        // explicit activities[] on the item wins over synthesis (we're
        // in the empty branch); without a pick the item contributes no
        // attack — pendingItemChoices surfaces the gap.
        const bound = resolveBoundWeaponSynthesis(a, content);
        if (bound) {
          activities = [bound.activity];
          realizeSource = bound.source;
          s.boundWeaponData.set(
            `item/${a.row.slug}/${bound.activity.id as string}`,
            bound.source.data
          );
        }
      } else {
        const synth = synthesizeWeaponActivity(a.row.slug, a.row.name, a.data);
        if (synth) activities = [synth];
      }
    }
    for (const act of activities) {
      const action = realizeActivity(act, realizeSource, character, stats, content, ctx);
      if (!action) continue;
      // Crit fields only land on weapon attacks. Spell attacks crit on 20
      // and don't roll extra weapon dice.
      if (action.type === 'attack' && action.attackAbility && action.attackAbility !== undefined) {
        const isSpellAttack = (act.attack as { classification?: string } | undefined)?.classification === 'spell';
        if (!isSpellAttack) {
          if (typeof charCritThreshold === 'number' && charCritThreshold < 20)
            action.critThreshold = charCritThreshold;
          if (typeof charCritExtraDie === 'number' && charCritExtraDie > 0)
            action.critExtraDie = charCritExtraDie;
        }
      }
      actions.push(action);
    }

    // Spell storage (Ring of Spell Storing): an equipped, gate-passing
    // item with `data.spellStorage` emits one cast Action per entry in
    // its inventory slot's `stored[]` — the spell row inlined at the
    // stored level, with the storer's DC / attack bonus overriding the
    // wearer's own when recorded. Capacity is enforced only as the
    // spell-storage-over-capacity soft warning (phase 6).
    if (
      a.row.kind === 'item' &&
      a.data.spellStorage &&
      a.inventorySlot?.stored?.length &&
      itemRequirementMet(a, undefined)
    ) {
      for (const action of realizeStoredSpells(a, character, stats, content, ctx)) {
        actions.push(action);
      }
    }
  }

  // Aggregate extraAttacks from active features and set attackCount on
  // main-hand weapon attack actions (type 'attack', cost 'action').
  // extraAttacks: 1 means one additional attack (2 total); stacking grants
  // from Fighter L11/L20 accumulate additively so attackCount = 1 + sum.
  //
  // The `extra-attacks` modifier target rides the same total — the
  // cross-row way to say "Extra Attack becomes three attacks"
  // (`OVERRIDE 2`) without re-declaring the earlier feature's row.
  let totalExtraAttacks = 0;
  for (const a of active) {
    const extra = a.data.extraAttacks as number | undefined;
    if (typeof extra === 'number' && extra > 0) {
      totalExtraAttacks += extra;
    }
  }
  const bumpedExtraAttacks = applyTarget(allMods, character, 'extra-attacks', totalExtraAttacks, ctx);
  if (typeof bumpedExtraAttacks === 'number' && Number.isFinite(bumpedExtraAttacks)) {
    totalExtraAttacks = Math.max(0, Math.floor(bumpedExtraAttacks));
  }
  if (totalExtraAttacks > 0) {
    for (const action of actions) {
      if (action.type === 'attack' && action.cost === 'action') {
        action.attackCount = 1 + totalExtraAttacks;
      }
    }
  }
}

/** PHASE 4 — run every enabled action-modifier whose appliesTo block
 *  matches against each assembled Action, mutating the Action in place. */
function applyActionModifiers(s: DerivePhaseState): void {
  const { character, content, allMods, ctx, actions } = s;

  for (const action of actions) {
    const sourceRow = content(action.sourceContent);
    // Bound base weapons: predicate matching sees the merged (base +
    // item) data recorded at synthesis time, not the item's bare row.
    const sourceData = s.boundWeaponData.get(action.id) ?? sourceRow?.data;
    const actionCtx = buildActionContext(action, sourceData);
    for (const m of allMods) {
      if (m.kind !== 'action-modifier') continue;
      const enabled =
        character.modifierToggles[m.id] ?? (m.raw.defaultEnabled as boolean | undefined) ?? true;
      const appliesWhen = m.raw.appliesWhen as { condition?: string } | undefined;
      if (appliesWhen?.condition && !(ctx.resolvedConditions ?? new Set<string>()).has(appliesWhen.condition)) continue;
      if (!enabled) continue;
      const appliesTo = m.raw.appliesTo as
        | { activityType?: string; predicates?: Array<Record<string, unknown>> }
        | undefined;
      if (!predicateMatches(actionCtx, appliesTo)) continue;

      const effects = (m.raw.effects as Array<Record<string, unknown>> | undefined) ?? [];
      for (const eff of effects) {
        applyActionEffect(action, eff, ctx);
      }
      const limit = m.raw.limit as { per: string; uses: number } | undefined;
      action.appliedModifiers.push({
        modifierId: m.id,
        sourceContent: { kind: m.source.row.kind, slug: m.source.row.slug },
        name: (m.raw.name as string | undefined) ?? m.id,
        ...(limit ? { limit } : {})
      });
    }
  }
}

/** PHASE 5 — collect trigger declarations (with unknown-event soft
 *  warnings) and synthesize gated weapon-attack actions for grants that
 *  request one. Pushes onto s.triggers and s.actions. */
function registerTriggers(s: DerivePhaseState): void {
  const { allMods, validations, actions, triggers } = s;

  const knownEvents = new Set<string>(KNOWN_TRIGGER_EVENTS);
  for (const m of allMods) {
    if (m.kind !== 'trigger') continue;
    const on = ((m.raw.on as string[] | undefined) ?? []).slice();
    for (const ev of on) {
      if (!knownEvents.has(ev)) {
        validations.push({
          severity: 'warning',
          code: 'unknown-trigger-event',
          message: `Trigger '${m.id}' references unknown event '${ev}'.`
        });
      }
    }
    const triggerTable = coerceRandomTable(m.raw.randomTable);
    triggers.push({
      id: m.id,
      sourceContent: { kind: m.source.row.kind, slug: m.source.row.slug },
      name: (m.raw.name as string | undefined) ?? m.id,
      on,
      scope: m.raw.scope,
      grants: coerceTriggerGrant(m.raw.grants),
      limit: m.raw.limit as { per: string; uses: number } | undefined,
      ...(typeof m.raw.description === 'string' ? { description: m.raw.description } : {}),
      ...(triggerTable ? { randomTable: triggerTable } : {})
    });
  }

  // After triggers are collected, synthesize gated weapon-attack actions
  // for triggers whose grant requests one. The synthesized action is a
  // copy of the primary weapon attack with cost flipped (bonus / reaction)
  // and gatedOnTrigger pointing at the trigger id. The encounter runtime
  // gates execution; derive only surfaces the option.
  const primaryWeaponAttack = actions.find(
    (a) => a.type === 'attack' && a.cost === 'action' && a.sourceContent.kind === 'item'
  );
  if (primaryWeaponAttack) {
    for (const t of triggers) {
      const grants = t.grants;
      if (!grants) continue;
      let cost: Action['cost'] | undefined;
      if (grants.type === 'bonus-action-weapon-attack') cost = 'bonus';
      else if (grants.type === 'reaction-weapon-attack') cost = 'reaction';
      if (!cost) continue;
      actions.push({
        ...primaryWeaponAttack,
        id: `${t.sourceContent.kind}/${t.sourceContent.slug}/${t.id}/gated-attack`,
        sourceContent: t.sourceContent,
        name: t.name,
        cost,
        gatedOnTrigger: t.id,
        appliedModifiers: []
      });
    }
  }
}

/** Activity `type` strings realizeActivity understands (plus reserved /
 *  legacy synonyms). Anything else falls through to the 'utility'
 *  default at realization time, so a typo silently degrades — the
 *  unknown-activity-type soft warning below surfaces it to authors.
 *    - 'summon' realizes into an Action carrying `summons` (see
 *      realizeActivity); unresolved monster slugs get the
 *      summon-missing-content soft warning below.
 *    - 'cast' is a legacy synonym used by SRD faithful-steed (cast
 *      without a slot); 'heal' marks healing activities whose dice the
 *      generic damage.parts path already surfaces.
 *    - 'maneuver-rider' is the synthesized maneuver action type. */
const KNOWN_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'attack',
  'save',
  'damage',
  'heal',
  'cast',
  'cast-spell',
  'utility',
  'summon',
  'maneuver-rider'
]);

/** PHASE 6 (validate) — attunement / prepared-spell-count / predicate-DSL
 *  / activity-type soft warnings. Pushes onto s.validations. */
function runSoftValidations(s: DerivePhaseState): void {
  const { character, content, active, allMods, stats, validations } = s;

  // Attunement
  const attunedCount = character.inventory.filter((i) => i.attuned).length;
  if (attunedCount > 3) {
    validations.push({
      severity: 'warning',
      code: 'attunement-over-limit',
      message: `${attunedCount} items attuned (max 3)`
    });
  }

  // Prepared spell count (Wizard rule: INT mod + wizard level for prep limit)
  for (const c of character.classes) {
    const classRow = content({ kind: 'class', slug: c.slug });
    if (!classRow) continue;
    const spellcasting = classRow.data.spellcasting as
      | { ability: AbilityKey; progression: string }
      | null
      | undefined;
    if (!spellcasting || spellcasting.progression !== 'full') continue;
    const limit = Math.max(1, stats.abilities[spellcasting.ability].mod + c.level);
    if (character.spells.prepared.length > limit) {
      validations.push({
        severity: 'warning',
        code: 'prepared-spells-over-limit',
        message: `${character.spells.prepared.length} prepared (limit ${limit})`
      });
    }
  }

  // Unknown activity types — realizeActivity defaults unrecognized
  // types to 'utility', so a typo ('atack') silently drops the attack
  // math. Mirror the unknown-trigger-event pattern: warn per authored
  // activity whose `type` string isn't in the known set. Absent types
  // are legal (they intentionally default to utility).
  for (const a of active) {
    const acts = (a.data.activities as Array<Record<string, unknown>> | undefined) ?? [];
    for (const act of acts) {
      const t = act.type;
      if (typeof t === 'string' && !KNOWN_ACTIVITY_TYPES.has(t)) {
        validations.push({
          severity: 'warning',
          code: 'unknown-activity-type',
          message: `Activity '${(act.id as string | undefined) ?? '?'}' on ${a.row.kind}/${a.row.slug} has unknown type '${t}'.`
        });
      }
      // Summon activities referencing monster rows the lookup can't
      // resolve. Deliberately NOT an `unknown-*` code (the packs QC gate
      // hard-fails T3 rows on unknown-*): packs may summon monsters
      // shipped in a different pack or in operator homebrew, so an
      // unresolved slug against a partial lookup isn't proof of an
      // authoring error. The action still realizes; the runtime falls
      // back to a 0-HP companion shell the DM can edit.
      if (t === 'summon') {
        const spec = act.summon as
          | { creatures?: Array<{ slug?: unknown }> }
          | undefined;
        for (const c of spec?.creatures ?? []) {
          if (typeof c?.slug !== 'string' || c.slug.length === 0) continue;
          if (!content({ kind: 'monster', slug: c.slug })) {
            validations.push({
              severity: 'warning',
              code: 'summon-missing-content',
              message: `Summon activity '${(act.id as string | undefined) ?? '?'}' on ${a.row.kind}/${a.row.slug} references unresolved monster '${c.slug}'.`
            });
          }
        }
      }
    }
  }

  // Spell-storage capacity — Σ stored levels vs data.spellStorage.maxLevels.
  // Soft warning only (never blocks a save, never gates the cast actions),
  // and deliberately NOT an unknown-* code (the packs QC gate hard-fails
  // T3 rows on unknown-*; this is character-state, not pack authoring).
  for (const a of active) {
    if (a.row.kind !== 'item' || !a.inventorySlot) continue;
    const storage = a.data.spellStorage as { maxLevels?: unknown } | undefined;
    if (!storage || typeof storage.maxLevels !== 'number') continue;
    const stored = a.inventorySlot.stored ?? [];
    const total = stored.reduce(
      (acc, st) => acc + (typeof st?.level === 'number' && st.level > 0 ? Math.floor(st.level) : 0),
      0
    );
    if (total > storage.maxLevels) {
      validations.push({
        severity: 'warning',
        code: 'spell-storage-over-capacity',
        message: `${a.row.name} holds ${total} spell levels (capacity ${storage.maxLevels}).`
      });
    }
  }

  // Random-effect tables — every face of the declared die should land on
  // exactly one entry. Gaps / overlaps / out-of-range rows are soft
  // warnings only (deliberately NOT `unknown-*` codes: a table with a
  // deliberate hole is legal authoring, and the packs QC gate hard-fails
  // T3 rows on unknown-*). The table still surfaces on the Action /
  // Trigger either way.
  for (const a of active) {
    const where = `${a.row.kind}/${a.row.slug}`;
    for (const act of (a.data.activities as Array<Record<string, unknown>> | undefined) ?? []) {
      const table = coerceRandomTable(act.randomTable);
      if (!table) continue;
      validations.push(
        ...validateRandomTable(table, `${where} activity '${(act.id as string) ?? '?'}'`)
      );
    }
    for (const t of (a.data.triggers as Array<Record<string, unknown>> | undefined) ?? []) {
      const table = coerceRandomTable(t.randomTable);
      if (!table) continue;
      validations.push(
        ...validateRandomTable(table, `${where} trigger '${(t.id as string) ?? '?'}'`)
      );
    }
  }

  // Predicate DSL operators — an unrecognized operator object (a `{gt: 5}`
  // typo for `{gte: 5}`, say) silently never matches in matchValue, so the
  // modifier would just never apply. Mirror the unknown-trigger-event
  // pattern: walk every action-modifier's appliesTo block and surface each
  // unknown operator as a soft warning.
  for (const m of allMods) {
    if (m.kind !== 'action-modifier') continue;
    for (const problem of validatePredicateBlock(m.raw.appliesTo)) {
      validations.push({
        severity: 'warning',
        code: 'unknown-predicate-operator',
        message: `Action modifier '${m.id}' ${problem}.`
      });
    }
  }
}

/** Collect spendable resources: activities with `uses` blocks, limited
 *  triggers, and C.4 free-cast budgets. */
function collectResources(
  s: DerivePhaseState,
  freeCastEntries: Array<{
    slug: string;
    per: string;
    uses: number;
    sourceContent: { kind: string; slug: string };
  }>
): Resource[] {
  const { character, active, ctx } = s;

  // -------------------------------------------------------------------------
  // Resources — collect activities with `uses` blocks
  // -------------------------------------------------------------------------

  const resources: Resource[] = [];
  const spent = character.resourcesSpent ?? {};
  for (const a of active) {
    // Attunement / requires gate mirrors assembleActivities — an
    // activity that produced no Action must not emit a Resource either.
    const activities = gatedActivities(a);
    for (const act of activities) {
      const uses = act.uses as { max?: number | string | object; per?: string } | undefined;
      if (uses?.max == null || !uses.per) continue;
      const max = evaluateValue(uses.max, ctx);
      if (typeof max !== 'number' || max <= 0) continue;
      const id = `${a.row.kind}/${a.row.slug}/${act.id as string}`;
      const applies = act.appliesCondition;
      const actDesc = act.description;
      resources.push({
        id,
        name: (act.name as string | undefined) ?? (act.id as string),
        max,
        used: Math.min(max, spent[id] ?? 0),
        per: uses.per,
        sourceContent: { kind: a.row.kind, slug: a.row.slug },
        ...(typeof applies === 'string' ? { appliesCondition: applies } : {}),
        ...(typeof actDesc === 'string' ? { description: actDesc } : {})
      });
    }
    // Item charge pools — an equipped item with `data.charges` emits one
    // shared resource that its chargeCost activities debit (see
    // normalizeItemCharges for the accepted authoring shapes). The id is
    // stable (`item/<slug>/charges`) so `resourcesSpent` round-trips
    // through the existing PATCH path.
    if (a.row.kind === 'item' && itemRequirementMet(a, undefined)) {
      const pool = normalizeItemCharges(a.data);
      if (pool) {
        const id = `item/${a.row.slug}/charges`;
        const maxRaw = evaluateValue(pool.max, ctx);
        const max = typeof maxRaw === 'number' ? Math.floor(maxRaw) : 0;
        if (max > 0 && !resources.some((r) => r.id === id)) {
          resources.push({
            id,
            name: `${a.row.name} Charges`,
            max,
            used: Math.min(max, spent[id] ?? 0),
            per: pool.per,
            sourceContent: { kind: a.row.kind, slug: a.row.slug }
          });
        }
      }
    }
    // Per-option uses on a choice menu: each picked `modifierFromChoice`
    // option that declares its own `uses: { max, per }` becomes an
    // independent pool keyed by (row slug + option id). Rune Knight runes
    // are the driver — every known rune carries a passive rider AND its
    // own 1/short-rest invocation, so one shared row-level pool would be
    // wrong.
    for (const opt of resolvePickedMenuOptions(a, character)) {
      const uses = opt.uses;
      if (uses?.max == null || !uses.per) continue;
      const maxRaw = evaluateValue(uses.max, ctx);
      const max = typeof maxRaw === 'number' ? Math.floor(maxRaw) : 0;
      if (max <= 0) continue;
      const id = `${a.row.kind}/${a.row.slug}/choice/${opt.id}`;
      if (resources.some((r) => r.id === id)) continue;
      resources.push({
        id,
        name: opt.name ?? opt.label ?? (opt.id as string),
        max,
        used: Math.min(max, spent[id] ?? 0),
        per: uses.per,
        sourceContent: { kind: a.row.kind, slug: a.row.slug },
        ...(typeof opt.description === 'string' ? { description: opt.description } : {})
      });
    }
    // Triggers with a `limit` are functionally resources too — Relentless
    // Endurance "1/long rest", Chronal Shift "2/long rest", etc.
    const triggerList = (a.data.triggers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const t of triggerList) {
      if (!itemRequirementMet(a, t.appliesWhen)) continue;
      const limit = t.limit as { per?: string; uses?: number | string | object } | undefined;
      if (!limit?.per || limit.uses == null) continue;
      const maxRaw = evaluateValue(limit.uses, ctx);
      const max = typeof maxRaw === 'number' ? maxRaw : 0;
      if (max <= 0) continue;
      const id = `trigger/${a.row.slug}/${(t.id as string) ?? 'unnamed'}`;
      const trigDesc = t.description;
      resources.push({
        id,
        name: (t.name as string | undefined) ?? (t.id as string) ?? id,
        max,
        used: Math.min(max, spent[id] ?? 0),
        per: limit.per,
        sourceContent: { kind: a.row.kind, slug: a.row.slug },
        ...(typeof trigDesc === 'string' ? { description: trigDesc } : {})
      });
    }
  }
  // C.4 — free-cast budget (e.g. Misty Step 1/long-rest from Fey Touched).
  // Emits one resource per entry so the encounter runtime can let the
  // player cast the spell without consuming a slot until the budget runs
  // out. The spell row is already in `active` so its action is available.
  for (const fc of freeCastEntries) {
    const id = `free-cast/${fc.sourceContent.slug}/${fc.slug}`;
    resources.push({
      id,
      name: `${fc.slug} (free cast)`,
      max: fc.uses,
      used: Math.min(fc.uses, spent[id] ?? 0),
      per: fc.per,
      sourceContent: fc.sourceContent
    });
  }
  return resources;
}

/** Surface user-toggleable action modifiers for the edit UI. */
function collectToggles(s: DerivePhaseState): AvailableToggle[] {
  const { character, allMods } = s;

  // -------------------------------------------------------------------------
  // Surface user-toggleable action modifiers for the edit UI. Only modifiers
  // that declare `defaultEnabled` are exposed — those are the ones the rules
  // text says are "the player's choice" (Reckless Attack, GWM Power Attack…).
  // Always-on modifiers (Rage damage, Savage Attacks, Divine Fury) don't
  // appear as toggles since the player has no decision to make.
  // -------------------------------------------------------------------------

  const toggles: AvailableToggle[] = [];
  for (const m of allMods) {
    if (m.kind !== 'action-modifier') continue;
    if (!('defaultEnabled' in m.raw)) continue;
    const defaultEnabled = m.raw.defaultEnabled as boolean;
    const currentlyEnabled = character.modifierToggles[m.id] ?? defaultEnabled;
    toggles.push({
      id: m.id,
      name: (m.raw.name as string | undefined) ?? m.id,
      defaultEnabled,
      currentlyEnabled,
      sourceContent: { kind: m.source.row.kind, slug: m.source.row.slug }
    });
  }
  return toggles;
}

/** C.6 — outbound effects (aura) manifest from active content. */
function collectOutboundEffects(s: DerivePhaseState): OutboundEffect[] {
  const { active, resolvedConditions } = s;

  // C.6 — outbound effects manifest. Walks active content for
  // `data.outboundEffects[]` entries and emits them gated on appliesWhen
  // (condition presence) so the encounter layer only sees currently-live
  // auras. Modifier shape is opaque at this layer — the encounter layer
  // applies them to ally token derived stats.
  const outboundEffects: OutboundEffect[] = [];
  for (const a of active) {
    const entries = a.data.outboundEffects as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(entries)) continue;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const appliesWhen = e.appliesWhen as { condition?: string } | undefined;
      if (appliesWhen?.condition && !resolvedConditions.has(appliesWhen.condition)) continue;
      const targets = (e.targets as string | undefined) ?? 'creature';
      if (targets !== 'ally' && targets !== 'enemy' && targets !== 'creature' && targets !== 'self')
        continue;
      outboundEffects.push({
        id: (e.id as string | undefined) ?? `${a.row.kind}/${a.row.slug}/aura/${i}`,
        sourceContent: { kind: a.row.kind, slug: a.row.slug },
        name: (e.name as string | undefined) ?? (e.id as string | undefined) ?? a.row.name,
        rangeFt: typeof e.rangeFt === 'number' ? e.rangeFt : 0,
        targets,
        ...(e.excludeSelf === true ? { excludeSelf: true } : {}),
        ...(e.requiresAlive === true ? { requiresAlive: true } : {}),
        ...(Array.isArray(e.modifiers) ? { modifiers: e.modifiers as Array<Record<string, unknown>> } : {}),
        ...(appliesWhen ? { appliesWhen } : {})
      });
    }
  }
  return outboundEffects;
}

/** Synthesize picked Battle Master maneuvers into actions / triggers /
 *  outbound effects. */
function synthesizePickedManeuvers(s: DerivePhaseState, outboundEffects: OutboundEffect[]): void {
  const { character, active, stats, actions, triggers, validations } = s;

  // ---------------------------------------------------------------------
  // Maneuvers (Battle Master maneuver content model)
  // ---------------------------------------------------------------------
  // Walk active feature / subclass rows for `data.maneuvers[]` catalogs +
  // `data.choices.maneuvers` declarations. For each picked maneuver id,
  // emit a synthesized Action / Trigger / OutboundEffect per the
  // maneuver's effect.kind tagged with `spendsResource` so the planner
  // debits the class-resource pool on use.
  //
  // The save-DC resolver `{calc: 'maneuver'}` resolves to
  // `8 + PB + max(strMod, dexMod)`. An optional
  // `data.maneuverDCAbility: 'str'|'dex'` override on the parent feature
  // pins the ability when the player explicitly chooses.
  for (const a of active) {
    if (a.row.kind !== 'feature' && a.row.kind !== 'subclass') continue;
    const catalog = a.data.maneuvers as ManeuverDecl[] | undefined;
    if (!Array.isArray(catalog) || catalog.length === 0) continue;
    const choicesDecl = a.data.choices as
      | Record<string, Record<string, unknown> | undefined>
      | undefined;
    const slotDecl = choicesDecl?.maneuvers as
      | { picks?: unknown; allowedIds?: string[] }
      | undefined;
    if (!slotDecl) continue;
    const picksRaw =
      a.row.kind === 'feature'
        ? character.featureChoices?.[a.row.slug]
        : character.subclassChoices?.[a.row.slug];
    const picks = (picksRaw?.maneuvers as Array<{ maneuverId?: string }> | undefined) ?? [];
    if (picks.length === 0) continue;

    const allowedIds = Array.isArray(slotDecl.allowedIds) ? new Set(slotDecl.allowedIds) : null;

    // DC ability resolution: explicit override wins; otherwise
    // max(strMod, dexMod) per RAW "your choice."
    const dcAbilityOverride = a.data.maneuverDCAbility as 'str' | 'dex' | 'auto' | undefined;
    const strMod = stats.abilities.str.mod;
    const dexMod = stats.abilities.dex.mod;
    let dcAbilityMod: number;
    if (dcAbilityOverride === 'str') dcAbilityMod = strMod;
    else if (dcAbilityOverride === 'dex') dcAbilityMod = dexMod;
    else dcAbilityMod = Math.max(strMod, dexMod);
    const maneuverSaveDC = 8 + stats.proficiencyBonus + dcAbilityMod;

    for (const pickRec of picks) {
      const maneuverId = pickRec?.maneuverId;
      if (!maneuverId) continue;
      if (allowedIds && !allowedIds.has(maneuverId)) continue;
      const mdecl = catalog.find((m) => m && m.id === maneuverId);
      if (!mdecl) continue;
      synthesizeManeuver({
        decl: mdecl,
        source: a,
        actions,
        triggers,
        outboundEffects,
        maneuverSaveDC,
        validations
      });
    }
  }
}

/** Declarative manifest of `data.choices` slots + recorded picks. */
function collectPendingFeatureChoices(s: DerivePhaseState): PendingFeatureChoice[] {
  const { character, active, ctx } = s;

  // Pending feature choices — declarative manifest of `data.choices`
  // entries on active feature / subclass rows + whatever picks the
  // player has recorded so far. The UI walks this to render per-feature
  // pickers (skillProficiency, expertise, language, sub-feature, etc.)
  // and writes selections back into character.featureChoices[slug].
  const pendingFeatureChoices: PendingFeatureChoice[] = [];
  const seenChoiceKeys = new Set<string>();
  for (const a of active) {
    if (
      a.row.kind !== 'feature' &&
      a.row.kind !== 'subclass' &&
      a.row.kind !== 'species' &&
      a.row.kind !== 'background'
    ) continue;
    const decl = a.data.choices as Record<string, Record<string, unknown> | undefined> | undefined;
    if (!decl) continue;
    const slotKeys = Object.keys(decl).filter((k) => decl[k] != null);
    if (slotKeys.length === 0) continue;
    const dedupeKey = `${a.row.kind}/${a.row.slug}`;
    if (seenChoiceKeys.has(dedupeKey)) continue;
    seenChoiceKeys.add(dedupeKey);
    let picksRaw: Record<string, unknown> | undefined;
    if (a.row.kind === 'feature') {
      picksRaw = character.featureChoices?.[a.row.slug];
    } else if (a.row.kind === 'subclass') {
      picksRaw = character.subclassChoices?.[a.row.slug];
    } else if (a.row.kind === 'species') {
      picksRaw = character.species.slug === a.row.slug ? character.species.choices : undefined;
    } else if (a.row.kind === 'background') {
      picksRaw = character.background?.slug === a.row.slug ? character.background?.choices : undefined;
    }
    const picks = (picksRaw ?? {}) as Record<string, unknown>;
    const declarations: Record<string, Record<string, unknown>> = {};
    for (const k of slotKeys) declarations[k] = decl[k] as Record<string, unknown>;
    pendingFeatureChoices.push({
      featureSlug: a.row.slug,
      featureName: a.row.name,
      kind: a.row.kind,
      declarations,
      picks,
      unresolved: slotKeys.some((k) => isSlotUnresolved(k, declarations[k], picks[k], ctx))
    });
  }
  return pendingFeatureChoices;
}

/** Declarative manifest of item `data.choices` slots + recorded picks.
 *  One entry per (inventory slot, choice slot) pair on every equipped
 *  item that declares `data.choices` — surfaced regardless of the
 *  attunement gate so the player can record picks before attuning (the
 *  pick has no mechanical effect until the item's entries pass
 *  itemRequirementMet). Unequipped items surface nothing (they aren't
 *  active content at all). */
function collectPendingItemChoices(s: DerivePhaseState): PendingItemChoice[] {
  const { active } = s;
  const out: PendingItemChoice[] = [];
  for (const a of active) {
    if (a.row.kind !== 'item' || !a.inventorySlot) continue;
    const decl = a.data.choices as Record<string, Record<string, unknown> | undefined> | undefined;
    if (!decl || typeof decl !== 'object') continue;
    for (const key of Object.keys(decl)) {
      const declaration = decl[key];
      if (declaration == null || typeof declaration !== 'object') continue;
      const picked = a.inventorySlot.choices?.[key];
      out.push({
        slotIndex: a.inventorySlot.index,
        itemSlug: a.row.slug,
        itemName: a.row.name,
        choice: key,
        declaration,
        ...(picked !== undefined ? { picked } : {})
      });
    }
  }
  return out;
}

/** Overlay HP pools (Arcane Ward etc.) from overlay-hp-pool modifier rows. */
function collectOverlayHpPools(s: DerivePhaseState): OverlayHpPool[] {
  const { allMods, ctx, validations } = s;

  // Overlay HP pools — independent HP buckets that absorb damage before
  // the character's main HP. Emitted from `overlay-hp-pool` modifier rows
  // on features like Arcane Ward. derive() declares the pool's existence,
  // max, and refresh policy; the encounter runtime tracks per-pool current
  // values and threads the aggregate into hp.applyDamageDelta.
  const overlayHpPools: OverlayHpPool[] = [];
  const seenPoolIds = new Set<string>();
  for (const m of allMods) {
    const kind = (m.raw.kind as string | undefined) ?? '';
    if (kind !== 'overlay-hp-pool') continue;
    const maxValue = evaluateValue(m.raw.max, ctx);
    if (typeof maxValue !== 'number') {
      validations.push({
        severity: 'warning',
        code: 'overlay-hp-pool-non-numeric-max',
        message: `Overlay HP pool '${m.id}' max did not evaluate to a number.`
      });
      continue;
    }
    const refresh = m.raw.refreshOn as OverlayHpPool['refreshOn'] | undefined;
    const refreshOn: OverlayHpPool['refreshOn'] =
      refresh === 'short-rest' || refresh === 'long-rest' || refresh === 'manual'
        ? refresh
        : 'long-rest';
    const id = (m.raw.id as string | undefined) ?? m.id;
    if (seenPoolIds.has(id)) continue;
    seenPoolIds.add(id);
    overlayHpPools.push({
      id,
      sourceContent: { kind: m.source.row.kind, slug: m.source.row.slug },
      name: (m.raw.name as string | undefined) ?? m.source.row.name,
      max: Math.max(0, Math.floor(maxValue)),
      refreshOn
    });
  }
  return overlayHpPools;
}

/** Denormalized equipped armor + shield state shared with the sheet. */
function computeEquippedState(active: ActiveContent[]): Derived['equipped'] {
  // Denormalize equipped armor + shield state once, shared between the AC
  // formula (above) and the activation auto-cancel walk. Mirrors the
  // armor lookup in computeAC: any active item with category=armor whose
  // armorType is 'shield' counts toward the shield flag; the first
  // non-shield armor body slot supplies armorType (light by default when
  // armorType is unset).
  let equippedArmorType: 'light' | 'medium' | 'heavy' | null = null;
  let equippedShield = false;
  for (const a of active) {
    if (a.row.kind !== 'item') continue;
    if (a.data.category !== 'armor') continue;
    const at = a.data.armorType as string | undefined;
    if (at === 'shield') {
      equippedShield = true;
    } else if (equippedArmorType === null) {
      equippedArmorType =
        at === 'medium' || at === 'heavy' ? at : 'light';
    }
  }
  return { armorType: equippedArmorType, shield: equippedShield };
}

/** Polymorph / Wild Shape form snapshot via monsterDerive. */
function resolveActiveForm(s: DerivePhaseState): ActiveForm | undefined {
  const { character, content, active, formScopedMods, ctx, validations } = s;

  // Polymorph form snapshot. When the character has stepped into a
  // beast / aberration / angel via Wild Shape, Polymorph spell, Form
  // of Dread, etc., resolve the monster row via the existing content
  // lookup (mirrors the spellListAdditions content-lookup pattern at
  // line ~422) and run `monsterDerive` to produce a snapshot. Any
  // modifier from an active feature/feat/species/etc. row carrying
  // `persistsInForm: true` is also collected here so the runtime can
  // overlay it on top of the form's snapshot when adjudicating the
  // form's saves / AC / etc. The base PC's stats path is unaffected —
  // these modifiers are PC modifiers that *also* persist in form,
  // not form-only modifiers.
  let activeForm: ActiveForm | undefined;
  if (character.polymorphForm) {
    const formState = character.polymorphForm;
    const monsterRow = content({ kind: 'monster', slug: formState.slug });
    if (!monsterRow) {
      validations.push({
        severity: 'warning',
        code: 'polymorph-form-missing-content',
        message: `Polymorph form '${formState.slug}' not found in content lookup.`
      });
    } else {
      const persistentModifiers: Array<Record<string, unknown>> = [];
      for (const a of active) {
        const mods = (a.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
        for (const m of mods) {
          if (m && typeof m === 'object' && m.persistsInForm === true) {
            persistentModifiers.push(m);
          }
        }
      }
      // Form-scoped modifiers (`appliesToForm: true`): surfaced verbatim
      // for the runtime, and — for targets with a MonsterDerived slot —
      // folded into the snapshot here, where monsterDerive's output is
      // composed. This is the inverse of persistsInForm: these never
      // touched the base sheet (they were pulled out before phase 2).
      const formModifiers = formScopedMods.map((m) => m.raw);
      const statblock = applyFormModifiers(
        monsterDerive(monsterRow.data),
        formScopedMods
          .filter((m) => m.kind === 'stat-modifier' && typeof m.raw.target === 'string')
          .map((m) => ({
            target: m.raw.target as string,
            value: m.raw.value,
            mode: m.raw.mode as Mode | undefined,
            priority: m.raw.priority as number | undefined
          })),
        ctx
      );
      activeForm = {
        sourceContent: formState.sourceContent,
        statblock,
        persistentModifiers,
        formModifiers,
        formSaveSource: formState.formSaveSource ?? 'form',
        currentHp: formState.currentHp,
        maxHp: formState.maxHp,
        roundsRemaining: formState.roundsRemaining ?? null
      };
    }
  }
  return activeForm;
}

/** Summoned-companion snapshots via monsterDerive. */
function resolveCompanions(s: DerivePhaseState): DerivedCompanion[] | undefined {
  const { character, content, validations } = s;

  // Companion snapshots. Walk character.companions[], filter to
  // status='summoned' (dismissed entries stay in the document but
  // don't show on the encounter tracker), and produce a Derived
  // snapshot per entry. Same content-lookup pattern as polymorph
  // form. sharesInitiative defaults to true per the design doc's
  // recommendation on open question #1 — Beast Master / Drakewarden
  // companions share the controller's initiative; familiars opt out
  // by setting the flag false on the companion state.
  let companions: DerivedCompanion[] | undefined;
  if (Array.isArray(character.companions) && character.companions.length > 0) {
    const out: DerivedCompanion[] = [];
    for (const c of character.companions) {
      if (c.status !== 'summoned') continue;
      const monsterRow = content({ kind: 'monster', slug: c.slug });
      if (!monsterRow) {
        validations.push({
          severity: 'warning',
          code: 'companion-missing-content',
          message: `Companion '${c.slug}' (${c.name}) not found in content lookup.`
        });
        continue;
      }
      out.push({
        slug: c.slug,
        name: c.name,
        statblock: monsterDerive(monsterRow.data),
        currentHp: c.currentHp,
        maxHp: c.maxHp,
        status: 'summoned',
        sharesInitiative: c.sharesInitiative ?? true
      });
    }
    if (out.length > 0) companions = out;
  }
  return companions;
}

/** `class-resource.<id>.dieSize` — die-string upgrades on a resolved pool
 *  (Martial Arts / Bardic Inspiration / Superiority die bumps). Numeric
 *  applyTarget can't chain die strings, so this walks the same eligible +
 *  priority-sorted modifier list through `applyUpgradeValue`, which knows
 *  UPGRADE means "the die with the higher average wins". */
function applyClassResourceDieUpgrade(
  allMods: ActiveModifier[],
  character: CharacterDocument,
  ctx: EvalContext,
  resourceId: string,
  base: string
): string {
  const target = `class-resource.${resourceId}.dieSize`;
  const eligible = allMods.filter(
    (m) =>
      m.kind === 'stat-modifier' &&
      m.raw.target === target &&
      modifierIsEligible(m, character, ctx)
  );
  if (eligible.length === 0) return base;
  let current: unknown = base;
  for (const m of sortByPriority(eligible)) {
    const next = applyUpgradeValue(
      current,
      (m.raw.mode as Mode | undefined) ?? 'ADD',
      evaluateValue(m.raw.value, ctx)
    );
    if (next !== NO_OP) current = next;
  }
  return typeof current === 'string' && current.length > 0 ? current : base;
}

/** Per-class spendable pools resolved from class / subclass rows. */
function resolveClassResources(s: DerivePhaseState): ResolvedClassResource[] | undefined {
  const { character, active, allMods, ctx, validations } = s;

  // Class-resource pools. Walk each active class row's `data.resources`
  // array (an array of ClassResourceDecl) and resolve each pool against
  // the character's context. `max` accepts the same value shapes as
  // activation `uses.max` (literal, token, perClass-table) so we reuse
  // evaluateValue. `dieSize` accepts a literal string or a perClass-table
  // of strings — die-scaling by level (Bardic Inspiration d6→d8→d10→d12,
  // Superiority Dice d8→d10→d12, Psionic Energy Dice d6→d8→d10→d12) flows
  // through the same perClass branch in evaluateValue.
  //
  // Multi-class edge: if a later class row declares the same id, drop it
  // and emit a soft validation note. The first declaration wins.
  let classResources: ResolvedClassResource[] | undefined;
  const seenResourceIds = new Set<string>();
  const resourcesSpent = character.resourcesSpent ?? {};
  for (const a of active) {
    // Class-resource declarations live on `class` rows canonically (Bardic
    // Inspiration, Ki / Focus, Sorcery Points, …). Subclass rows may also
    // declare resources gated by subclass-pick (Battle Master's Superiority
    // Dice are the canonical example — declared on the subclass row so
    // non-Battle-Master fighters don't see the pool).
    if (a.row.kind !== 'class' && a.row.kind !== 'subclass') continue;
    const decls = a.data.resources as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(decls)) continue;
    for (const raw of decls) {
      if (!raw || typeof raw !== 'object') continue;
      const id = raw.id as string | undefined;
      const name = raw.name as string | undefined;
      const refresh = raw.refresh as ResolvedClassResource['refresh'] | undefined;
      const spendKind = raw.spendKind as ResolvedClassResource['spendKind'] | undefined;
      if (typeof id !== 'string' || !id) continue;
      if (typeof name !== 'string' || !name) continue;
      if (
        refresh !== 'short-rest' &&
        refresh !== 'long-rest' &&
        refresh !== 'per-turn' &&
        refresh !== 'per-round'
      )
        continue;
      if (spendKind !== 'die' && spendKind !== 'point') continue;
      if (seenResourceIds.has(id)) {
        validations.push({
          severity: 'warning',
          code: 'class-resource-duplicate-id',
          message: `Class resource '${id}' declared by multiple class rows; keeping the first.`
        });
        continue;
      }
      // `class-resource.<id>.max` / `.dieSize` are the ergonomic aliases
      // of the cross-row upgrade channel for pool bumps — a later feature
      // says "you gain one more use of X" / "your X die becomes a d8"
      // without needing to know which class row declared the pool.
      const maxEval = evaluateValue(raw.max, ctx);
      const maxBase = typeof maxEval === 'number' ? Math.max(0, Math.floor(maxEval)) : 0;
      const maxBumped = applyTarget(allMods, character, `class-resource.${id}.max`, maxBase, ctx);
      const max =
        typeof maxBumped === 'number' && Number.isFinite(maxBumped)
          ? Math.max(0, Math.floor(maxBumped))
          : maxBase;
      if (max <= 0) continue;
      let dieSize: string | undefined;
      if (raw.dieSize !== undefined) {
        const evaluated = evaluateValue(raw.dieSize, ctx);
        if (typeof evaluated === 'string' && evaluated.length > 0) dieSize = evaluated;
      }
      if (dieSize !== undefined) {
        dieSize = applyClassResourceDieUpgrade(allMods, character, ctx, id, dieSize);
      }
      const spent = Math.max(0, resourcesSpent[id] ?? 0);
      const current = Math.max(0, Math.min(max, max - spent));
      seenResourceIds.add(id);
      const entry: ResolvedClassResource = {
        id,
        name,
        sourceClassSlug: a.row.slug,
        max,
        refresh,
        spendKind,
        current,
        ...(dieSize ? { dieSize } : {})
      };
      (classResources ??= []).push(entry);
    }
  }
  return classResources;
}

function formatActivationDuration(
  d: ActivationDeclaration['duration'] | undefined
): string | undefined {
  if (!d) return undefined;
  if (d === 'persistent') return 'persistent';
  if (typeof d === 'object' && typeof d.value === 'number' && typeof d.units === 'string') {
    const u = d.value === 1 ? d.units : `${d.units}s`;
    return `${d.value} ${u}`;
  }
  return undefined;
}

// Deep-clone an activation variant modifier template, replacing any
// string literal equal to "__weapon__" with the picked weapon slug.
// Used for variantsFromWeapons synthesis so a single Magic Weapon
// template row produces a per-weapon action-modifier whose appliesTo
// predicate `weapon.slug` matches only the chosen weapon.
function substituteWeaponPlaceholder(value: unknown, weaponSlug: string): unknown {
  if (typeof value === 'string') return value === '__weapon__' ? weaponSlug : value;
  if (Array.isArray(value)) return value.map((v) => substituteWeaponPlaceholder(v, weaponSlug));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteWeaponPlaceholder(v, weaponSlug);
    }
    return out;
  }
  return value;
}

// Resolve `scalingByCastSlot` value shapes against the picked cast slot.
// `{scalingByCastSlot: {baseSlotLevel, table}}` becomes
// `table[slot - baseSlotLevel]` (clamped to table length so picking a
// slot past the last entry returns the table's final value — typical
// "+3 at L6+" semantics where the table is short). Deep-walks the
// template so the shape can appear at any depth (typically as an
// action-modifier `effects[].value`). Non-scaling values pass through.
function substituteScalingByCastSlot(value: unknown, slot: number): unknown {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'scalingByCastSlot' in value
  ) {
    const o = (value as { scalingByCastSlot: unknown }).scalingByCastSlot;
    if (o && typeof o === 'object' && 'baseSlotLevel' in o && 'table' in o) {
      const cfg = o as { baseSlotLevel: number; table: Array<number | string> };
      const idx = Math.max(0, Math.min(cfg.table.length - 1, slot - cfg.baseSlotLevel));
      return cfg.table[idx];
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => substituteScalingByCastSlot(v, slot));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteScalingByCastSlot(v, slot);
    }
    return out;
  }
  return value;
}

// Walk a value tree and report the smallest baseSlotLevel referenced
// by any `scalingByCastSlot` value shape. Returns null if no scaling
// is present (the activation isn't slot-aware and the panel shouldn't
// render a slot picker for it).
function findBaseSlotLevel(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'scalingByCastSlot' in value
  ) {
    const o = (value as { scalingByCastSlot: unknown }).scalingByCastSlot;
    if (o && typeof o === 'object' && 'baseSlotLevel' in o) {
      return (o as { baseSlotLevel: number }).baseSlotLevel;
    }
  }
  if (Array.isArray(value)) {
    let lowest: number | null = null;
    for (const v of value) {
      const got = findBaseSlotLevel(v);
      if (got !== null && (lowest === null || got < lowest)) lowest = got;
    }
    return lowest;
  }
  if (value && typeof value === 'object') {
    let lowest: number | null = null;
    for (const v of Object.values(value as Record<string, unknown>)) {
      const got = findBaseSlotLevel(v);
      if (got !== null && (lowest === null || got < lowest)) lowest = got;
    }
    return lowest;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classLevelFor(character: CharacterDocument, slug: string): number {
  return character.classes.find((c) => c.slug === slug)?.level ?? 0;
}

/** Normalized item charge-pool declaration (see normalizeItemCharges). */
interface ItemChargePool {
  /** Pool maximum — any evaluateValue-compatible shape. */
  max: unknown;
  /** Recharge cadence. 'dawn' pools reset on long rest (the sheet has no
   *  clock — the long-rest button is the player's dawn); 'week' pools
   *  (night-caller, cauldron of rebirth) are NOT reset by any rest —
   *  the sheet has no calendar, so the player restores the counter
   *  manually when the in-fiction week passes; 'never' pools are only
   *  restored manually. */
  per: 'dawn' | 'long-rest' | 'short-rest' | 'week' | 'never';
  /** Partial-recharge formula ('1d6+1' for a wand regaining 1d6+1 at
   *  dawn). Stored / displayed only — v1 resets the pool to max at the
   *  cadence; rolling the partial recharge is a follow-up. */
  rechargeAmount?: string;
}

/** Read an item row's `data.charges` into the canonical pool shape.
 *  Accepted authoring shapes:
 *    - engine-native: `charges: { max, recharge?: { amount?, per: 'dawn'
 *      | 'long-rest' | 'short-rest' } | 'never' }`
 *    - legacy display: `charges: { max, per }` — per 'day' | 'dawn'
 *      normalize to a dawn recharge
 *    - 5etools import: `charges: <number|string>` with a sibling
 *      `data.recharge` string ('dawn', 'dusk', 'restLong', 'special', …);
 *      no recharge sibling → 'never'
 *  Returns null when the row has no usable charges declaration. */
function normalizeItemCharges(data: Record<string, unknown>): ItemChargePool | null {
  const raw = data.charges;
  if (raw == null) return null;
  // 5etools flat shape: max on `charges`, cadence on sibling `recharge`.
  if (typeof raw === 'number' || typeof raw === 'string') {
    return { max: raw, per: normalizeRechargePer(data.recharge, 'never') };
  }
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.max == null) return null;
  if (o.recharge === 'never') return { max: o.max, per: 'never' };
  if (o.recharge && typeof o.recharge === 'object') {
    const r = o.recharge as { amount?: unknown; per?: unknown };
    return {
      max: o.max,
      per: normalizeRechargePer(r.per, 'dawn'),
      ...(typeof r.amount === 'string' ? { rechargeAmount: r.amount } : {})
    };
  }
  // Legacy display shape { max, per }.
  return { max: o.max, per: normalizeRechargePer(o.per, 'dawn') };
}

function normalizeRechargePer(
  raw: unknown,
  fallback: ItemChargePool['per']
): ItemChargePool['per'] {
  if (typeof raw !== 'string') return fallback;
  switch (raw) {
    case 'dawn':
    case 'day':
    case 'dusk':
    case 'midnight':
      return 'dawn';
    case 'long-rest':
    case 'restLong':
      return 'long-rest';
    case 'short-rest':
    case 'restShort':
      return 'short-rest';
    // Multi-day cadences: never reset by a rest (no calendar on the
    // sheet); the player restores the counter manually.
    case 'week':
    case '7 days':
      return 'week';
    case 'never':
    case 'special':
      return 'never';
    default:
      return fallback;
  }
}

/** Resolve a string DC-bonus token against the current stat block.
 *  Supports ability-mod tokens (strMod…chaMod) and proficiencyBonus. */
function resolveStatToken(token: string, stats: StatBlock): number {
  if (token === 'proficiencyBonus') return stats.proficiencyBonus;
  const AB_MOD: Record<string, 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'> = {
    strMod: 'str', dexMod: 'dex', conMod: 'con', intMod: 'int', wisMod: 'wis', chaMod: 'cha'
  };
  const ab = AB_MOD[token];
  if (ab) return stats.abilities[ab].mod;
  return 0;
}

/** Shared active-state gate for stat-modifiers: the player's toggle state
 *  (falling back to `defaultEnabled`, then on) plus the `appliesWhen.condition`
 *  check against the resolved condition set. */
function modifierIsEligible(
  m: ActiveModifier,
  character: CharacterDocument,
  ctx: EvalContext
): boolean {
  const enabled =
    character.modifierToggles[m.id] ?? (m.raw.defaultEnabled as boolean | undefined) ?? true;
  if (!enabled) return false;
  const appliesWhen = m.raw.appliesWhen as { condition?: string } | undefined;
  if (
    appliesWhen?.condition &&
    !(ctx.resolvedConditions ?? new Set<string>()).has(appliesWhen.condition)
  )
    return false;
  return true;
}

/** Priority-ascending sort shared by every modifier-application site.
 *  `Array.prototype.sort` is stable, so ties keep the order the modifiers
 *  were collected in — which is derive()'s deterministic active-content
 *  walk (species → subspecies → background → classes → subclasses → feats
 *  → items → spells → conditions → features). */
function sortByPriority(mods: ActiveModifier[]): ActiveModifier[] {
  return mods.slice().sort((a, b) => {
    const pa = (a.raw.priority as number | undefined) ?? defaultPriority((a.raw.mode as Mode) ?? 'ADD');
    const pb = (b.raw.priority as number | undefined) ?? defaultPriority((b.raw.mode as Mode) ?? 'ADD');
    return pa - pb;
  });
}

function applyTarget(
  mods: ActiveModifier[],
  character: CharacterDocument,
  target: string,
  base: unknown,
  ctx: EvalContext
): number | unknown {
  const targeted = mods.filter(
    (m) => m.kind === 'stat-modifier' && (m.raw.target as string) === target
  );
  // Filter for active state: enabled toggles + appliesWhen condition checks
  const eligible = targeted.filter((m) => modifierIsEligible(m, character, ctx));
  if (eligible.length === 0) return base;
  // Sort by priority ascending; numeric mode application chains.
  const sorted = sortByPriority(eligible);
  let current: number | unknown = base;
  for (const m of sorted) {
    const value = evaluateValue(m.raw.value, ctx);
    const mode = (m.raw.mode as Mode) ?? 'ADD';
    if (typeof current === 'number' && typeof value === 'number') {
      current = applyNumericMode(current, mode, value);
    } else if (mode === 'OVERRIDE') {
      current = value;
    }
    // Otherwise leave current unchanged.
  }
  return current;
}

function computeAC(
  character: CharacterDocument,
  active: ActiveContent[],
  abilities: Record<AbilityKey, AbilityCell>,
  mods: ActiveModifier[],
  ctx: EvalContext
): number {
  // Find equipped armor (category=armor, armorType !== 'shield')
  let armor: ActiveContent | undefined;
  let shield: ActiveContent | undefined;
  for (const a of active) {
    if (a.row.kind !== 'item') continue;
    const cat = a.data.category as string | undefined;
    if (cat !== 'armor') continue;
    const at = a.data.armorType as string | undefined;
    if (at === 'shield') shield = a;
    else armor = a;
  }

  let base: number;
  if (armor) {
    const formula = armor.data.armorClassFormula as
      | { base: number; ability?: AbilityKey | null; abilityCap?: number }
      | undefined;
    if (formula) {
      base = formula.base;
      if (formula.ability) {
        const mod = abilities[formula.ability].mod;
        base += formula.abilityCap != null ? Math.min(mod, formula.abilityCap) : mod;
      }
    } else {
      base = 10 + abilities.dex.mod;
    }
  } else {
    // No armor — look for an `ac.formula` OVERRIDE (e.g. Barbarian Unarmored Defense).
    const formula = applyTarget(mods, character, 'ac.formula', null as unknown as number, ctx);
    if (formula && typeof formula === 'object') {
      const f = formula as { base: number; abilities?: AbilityKey[]; ability?: AbilityKey };
      base = f.base;
      const abs = f.abilities ?? (f.ability ? [f.ability] : []);
      for (const ab of abs) base += abilities[ab].mod;
    } else {
      base = 10 + abilities.dex.mod;
    }
  }

  // ac stat-modifiers (shield +2, magic items, etc.) are in allMods and
  // applied uniformly by applyTarget — no special shield block needed.
  const final = applyTarget(mods, character, 'ac', base, ctx);
  return typeof final === 'number' ? final : base;
}

function computeSpeeds(
  active: ActiveContent[],
  mods: ActiveModifier[],
  character: CharacterDocument,
  ctx: EvalContext
): Record<string, number> {
  const speeds: Record<string, number> = { walk: 30 };
  // Pull species/subspecies base speeds
  for (const a of active) {
    if (a.row.kind !== 'species' && a.row.kind !== 'subspecies') continue;
    const ss = a.data.speed as Record<string, number> | undefined;
    if (!ss) continue;
    for (const [k, v] of Object.entries(ss)) speeds[k] = v;
  }
  // Discover additional speed keys declared in speed.* modifiers (e.g. roving
  // adds speed.climb / speed.swim for species that have no native climb speed).
  for (const m of mods) {
    if (m.kind !== 'stat-modifier') continue;
    const t = m.raw.target as string | undefined;
    if (!t?.startsWith('speed.')) continue;
    const key = t.slice('speed.'.length);
    if (key === 'all' || key in speeds) continue;
    speeds[key] = 0;
  }
  // Apply walk first so ctx.walkSpeed is correct before non-walk modifiers
  // that reference walkSpeed (e.g. "climb = walk speed") are evaluated.
  const walkResult = applyTarget(mods, character, 'speed.walk', speeds.walk, ctx);
  if (typeof walkResult === 'number') speeds.walk = walkResult;
  ctx.walkSpeed = speeds.walk;
  // Apply modifiers for all remaining speed keys
  for (const key of Object.keys(speeds)) {
    if (key === 'walk') continue;
    const v = applyTarget(mods, character, `speed.${key}`, speeds[key], ctx);
    if (typeof v === 'number') speeds[key] = v;
  }
  // Apply speed.all modifiers (e.g. exhaustion -5) to every speed key.
  // We collect ADD values only (OVERRIDE to a specific key wouldn't make
  // sense applied universally); apply them after per-key modifiers so the
  // combined result is consistent.
  const allSpeedMods = mods.filter(
    (m) => m.kind === 'stat-modifier' && (m.raw.target as string) === 'speed.all'
  );
  const eligibleAll = allSpeedMods.filter((m) => {
    const enabled =
      character.modifierToggles[m.id] ?? (m.raw.defaultEnabled as boolean | undefined) ?? true;
    if (!enabled) return false;
    const appliesWhen = m.raw.appliesWhen as { condition?: string } | undefined;
    if (appliesWhen?.condition && !(ctx.resolvedConditions ?? new Set<string>()).has(appliesWhen.condition)) return false;
    return true;
  });
  if (eligibleAll.length > 0) {
    for (const key of Object.keys(speeds)) {
      let val = speeds[key];
      for (const m of eligibleAll) {
        const value = evaluateValue(m.raw.value, ctx);
        const mode = (m.raw.mode as import('./modes').Mode) ?? 'ADD';
        if (typeof value === 'number') {
          val = applyNumericMode(val, mode, value);
        }
      }
      speeds[key] = Math.max(0, val);
    }
  }
  // Clamp all speeds to 0 (SRD: exhaustion can reduce speed to 0 but not below)
  for (const key of Object.keys(speeds)) {
    speeds[key] = Math.max(0, speeds[key]);
  }
  return speeds;
}

function computeSpellcasting(
  character: CharacterDocument,
  active: ActiveContent[],
  abilities: Record<AbilityKey, AbilityCell>,
  proficiencyBonus: number,
  content: ContentLookup
): {
  ability: AbilityKey | null;
  dc: number | null;
  attack: number | null;
  slots: Record<number, { max: number; used: number }>;
} {
  // Find a caster class on the character. Subclasses (Arcane Trickster,
  // Eldritch Knight, etc.) can also declare a `data.spellcasting` block; we
  // consult the subclass row if the class row has none, which captures the
  // 1/3-caster pattern. The class level still drives the slot table.
  for (const c of character.classes) {
    const classRow = content({ kind: 'class', slug: c.slug });
    let sc = classRow?.data.spellcasting as
      | { ability: AbilityKey; progression: string }
      | null
      | undefined;
    if (!sc && c.subclass) {
      const subRow = content({ kind: 'subclass', slug: c.subclass });
      sc = subRow?.data.spellcasting as
        | { ability: AbilityKey; progression: string }
        | null
        | undefined;
    }
    if (!sc) continue;
    const mod = abilities[sc.ability].mod;
    return {
      ability: sc.ability,
      dc: 8 + proficiencyBonus + mod,
      attack: proficiencyBonus + mod,
      slots: slotsFor(sc.progression, c.level)
    };
  }
  return { ability: null, dc: null, attack: null, slots: {} };
}

function slotsFor(
  progression: string,
  level: number
): Record<number, { max: number; used: number }> {
  switch (progression) {
    case 'full':
      return fullCasterSlots(level);
    case 'half':
      return halfCasterSlots(level);
    case 'third':
      return thirdCasterSlots(level);
    case 'pact':
      return pactCasterSlots(level);
    case 'artificer':
      return artificerCasterSlots(level);
    default:
      return {};
  }
}

/** Single-class third caster (Arcane Trickster / Eldritch Knight). 5e/5.5e
 *  spell-slot table. Third casters get spells starting at L3 and slow
 *  progression to 4th-level slots at L19. */
function thirdCasterSlots(level: number): Record<number, { max: number; used: number }> {
  const table: Record<number, number[]> = {
    1: [],
    2: [],
    3: [2],
    4: [3],
    5: [3],
    6: [3],
    7: [4, 2],
    8: [4, 2],
    9: [4, 2],
    10: [4, 3],
    11: [4, 3],
    12: [4, 3],
    13: [4, 3, 2],
    14: [4, 3, 2],
    15: [4, 3, 2],
    16: [4, 3, 3],
    17: [4, 3, 3],
    18: [4, 3, 3],
    19: [4, 3, 3, 1],
    20: [4, 3, 3, 1]
  };
  return rowToSlots(table[level] ?? []);
}

/** Artificer (Tasha's). Same slot count as half-caster but gains 1st-level slots at L1.
 *  Progression: 1st slots start at L1; reaches 5th-level slots at L17. */
function artificerCasterSlots(level: number): Record<number, { max: number; used: number }> {
  const table: Record<number, number[]> = {
    1:  [2],
    2:  [2],
    3:  [3],
    4:  [3],
    5:  [4, 2],
    6:  [4, 2],
    7:  [4, 3],
    8:  [4, 3],
    9:  [4, 3, 2],
    10: [4, 3, 2],
    11: [4, 3, 3],
    12: [4, 3, 3],
    13: [4, 3, 3, 1],
    14: [4, 3, 3, 1],
    15: [4, 3, 3, 2],
    16: [4, 3, 3, 2],
    17: [4, 3, 3, 3, 1],
    18: [4, 3, 3, 3, 1],
    19: [4, 3, 3, 3, 2],
    20: [4, 3, 3, 3, 2]
  };
  return rowToSlots(table[level] ?? []);
}

/** Single-class half caster (Paladin/Ranger). 2024 PHB spell-slot table.
 *  Half casters get spells starting at L2 and slow progression to 5th-level slots at L17. */
function halfCasterSlots(level: number): Record<number, { max: number; used: number }> {
  const table: Record<number, number[]> = {
    1: [],
    2: [2],
    3: [3],
    4: [3],
    5: [4, 2],
    6: [4, 2],
    7: [4, 3],
    8: [4, 3],
    9: [4, 3, 2],
    10: [4, 3, 2],
    11: [4, 3, 3],
    12: [4, 3, 3],
    13: [4, 3, 3, 1],
    14: [4, 3, 3, 1],
    15: [4, 3, 3, 2],
    16: [4, 3, 3, 2],
    17: [4, 3, 3, 3, 1],
    18: [4, 3, 3, 3, 1],
    19: [4, 3, 3, 3, 2],
    20: [4, 3, 3, 3, 2]
  };
  return rowToSlots(table[level] ?? []);
}

/** Warlock Pact Magic. Returns one entry per level keyed by spell level
 *  (1-5), with `max` = number of pact slots at that level. Pact slots all
 *  refresh on a short rest (the engine emits resources[] separately when
 *  Pact Magic is rolled into the activity-driven recovery model). */
function pactCasterSlots(level: number): Record<number, { max: number; used: number }> {
  // 2024 PHB Pact Magic: slots / slot-level
  //   L1: 1 / 1st
  //   L2: 2 / 1st
  //   L3: 2 / 2nd
  //   L4: 2 / 2nd
  //   L5: 2 / 3rd
  //   L6: 2 / 3rd
  //   L7: 2 / 4th
  //   L8: 2 / 4th
  //   L9: 2 / 5th
  //   L10: 2 / 5th
  //   L11+: 3 / 5th (3 at L11/L12/L13/L14/L15/L16, then 4 at L17+)
  const table: Array<{ count: number; slotLevel: number }> = [
    { count: 1, slotLevel: 1 }, // L1
    { count: 2, slotLevel: 1 }, // L2
    { count: 2, slotLevel: 2 },
    { count: 2, slotLevel: 2 },
    { count: 2, slotLevel: 3 },
    { count: 2, slotLevel: 3 },
    { count: 2, slotLevel: 4 },
    { count: 2, slotLevel: 4 },
    { count: 2, slotLevel: 5 },
    { count: 2, slotLevel: 5 },
    { count: 3, slotLevel: 5 }, // L11
    { count: 3, slotLevel: 5 },
    { count: 3, slotLevel: 5 },
    { count: 3, slotLevel: 5 },
    { count: 3, slotLevel: 5 },
    { count: 3, slotLevel: 5 }, // L16
    { count: 4, slotLevel: 5 }, // L17+
    { count: 4, slotLevel: 5 },
    { count: 4, slotLevel: 5 },
    { count: 4, slotLevel: 5 }
  ];
  const entry = table[Math.max(1, Math.min(20, level)) - 1];
  if (!entry) return {};
  return { [entry.slotLevel]: { max: entry.count, used: 0 } };
}

function rowToSlots(row: number[]): Record<number, { max: number; used: number }> {
  const slots: Record<number, { max: number; used: number }> = {};
  for (let i = 0; i < row.length; i++) {
    slots[i + 1] = { max: row[i], used: 0 };
  }
  return slots;
}

/** Single-class full caster spell-slot table per 2024 PHB. */
function fullCasterSlots(level: number): Record<number, { max: number; used: number }> {
  const table: Record<number, number[]> = {
    1: [2],
    2: [3],
    3: [4, 2],
    4: [4, 3],
    5: [4, 3, 2],
    6: [4, 3, 3],
    7: [4, 3, 3, 1],
    8: [4, 3, 3, 2],
    9: [4, 3, 3, 3, 1],
    10: [4, 3, 3, 3, 2],
    11: [4, 3, 3, 3, 2, 1],
    12: [4, 3, 3, 3, 2, 1],
    13: [4, 3, 3, 3, 2, 1, 1],
    14: [4, 3, 3, 3, 2, 1, 1],
    15: [4, 3, 3, 3, 2, 1, 1, 1],
    16: [4, 3, 3, 3, 2, 1, 1, 1],
    17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
    18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
    19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
    20: [4, 3, 3, 3, 3, 2, 2, 1, 1]
  };
  const row = table[level] ?? [];
  const slots: Record<number, { max: number; used: number }> = {};
  for (let i = 0; i < row.length; i++) {
    slots[i + 1] = { max: row[i], used: 0 };
  }
  return slots;
}

/** Resolve a cast-spell activity's `spell` reference. Two authored
 *  shapes:
 *    - literal:    `spell: { slug, version? }`
 *    - parametric: `spell: { fromChoice: '<choice slot>' }` — reads the
 *      picked spell slug from the originating inventory slot's
 *      `choices[<choice slot>]` (a Spell Scroll whose spell the player
 *      picks). Composes with spellOverrides / chargeCost like a literal
 *      ref.
 *  Returns the resolved ref, or the unresolved choice-slot name when
 *  the parametric shape has no recorded pick. */
function resolveCastSpellRef(
  act: Record<string, unknown>,
  source: ActiveContent
): { ref?: { slug: string; version?: number }; needsChoice?: string } {
  const spec = act.spell as
    | { slug?: unknown; version?: unknown; fromChoice?: unknown }
    | undefined;
  if (!spec) return {};
  if (typeof spec.slug === 'string' && spec.slug.length > 0) {
    return {
      ref: {
        slug: spec.slug,
        ...(typeof spec.version === 'number' ? { version: spec.version } : {})
      }
    };
  }
  if (typeof spec.fromChoice === 'string' && spec.fromChoice.length > 0) {
    const picked = source.inventorySlot?.choices?.[spec.fromChoice];
    if (typeof picked === 'string' && picked.length > 0) {
      return { ref: { slug: picked } };
    }
    return { needsChoice: spec.fromChoice };
  }
  return {};
}

function realizeActivity(
  act: Record<string, unknown>,
  source: ActiveContent,
  character: CharacterDocument,
  stats: StatBlock,
  content: ContentLookup,
  ctx: EvalContext
): Action | null {
  const type = act.type as string | undefined;
  const id = (act.id as string | undefined) ?? `${source.row.kind}/${source.row.slug}/act`;
  const name = (act.name as string | undefined) ?? id;
  const cost = (act.cost ?? 'action') as Action['cost'];

  const action: Action = {
    id: `${source.row.kind}/${source.row.slug}/${id}`,
    sourceContent: { kind: source.row.kind, slug: source.row.slug },
    name,
    type: type ?? 'utility',
    cost,
    // Filled in below — `single` is just a placeholder so the type is
    // satisfied while we collect attack/save info needed by the heuristic.
    targetMode: 'single',
    appliedModifiers: []
  };
  if (act.range && typeof act.range === 'object') {
    action.range = act.range as { value: number; units: string };
  }

  // Upcast scaling — merged from two pack shapes:
  //   (a) Activity-level `upcastScaling` (engine-native, covers all
  //       scaling kinds incl. tempHp).
  //   (b) The SRD-author shape `damage.scalesWithSlotLevel` and
  //       activity-level `scalesWithSlotLevel`, using the existing
  //       perSlotAbove / addDice / addDarts / addTargets keys the SRD
  //       content already ships.
  //
  // Consumers (encounter runtime / planner) read Action.upcastScaling
  // and call applyUpcast(action, slot) to get the slot-adjusted variant.
  const upcastScaling: Record<string, unknown> = {};
  let upcastBase: number | undefined;
  // (a) Engine-native shape
  if (act.upcastScaling && typeof act.upcastScaling === 'object') {
    const spec = act.upcastScaling as Record<string, unknown>;
    if (typeof spec.baseSlotLevel === 'number') upcastBase = spec.baseSlotLevel;
    if (typeof spec.extraDamagePerSlot === 'string') upcastScaling.extraDamagePerSlot = spec.extraDamagePerSlot;
    if (typeof spec.extraFlatDamagePerSlot === 'number')
      upcastScaling.extraFlatDamagePerSlot = spec.extraFlatDamagePerSlot;
    if (typeof spec.extraTargetsPerSlot === 'number')
      upcastScaling.extraTargetsPerSlot = spec.extraTargetsPerSlot;
    if (typeof spec.extraHealPerSlot === 'string') upcastScaling.extraHealPerSlot = spec.extraHealPerSlot;
    if (typeof spec.extraTempHpPerSlot === 'number')
      upcastScaling.extraTempHpPerSlot = spec.extraTempHpPerSlot;
  }
  // (b) SRD shape: damage.scalesWithSlotLevel for damage scaling
  const damageBlock = act.damage as Record<string, unknown> | undefined;
  const damageScaling = damageBlock?.scalesWithSlotLevel as Record<string, unknown> | undefined;
  if (damageScaling) {
    if (upcastBase === undefined && typeof damageScaling.perSlotAbove === 'number') {
      upcastBase = damageScaling.perSlotAbove;
    }
    if (!('extraDamagePerSlot' in upcastScaling) && typeof damageScaling.addDice === 'string') {
      upcastScaling.extraDamagePerSlot = damageScaling.addDice;
    }
  }
  // (b) SRD shape: activity-level scalesWithSlotLevel for target-count
  // (Magic Missile addDarts; Hold Person / Banishment addTargets) and
  // heal scaling (Cure Wounds addDice at activity scope).
  const actScaling = act.scalesWithSlotLevel as Record<string, unknown> | undefined;
  if (actScaling) {
    if (upcastBase === undefined && typeof actScaling.perSlotAbove === 'number') {
      upcastBase = actScaling.perSlotAbove;
    }
    if (!('extraTargetsPerSlot' in upcastScaling)) {
      if (typeof actScaling.addTargets === 'number') {
        upcastScaling.extraTargetsPerSlot = actScaling.addTargets;
      } else if (typeof actScaling.addDarts === 'number') {
        upcastScaling.extraTargetsPerSlot = actScaling.addDarts;
      }
    }
    // Heal scaling at activity scope — only treat addDice as heal when the
    // activity has a `heal` field (Cure Wounds shape).
    if (
      !('extraHealPerSlot' in upcastScaling) &&
      typeof actScaling.addDice === 'string' &&
      act.heal
    ) {
      upcastScaling.extraHealPerSlot = actScaling.addDice;
    }
  }
  // Final assembly: need both a base slot level (spell row's level is the
  // sensible default) and at least one scaling field.
  if (Object.keys(upcastScaling).length > 0) {
    const baseLevel = upcastBase ?? (source.data.level as number | undefined);
    if (typeof baseLevel === 'number') {
      action.upcastScaling = { baseSlotLevel: baseLevel, ...upcastScaling } as Action['upcastScaling'];
    }
  }

  // Caster-side grants on activity resolution (temp HP, etc.). Spell
  // rows like Armor of Agathys carry `grants.tempHp: 5`; False Life
  // carries '1d4+4' (dice formula passes through as string for the
  // runtime to roll).
  if (act.grants && typeof act.grants === 'object') {
    const g = act.grants as Record<string, unknown>;
    const grants: Record<string, unknown> = {};
    if ('tempHp' in g) {
      const resolved = evaluateValue(g.tempHp, ctx);
      if (typeof resolved === 'number') grants.tempHp = resolved;
      else if (typeof resolved === 'string' && resolved.length > 0) grants.tempHp = resolved;
    }
    // Condition-removal grants (Lesser Restoration shape). A string
    // entry removes the condition entirely; `{ condition, stacks }`
    // decrements conditionStacks by N (removal at 0 is the applier's
    // business). `stacks` is kept numeric-only — no evaluateValue.
    if (Array.isArray(g.removeConditions)) {
      const entries: Array<string | { condition: string; stacks?: number }> = [];
      for (const e of g.removeConditions as unknown[]) {
        if (typeof e === 'string' && e.length > 0) {
          entries.push(e);
        } else if (e && typeof e === 'object') {
          const condition = (e as { condition?: unknown }).condition;
          if (typeof condition !== 'string' || condition.length === 0) continue;
          const stacks = (e as { stacks?: unknown }).stacks;
          entries.push(
            typeof stacks === 'number' && stacks > 0 ? { condition, stacks } : { condition }
          );
        }
      }
      if (entries.length > 0) grants.removeConditions = entries;
    }
    // Spell-slot recovery (spell-refueling ring). Display-only like the
    // other grants — `level` is the max restorable slot level, `count`
    // defaults to 1. Numeric-only, no evaluateValue.
    if (g.restoreSpellSlots && typeof g.restoreSpellSlots === 'object') {
      const r = g.restoreSpellSlots as { level?: unknown; count?: unknown };
      if (typeof r.level === 'number' && r.level >= 1) {
        grants.restoreSpellSlots = {
          level: Math.floor(r.level),
          ...(typeof r.count === 'number' && r.count > 0 ? { count: Math.floor(r.count) } : {})
        };
      }
    }
    if (Object.keys(grants).length > 0) {
      action.grants = grants as Action['grants'];
    }
  }

  // Structured self-teleport payload (boots of the winding path, Rift
  // Step). Display contract — passes through onto Action.teleport.
  if (act.teleport && typeof act.teleport === 'object') {
    const t = act.teleport as { distanceFt?: unknown; mode?: unknown };
    const teleport: NonNullable<Action['teleport']> = {
      ...(typeof t.distanceFt === 'number' && t.distanceFt > 0
        ? { distanceFt: t.distanceFt }
        : {}),
      ...(t.mode === 'line-of-sight' || t.mode === 'unrestricted' ? { mode: t.mode } : {})
    };
    if (Object.keys(teleport).length > 0) action.teleport = teleport;
  }

  // Random-effect table (Wand of Wonder, Deck of Many Things, Bag of
  // Beans, Experimental Elixir). Declaration only — derive() has no RNG.
  const randomTable = coerceRandomTable(act.randomTable);
  if (randomTable) action.randomTable = randomTable;

  if (type === 'attack') {
    const attack = act.attack as
      | {
          ability?: string;
          bonus?: number;
          classification?: 'weapon' | 'spell';
          range?: 'melee' | 'ranged';
          damage?: Array<{ dice: unknown; type: string }>;
        }
      | undefined;
    if (attack) {
      // Fixed attack bonus: a literal `attack.bonus` is used verbatim —
      // no ability mod, no proficiency, and no ability mod added to the
      // damage formula (ring-of-the-ram style: +7 to hit, 2d10 flat).
      // `attack.ability` may be absent in this shape; attackAbility stays
      // unset so character-wide weapon crit riders don't attach.
      const fixedBonus = typeof attack.bonus === 'number' ? attack.bonus : null;
      let mod = 0;
      if (fixedBonus !== null) {
        action.attackBonus = fixedBonus;
      } else {
        const ability = resolveAttackAbility(attack, source, stats);
        mod = stats.abilities[ability].mod;
        const proficient = computeAttackProficiency(attack, source, character, stats);
        action.attackBonus = mod + (proficient ? stats.proficiencyBonus : 0);
        action.attackAbility = ability;
      }
      action.attackRange = attack.range;
      action.weaponProperties = (source.data.properties as string[] | undefined) ?? [];
      if (attack.damage) {
        action.damageRolls = attack.damage.map((d) => {
          const formula = typeof d.dice === 'string' ? d.dice : String(evaluateValue(d.dice, ctx) ?? '');
          return {
            formula: fixedBonus !== null ? formula : addAbilityToFormula(formula, mod),
            type: d.type
          };
        });
      } else {
        // 5etools shape: damage lives at act.damage.parts as a sibling of
        // act.attack, not inline. Pull from there too. Ability mod typically
        // isn't added to cantrip damage, so we copy `dice` straight through;
        // weapon-style spells with the mod still go through the inline path.
        const parts = (act.damage as { parts?: Array<{ dice: unknown; type: string }> } | undefined)?.parts;
        if (parts) {
          action.damageRolls = parts.map((d) => {
            const formula = typeof d.dice === 'string' ? d.dice : String(evaluateValue(d.dice, ctx) ?? '');
            return { formula, type: d.type };
          });
        }
      }
    }
  } else if (type === 'save') {
    const save = act.save as { ability: string; dc?: { calc?: string; value?: number; base?: number; bonus?: string[] } } | undefined;
    if (save) {
      let value: number;
      if (save.dc?.calc === 'spell') {
        value = stats.spellSaveDC ?? 8;
      } else if (save.dc?.calc === 'custom') {
        value = save.dc.base ?? 8;
        for (const token of save.dc.bonus ?? []) {
          value += resolveStatToken(token, stats);
        }
      } else {
        value = save.dc?.value ?? 8;
      }
      action.saveDC = { ability: save.ability, value };
      const damage = (act.damage as { parts?: Array<{ dice: unknown; type: string }> } | undefined)?.parts;
      if (damage) {
        action.damageRolls = damage.map((d) => {
          const formula = typeof d.dice === 'string' ? d.dice : String(evaluateValue(d.dice, ctx) ?? '');
          return { formula, type: d.type };
        });
      }
    }
  } else if (type === 'damage') {
    const damage = (act.damage as { parts?: Array<{ dice: unknown; type: string }> } | undefined)?.parts;
    if (damage) {
      action.damageRolls = damage.map((d) => {
        const formula = typeof d.dice === 'string' ? d.dice : String(evaluateValue(d.dice, ctx) ?? '');
        return { formula, type: d.type };
      });
    }
  } else if (type === 'cast-spell') {
    // Items (and someday monster innate spellcasting) reference a spell by
    // slug. Inline the referenced spell's primary activity so attack/save/
    // damage details flow into this Action. The action's sourceContent stays
    // on the item — the caller can still trace it back to the driftglobe.
    // Parametric shape: `spell: { fromChoice: '<choice slot>' }` resolves
    // the slug from the originating inventory slot's recorded pick; with
    // no pick the action realizes as a stub tagged `needsChoice` (no
    // inline, no warning — pendingItemChoices surfaces the gap).
    const resolved = resolveCastSpellRef(act, source);
    if (resolved.needsChoice) action.needsChoice = resolved.needsChoice;
    const ref = resolved.ref;
    if (ref?.slug) {
      const spellRow = content({ kind: 'spell', slug: ref.slug, version: ref.version });
      if (spellRow) {
        const spellActs =
          (spellRow.data.activities as Array<Record<string, unknown>> | undefined) ?? [];
        const primary = spellActs[0];
        if (primary) {
          const inlined = realizeActivity(
            primary,
            { ref: { kind: spellRow.kind, slug: spellRow.slug }, row: spellRow, data: spellRow.data },
            character,
            stats,
            content,
            ctx
          );
          if (inlined) {
            action.attackBonus = inlined.attackBonus;
            action.attackAbility = inlined.attackAbility;
            action.attackRange = inlined.attackRange;
            action.damageRolls = inlined.damageRolls;
            action.saveDC = inlined.saveDC;
          }
        }
        if (!action.range && spellRow.data.range && typeof spellRow.data.range === 'object') {
          action.range = spellRow.data.range as { value: number; units: string };
        }
      }
    }
    // Literal overrides on the inlined spell numbers — "the item casts
    // Fireball, save DC 15". Applied AFTER inlining so the authored
    // literal replaces the character-derived DC / attack bonus. Only the
    // cast-spell path honors spellOverrides; plain save activities
    // already express a literal DC via `save.dc.value`.
    const overrides = act.spellOverrides as
      | { saveDC?: number; attackBonus?: number }
      | undefined;
    if (overrides) {
      if (typeof overrides.saveDC === 'number' && action.saveDC) {
        action.saveDC = { ...action.saveDC, value: overrides.saveDC };
      }
      if (typeof overrides.attackBonus === 'number' && action.attackBonus != null) {
        action.attackBonus = overrides.attackBonus;
      }
    }
  } else if (type === 'summon') {
    // Content-driven companion summoning. The activity's `summon` block
    // lists monster slugs (plus optional counts / display names); the
    // resolved payload lands on Action.summons for the sheet / runtime
    // to append CompanionState entries when the action resolves.
    // Unresolved slugs still pass through (the runtime falls back to a
    // 0-HP shell the DM can edit) — the summon-missing-content soft
    // warning in runSoftValidations surfaces them to authors.
    const spec = act.summon as
      | {
          creatures?: Array<{ slug?: unknown; count?: unknown; name?: unknown }>;
          choice?: unknown;
          duration?: unknown;
        }
      | undefined;
    const creatures: NonNullable<Action['summons']>['creatures'] = [];
    for (const c of spec?.creatures ?? []) {
      if (typeof c?.slug !== 'string' || c.slug.length === 0) continue;
      const countRaw = c.count != null ? evaluateValue(c.count, ctx) : 1;
      const count = typeof countRaw === 'number' && countRaw > 0 ? Math.floor(countRaw) : 1;
      const row = content({ kind: 'monster', slug: c.slug });
      creatures.push({
        slug: c.slug,
        count,
        ...(typeof c.name === 'string' && c.name.length > 0 ? { name: c.name } : {}),
        ...(row ? { resolvedName: row.name } : {})
      });
    }
    if (creatures.length > 0) {
      const duration = spec?.duration as { value?: unknown; units?: unknown } | undefined;
      action.summons = {
        creatures,
        choice: spec?.choice === true,
        ...(typeof duration?.value === 'number' && typeof duration?.units === 'string'
          ? { duration: duration as ActivationDuration }
          : {})
      };
    }
  }

  // Item charge-pool debit: an activity on a charged item that declares
  // `chargeCost` debits the item's shared `item/<slug>/charges` pool
  // (emitted by collectResources). Variable-cost items author sibling
  // activities with different chargeCosts. Activities with their own
  // `uses` block keep their independent per-activity counter instead —
  // never both.
  if (source.row.kind === 'item' && act.chargeCost != null && !act.uses) {
    const pool = normalizeItemCharges(source.data);
    if (pool) {
      action.spendsResource = `item/${source.row.slug}/charges`;
      action.resourceCost =
        typeof act.chargeCost === 'number' && act.chargeCost > 0
          ? Math.floor(act.chargeCost)
          : 1;
    }
  }

  // Any activity type may carry `act.damage.parts` for an associated die
  // that gets surfaced in the action panel (e.g. Bardic Inspiration's
  // d6–d12 die, healing dice on utility activities). Set damageRolls only
  // if not already populated by the type-specific block above.
  if (!action.damageRolls) {
    const parts = (act.damage as { parts?: Array<{ dice: unknown; type: string }> } | undefined)?.parts;
    if (parts && parts.length > 0) {
      action.damageRolls = parts.map((d) => {
        const formula = typeof d.dice === 'string' ? d.dice : String(evaluateValue(d.dice, ctx) ?? '');
        return { formula, type: d.type };
      });
    }
  }

  // Target mode: per-activity override → source-row override → heuristic.
  const actTarget = act.target as { mode?: string; count?: number } | undefined;
  const rowTarget = (source.data as { target?: { mode?: string; count?: number } }).target;
  let inlinedTarget: { mode?: string; count?: number } | undefined;
  if (type === 'cast-spell') {
    const ref = resolveCastSpellRef(act, source).ref;
    if (ref?.slug) {
      const spellRow = content({ kind: 'spell', slug: ref.slug, version: ref.version });
      inlinedTarget = (spellRow?.data as { target?: { mode?: string; count?: number } } | undefined)?.target;
    }
  }
  const override = actTarget ?? rowTarget ?? inlinedTarget;
  if (override?.mode === 'self' || override?.mode === 'single' || override?.mode === 'multi') {
    action.targetMode = override.mode;
    if (override.count != null) action.targetCount = override.count;
  } else {
    const isSelfRange =
      action.range?.units === 'self' ||
      (action.range?.value === 0 && action.attackBonus == null && action.saveDC == null);
    if (isSelfRange) {
      action.targetMode = 'self';
    } else if (action.attackBonus != null) {
      action.targetMode = 'single';
    } else if (action.saveDC) {
      action.targetMode = 'multi';
    } else {
      action.targetMode = 'single';
    }
  }

  return action;
}

function resolveAttackAbility(
  attack: { ability?: string },
  source: ActiveContent,
  stats: StatBlock
): AbilityKey {
  const a = attack.ability;
  if (!a) return 'str';
  // `spellcasting` is the engine-native marker; `spell` is the 5etools
  // convention. Both resolve to the caster's spellcasting ability.
  if (a === 'spellcasting' || a === 'spell') return stats.spellcastingAbility ?? 'int';
  if (a.startsWith('best-of:')) {
    const opts = a.slice('best-of:'.length).split(',') as AbilityKey[];
    const properties = (source.data.properties as string[] | undefined) ?? [];
    // Finesse weapons: best of str/dex
    if (properties.includes('finesse')) {
      return opts.reduce((best, x) => (stats.abilities[x].mod > stats.abilities[best].mod ? x : best), opts[0]);
    }
    return opts[0];
  }
  return a as AbilityKey;
}

function computeAttackProficiency(
  attack: { classification?: 'weapon' | 'spell' },
  source: ActiveContent,
  character: CharacterDocument,
  stats: StatBlock
): boolean {
  if (attack.classification === 'spell') return true; // spell attack uses spellcasting prof
  const weaponType = source.data.weaponType as string | undefined;
  const wp = stats.weaponProficiencies;
  // Modifier-granted proficiencies (e.g. Weapon Master feat) take precedence.
  // We match the category (simple/martial), the full weaponType (e.g.
  // "martial-melee"), or the weapon's own slug.
  if (weaponType?.startsWith('simple-') && (wp.includes('simple') || wp.includes(weaponType))) return true;
  if (weaponType?.startsWith('martial-') && (wp.includes('martial') || wp.includes(weaponType))) return true;
  if (wp.includes(source.row.slug)) return true;
  // v0 shortcut: most martial/simple distinctions in fixtures will trust the assignment.
  if (weaponType?.startsWith('simple-')) return true;
  if (weaponType?.startsWith('martial-')) {
    // The class proficiencies live on the class row; v0 assumes martial proficiency
    // for fighters/barbarians/paladins/rangers — surfaces in fixtures correctly.
    return character.classes.some((c) => ['barbarian', 'fighter', 'paladin', 'ranger'].includes(c.slug));
  }
  return true;
}

function addAbilityToFormula(dice: string, mod: number): string {
  if (mod === 0) return dice;
  return mod > 0 ? `${dice}+${mod}` : `${dice}${mod}`;
}

/** Homebrew items often store weapon stats inline (damage, damageType,
 *  weaponType, properties) without authoring a full `activities` block.
 *  Synthesize a single attack activity so the weapon can be used. Returns
 *  null when the item isn't shaped like a weapon (no damage string). */
function synthesizeWeaponActivity(
  slug: string,
  name: string,
  data: Record<string, unknown>
): Record<string, unknown> | null {
  const damage = data.damage;
  if (typeof damage !== 'string' || damage.length === 0) return null;
  const looksLikeWeapon =
    data.itemType === 'weapon' ||
    data.category === 'weapon' ||
    typeof data.weaponType === 'string';
  if (!looksLikeWeapon) return null;
  const damageType = (data.damageType as string | undefined) ?? '';
  const properties = (data.properties as string[] | undefined) ?? [];
  const weaponType = (data.weaponType as string | undefined) ?? '';
  const isRanged =
    weaponType.includes('ranged') || properties.includes('ammunition');
  const ability = isRanged
    ? 'dex'
    : properties.includes('finesse')
      ? 'best-of:str,dex'
      : 'str';
  return {
    id: `${slug}-attack`,
    type: 'attack',
    name: `${name} Attack`,
    cost: 'action',
    attack: {
      ability,
      classification: 'weapon',
      range: isRanged ? 'ranged' : 'melee',
      damage: [{ dice: damage, type: damageType }]
    }
  };
}

/** Base-weapon binding for generic-variant weapons (`data.
 *  baseWeaponFromChoice: true` + a `baseWeapon` choice slot). Resolves
 *  the picked base weapon row and produces the attack activity this
 *  item should realize, against a source whose data is the base row's
 *  fields overlaid with the item's own (item fields win — an item that
 *  authors its own damage/properties keeps them; everything it omits
 *  flows from the base, so a bound greatsword is a martial greatsword
 *  for proficiency, finesse, and predicate purposes).
 *
 *  Activity selection: the base row's authored `type: 'attack'`
 *  activity when present (SRD weapons author full activities), renamed
 *  onto the item; else flat-damage synthesis via
 *  synthesizeWeaponActivity against the merged data. Returns null when
 *  no pick is recorded or the base row / attack shape can't be
 *  resolved — the item then contributes no attack action. */
function resolveBoundWeaponSynthesis(
  a: ActiveContent,
  content: ContentLookup
): { activity: Record<string, unknown>; source: ActiveContent } | null {
  const pick = a.inventorySlot?.choices?.baseWeapon;
  if (typeof pick !== 'string' || pick.length === 0) return null;
  const baseRow = content({ kind: 'item', slug: pick });
  if (!baseRow) return null;
  const merged: Record<string, unknown> = { ...baseRow.data, ...a.data };
  const source: ActiveContent = { ...a, data: merged };
  const baseActs = (baseRow.data.activities as Array<Record<string, unknown>> | undefined) ?? [];
  const attackAct = baseActs.find((x) => x && x.type === 'attack');
  if (attackAct) {
    return {
      activity: { ...attackAct, id: `${a.row.slug}-attack`, name: `${a.row.name} Attack` },
      source
    };
  }
  const synth = synthesizeWeaponActivity(a.row.slug, a.row.name, merged);
  return synth ? { activity: synth, source } : null;
}

/** Spell-storage cast actions (see the spellStorage block in
 *  assembleActivities). Each `InventorySlot.stored[]` entry inlines the
 *  referenced spell's primary activity — exactly like a cast-spell
 *  activity would — then:
 *    - upcasts to the stored level (a Fireball stored at L5 is 10d6),
 *      and strips upcastScaling so the planner can't re-scale a cast
 *      whose level is fixed by the storer;
 *    - overrides save DC / attack bonus with the storer's recorded
 *      numbers when present (else the wearer's own derived values
 *      stand);
 *    - notes the stored level (+ optional attribution label) on
 *      Action.description — a validation-free summary.
 *  Unresolvable spell slugs are skipped silently (character-state gap,
 *  not a pack-authoring error). */
function realizeStoredSpells(
  a: ActiveContent,
  character: CharacterDocument,
  stats: StatBlock,
  content: ContentLookup,
  ctx: EvalContext
): Action[] {
  const out: Action[] = [];
  const stored = a.inventorySlot?.stored ?? [];
  for (let i = 0; i < stored.length; i++) {
    const st = stored[i];
    if (!st || typeof st.slug !== 'string' || st.slug.length === 0) continue;
    const spellRow = content({ kind: 'spell', slug: st.slug });
    if (!spellRow) continue;
    const spellActs =
      (spellRow.data.activities as Array<Record<string, unknown>> | undefined) ?? [];
    const primary = spellActs[0];
    if (!primary) continue;
    const inlined = realizeActivity(
      primary,
      { ref: { kind: spellRow.kind, slug: spellRow.slug }, row: spellRow, data: spellRow.data },
      character,
      stats,
      content,
      ctx
    );
    if (!inlined) continue;
    const level = typeof st.level === 'number' && st.level > 0 ? Math.floor(st.level) : 0;
    const cast = level > 0 ? applyUpcast(inlined, level) : inlined;
    const action: Action = {
      ...cast,
      id: `item/${a.row.slug}/stored/${i}/${st.slug}`,
      sourceContent: { kind: a.row.kind, slug: a.row.slug },
      name: `${spellRow.name} (stored)`,
      description: `Cast at level ${level} from ${a.row.name}${
        st.label ? ` (${st.label})` : ''
      }.`,
      appliedModifiers: []
    };
    delete action.upcastScaling;
    if (typeof st.dc === 'number' && action.saveDC) {
      action.saveDC = { ...action.saveDC, value: st.dc };
    }
    if (typeof st.attackBonus === 'number' && action.attackBonus != null) {
      action.attackBonus = st.attackBonus;
    }
    out.push(action);
  }
  return out;
}

function buildActionContext(
  action: Action,
  sourceData: Record<string, unknown> | undefined
): PredicateContext {
  const damageTypes = (action.damageRolls ?? []).map((d) => d.type);
  const isSpell = action.sourceContent.kind === 'spell';
  return {
    activityType: action.type,
    attack: {
      range: action.attackRange,
      ability: action.attackAbility,
      classification: isSpell ? 'spell' : 'weapon'
    },
    damage: {
      type: damageTypes[0],
      types: damageTypes
    },
    weapon: {
      property: action.weaponProperties ?? [],
      proficient: action.attackBonus != null, // crude v0 proxy
      kind: (sourceData?.weaponType as string | undefined) ?? undefined,
      slug: isSpell ? undefined : action.sourceContent.slug
    },
    spell: isSpell
      ? {
          slug: action.sourceContent.slug,
          school: sourceData?.school as string | undefined,
          // `class` is the caster-class slug; spread to all entries on
          // sourceData.classes when present.
          class: sourceData?.classes as string[] | undefined,
          level: sourceData?.level as number | undefined
        }
      : { slug: undefined }
  };
}

function applyActionEffect(
  action: Action,
  eff: Record<string, unknown>,
  ctx: EvalContext
): void {
  const target = eff.target as string | undefined;
  const mode = ((eff.mode as Mode) ?? 'ADD') as Mode;
  const rawValue = evaluateValue(eff.value, ctx);
  if (!target) return;
  switch (target) {
    case 'attack.roll':
      if (typeof rawValue === 'number' && action.attackBonus != null) {
        action.attackBonus = applyNumericMode(action.attackBonus, mode, rawValue);
      }
      break;
    case 'damage.bonus':
      if (typeof rawValue === 'number' && action.damageRolls && action.damageRolls.length > 0) {
        action.damageRolls = action.damageRolls.map((d, i) =>
          i === 0 ? { ...d, formula: bumpFormula(d.formula, rawValue, mode) } : d
        );
      }
      break;
    case 'attack.advantage':
      // Surface as a tag on the action; v0 doesn't formally model advantage.
      // (Tag persists via appliedModifiers entry the caller adds.)
      break;
    case 'damage.dice':
      // Append an extra damage roll. `value` is the dice formula string
      // (e.g. "1d6"); `eff.damageType` carries the damage type (default
      // = first existing roll's type, or "untyped").
      if (typeof rawValue === 'string' && rawValue.length > 0) {
        const dtype =
          (eff.damageType as string | undefined) ??
          action.damageRolls?.[0]?.type ??
          'untyped';
        if (!action.damageRolls) action.damageRolls = [];
        action.damageRolls.push({ formula: rawValue, type: dtype });
      }
      break;
    case 'damage.die.min': {
      // Great Weapon Fighting reroll-1s-and-2s is modeled as a floor on
      // every die. value=3 means re-roll anything below 3. The natural mode
      // for a floor is UPGRADE (take the higher of current and value); we
      // default to UPGRADE here so a row can omit `mode` and still get the
      // expected semantics — ADD across stacked floors would compound
      // incorrectly.
      if (typeof rawValue === 'number') {
        const floorMode = eff.mode ? mode : 'UPGRADE';
        action.damageDieMin = applyNumericMode(action.damageDieMin ?? 1, floorMode, rawValue);
      }
      break;
    }
    case 'damage.ignore-resistance':
      if (rawValue === true) action.damageIgnoreResistance = true;
      break;
    case 'damage.reroll-and-keep-higher':
      if (rawValue === true) action.damageRerollAndKeepHigher = true;
      break;
    // Dice maximization / doubling. Same family as damage.die.min /
    // damage.reroll-and-keep-higher: boolean display contracts the roll-
    // time consumer honors. The `.vs-objects` siblings carry the sword-
    // of-sharpness scope, which no predicate can express (the engine has
    // no object-target model).
    case 'damage.maximize':
      if (rawValue === true) action.damageMaximized = true;
      break;
    case 'damage.maximize.vs-objects':
      if (rawValue === true) action.damageMaximizedVsObjects = true;
      break;
    case 'damage.double-dice':
      if (rawValue === true) action.damageDiceDoubled = true;
      break;
    case 'damage.double-dice.vs-objects':
      if (rawValue === true) action.damageDiceDoubledVsObjects = true;
      break;
    case 'heal.maximize':
      if (rawValue === true) action.healMaximized = true;
      break;
    case 'attack.no-disadvantage.within-5ft':
      if (rawValue === true) action.attackNoDisadvantageWithin5ft = true;
      break;
    case 'attack.ignores-cover':
      if (rawValue === true) action.attackIgnoresCover = true;
      break;
    case 'attack.no-disadvantage.long-range':
      if (rawValue === true) action.attackNoDisadvantageLongRange = true;
      break;
    case 'attack.ability': {
      // Allows using a different ability for attack + damage (e.g. Martial Arts
      // DEX override). Adjusts attackBonus by the mod difference and patches
      // the damage formula in place. Only meaningful with OVERRIDE mode.
      if (typeof rawValue !== 'string' || !action.attackAbility || action.attackBonus == null) break;
      const newAbility = rawValue as AbilityKey;
      if (newAbility === action.attackAbility) break;
      const oldMod = ctx.abilityMods[action.attackAbility] ?? 0;
      const newMod = ctx.abilityMods[newAbility] ?? 0;
      const diff = newMod - oldMod;
      action.attackBonus += diff;
      action.attackAbility = newAbility;
      if (diff !== 0 && action.damageRolls && action.damageRolls.length > 0) {
        action.damageRolls = action.damageRolls.map((d, i) =>
          i === 0 ? { ...d, formula: bumpFormula(d.formula, diff, 'ADD') } : d
        );
      }
      break;
    }
    default:
      // Other targets are no-op in v0.
      break;
  }
}

function bumpFormula(formula: string, bonus: number, mode: Mode): string {
  if (mode !== 'ADD' && mode !== 'OVERRIDE') return formula;
  // formula like "2d6+3" → "2d6+13" when bonus=10
  const match = formula.match(/^(.+?)([+-]\d+)?$/);
  if (!match) return formula;
  const dice = match[1];
  const existing = match[2] ? parseInt(match[2], 10) : 0;
  if (mode === 'OVERRIDE') {
    const sign = bonus >= 0 ? '+' : '';
    return bonus === 0 ? dice : `${dice}${sign}${bonus}`;
  }
  const total = existing + bonus;
  if (total === 0) return dice;
  const sign = total >= 0 ? '+' : '';
  return `${dice}${sign}${total}`;
}

// ---------------------------------------------------------------------------
// Maneuver synthesis (Battle Master)
// ---------------------------------------------------------------------------
// Per-pick emission: walks the declared `ManeuverEffect` discriminant and
// emits Action / Trigger / OutboundEffect entries tagged with
// `spendsResource` so the planner debits the class-resource pool. See
// docs/three-workstreams-plan.md WS1 § "Synthesis" for the table mapping
// effect.kind → emission.

function maneuverCostToActionCost(cost: ManeuverDecl['cost']): Action['cost'] {
  if (cost === 'free' || cost === 'action' || cost === 'bonus' || cost === 'reaction') return cost;
  return 'free';
}

function resolveManeuverSaveDC(
  dc: { calc: 'maneuver' } | { value: number },
  maneuverSaveDC: number
): number {
  if ('value' in dc && typeof dc.value === 'number') return dc.value;
  return maneuverSaveDC;
}

interface SynthesizeManeuverArgs {
  decl: ManeuverDecl;
  source: ActiveContent;
  actions: Action[];
  triggers: TriggerDeclaration[];
  outboundEffects: OutboundEffect[];
  maneuverSaveDC: number;
  validations: ValidationIssue[];
}

function synthesizeManeuver(args: SynthesizeManeuverArgs): void {
  const { decl, source, actions, triggers, outboundEffects, maneuverSaveDC } = args;
  const sourceContent = { kind: source.row.kind, slug: source.row.slug };
  const idBase = `${source.row.kind}/${source.row.slug}/maneuver/${decl.id}`;
  const effect: ManeuverEffect = decl.effect;

  switch (effect.kind) {
    case 'on-hit-rider': {
      const rider: ManeuverRider = {};
      if (effect.damageRider) rider.damageRider = effect.damageRider;
      if (effect.save) {
        rider.save = {
          ability: effect.save.ability,
          dcValue: resolveManeuverSaveDC(effect.save.dc, maneuverSaveDC),
          onFail: effect.save.onFail
        };
      }
      if (effect.maxTargetSize) rider.maxTargetSize = effect.maxTargetSize;
      const action: Action = {
        id: idBase,
        sourceContent,
        name: decl.name,
        type: 'maneuver-rider',
        cost: maneuverCostToActionCost(decl.cost),
        targetMode: 'single',
        description: decl.description,
        spendsResource: decl.spendsResource,
        gatedOnTrigger: 'attack.hit',
        maneuverRider: rider,
        appliedModifiers: []
      };
      if (effect.save) {
        action.saveDC = {
          ability: effect.save.ability,
          value: resolveManeuverSaveDC(effect.save.dc, maneuverSaveDC)
        };
      }
      actions.push(action);
      break;
    }
    case 'pre-roll': {
      const action: Action = {
        id: idBase,
        sourceContent,
        name: decl.name,
        type: 'maneuver-pre-roll',
        cost: maneuverCostToActionCost(decl.cost),
        targetMode: 'single',
        description: decl.description,
        spendsResource: decl.spendsResource,
        gatedOnTrigger: 'attack.declare',
        riderLabel: `+1 ${effect.dieFromResource} die to ${effect.addsToRoll} roll`,
        appliedModifiers: []
      };
      actions.push(action);
      break;
    }
    case 'damage-reduction': {
      const rider: ManeuverRider = { reduceBy: effect.reduceBy };
      triggers.push({
        id: idBase,
        sourceContent,
        name: decl.name,
        on: [effect.triggerOn],
        scope: { selfOnly: true },
        grants: { type: 'damage.reduce', amount: `1${effect.reduceBy.dieFromResource}-die` },
        spendsResource: decl.spendsResource,
        description: decl.description,
        maneuverRider: rider
      });
      break;
    }
    case 'reaction-attack': {
      const rider: ManeuverRider = { damageRider: effect.damageRider };
      triggers.push({
        id: idBase,
        sourceContent,
        name: decl.name,
        on: [effect.triggerOn],
        scope: { selfOnly: true },
        grants: { type: 'reaction-weapon-attack' },
        spendsResource: decl.spendsResource,
        description: decl.description,
        maneuverRider: rider
      });
      break;
    }
    case 'ally-attack': {
      // Self-cost: bonus action on the user. Ally-cost: reaction on the
      // ally + an extra weapon attack with the rider added. v1 surfaces
      // via an OutboundEffect targeting an ally — the encounter layer
      // resolves the ally pick and ferries the reaction-attack grant.
      outboundEffects.push({
        id: idBase,
        sourceContent,
        name: decl.name,
        rangeFt: 5, // RAW: ally within 5 ft (typical; varies by table)
        targets: 'ally',
        excludeSelf: true,
        modifiers: [
          {
            kind: 'maneuver-ally-grant',
            grant: { type: 'reaction-weapon-attack' },
            damageRider: effect.damageRider,
            spendsResource: decl.spendsResource,
            sourceManeuver: decl.id
          }
        ]
      });
      const action: Action = {
        id: idBase,
        sourceContent,
        name: decl.name,
        type: 'maneuver-ally-attack',
        cost: effect.costOnSelf,
        targetMode: 'single',
        description: decl.description,
        spendsResource: decl.spendsResource,
        riderLabel: `Ally adds ${effect.damageRider.dieFromResource} die to ${effect.damageRider.type} damage`,
        appliedModifiers: []
      };
      actions.push(action);
      break;
    }
    case 'temp-hp-grant': {
      const rider: ManeuverRider = { tempHp: effect.tempHp };
      const action: Action = {
        id: idBase,
        sourceContent,
        name: decl.name,
        type: 'maneuver-buff',
        cost: effect.costOnSelf,
        targetMode: 'single',
        description: decl.description,
        spendsResource: decl.spendsResource,
        riderLabel: `temp HP = 1${effect.tempHp.dieFromResource}-die${
          effect.tempHp.addAbilityMod ? ` + ${effect.tempHp.addAbilityMod}` : ''
        }`,
        maneuverRider: rider,
        grants: { tempHp: `1d-die${effect.tempHp.addAbilityMod ? `+${effect.tempHp.addAbilityMod}` : ''}` },
        appliedModifiers: []
      };
      actions.push(action);
      break;
    }
    case 'target-free-move': {
      const rider: ManeuverRider = { freeMove: effect.distance };
      const action: Action = {
        id: idBase,
        sourceContent,
        name: decl.name,
        type: 'maneuver-ally-move',
        cost: maneuverCostToActionCost(decl.cost),
        targetMode: 'single',
        description: decl.description,
        spendsResource: decl.spendsResource,
        gatedOnTrigger: 'attack.hit',
        riderLabel:
          effect.distance === 'half-ally-speed'
            ? 'Ally moves up to half their speed without provoking opportunity attacks'
            : `Ally moves up to ${(effect.distance as { feet: number }).feet} ft without provoking opportunity attacks`,
        maneuverRider: rider,
        appliedModifiers: []
      };
      actions.push(action);
      break;
    }
    default: {
      // Forward-compat: unknown effect kinds emit a soft validation note
      // so pack authors get feedback. The discriminant is exhaustive
      // today, so this branch is reachable only via authoring drift.
      args.validations.push({
        severity: 'warning',
        code: 'unknown-maneuver-effect-kind',
        message: `Maneuver '${decl.id}' has unknown effect.kind on ${sourceContent.kind}/${sourceContent.slug}.`
      });
      break;
    }
  }

  // Suppress the unused-import note for ManeuverSaveEffect — the type is
  // exported via re-export below; this branch keeps the symbol visible to
  // tsc when the union grows.
  void (null as unknown as ManeuverSaveEffect | null);
}
