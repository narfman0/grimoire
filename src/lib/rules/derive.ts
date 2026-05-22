// Orchestrator for the rules engine. Six phases per docs/rules-engine.md:
//   1. resolve active content
//   2. compose stat block
//   3. assemble activities
//   4. apply action modifiers
//   5. register triggers
//   6. validate
//
// Pure function. No I/O, no clock, no random.

import { abilityModifier, evaluateValue, proficiencyBonusFor, rageDamageFor, type EvalContext } from './evaluate';
import { applyNumericMode, defaultPriority, type Mode } from './modes';
import { predicateMatches, type PredicateContext } from './predicates';
import { SKILLS, SKILL_ABILITY } from './skills';
import type {
  AbilityCell,
  AbilityKey,
  Action,
  AppliedModifier,
  AvailableToggle,
  CharacterDocument,
  ContentLookup,
  ContentRef,
  ContentRow,
  Derived,
  OutboundEffect,
  Resource,
  SaveCell,
  SkillCell,
  StatBlock,
  TriggerDeclaration,
  ValidationIssue
} from './types';
import { ABILITIES, KNOWN_TRIGGER_EVENTS } from './types';

interface ActiveContent {
  ref: ContentRef;
  row: ContentRow;
  data: Record<string, unknown>;
}

interface ActiveModifier {
  id: string; // for action modifiers; auto-generated for stat modifiers
  kind: 'stat-modifier' | 'action-modifier' | 'trigger';
  source: ActiveContent;
  raw: Record<string, unknown>;
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
    value: true
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
    value: true
  },
  {
    declKey: 'language',
    idSuffix: 'language',
    pickField: 'language',
    allowedField: 'allowedLanguages',
    targetPrefix: 'proficiency.language',
    mode: 'OVERRIDE',
    value: true
  },
  {
    declKey: 'toolProficiency',
    idSuffix: 'tool-prof',
    pickField: 'tool',
    allowedField: 'allowedTools',
    targetPrefix: 'proficiency.tool',
    mode: 'OVERRIDE',
    value: true
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

export function derive(character: CharacterDocument, content: ContentLookup): Derived {
  // -------------------------------------------------------------------------
  // PHASE 1 — resolve active content
  // -------------------------------------------------------------------------

  const totalLevel = character.classes.reduce((acc, c) => acc + c.level, 0);
  const proficiencyBonus = proficiencyBonusFor(totalLevel || 1);

  const refs: Array<{ ref: ContentRef; sourceKind: string }> = [];
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
  for (const slot of character.inventory) {
    if (!slot.equipped) continue;
    refs.push({
      ref: { kind: slot.contentKind, slug: slot.contentSlug, version: slot.version },
      sourceKind: 'item'
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
  for (const { ref } of refs) {
    const row = content(ref);
    if (!row) {
      validations.push({
        severity: 'warning',
        code: 'content-missing',
        message: `content not found: ${ref.kind}/${ref.slug}${ref.version ? '@v' + ref.version : ''}`
      });
      continue;
    }
    active.push({ ref, row, data: row.data });
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
      const slug = slugifyName(f.name);
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
    // Feature applicability: minLevel against owning class/species level.
    const data = row.data;
    const ownerKind = data.ownerKind as string | undefined;
    const ownerSlug = data.ownerSlug as string | undefined;
    const minLevel = (data.minLevel as number | undefined) ?? 1;
    if (ownerKind === 'class' && ownerSlug) {
      if (classLevelFor(character, ownerSlug) < minLevel) continue;
    }
    active.push({ ref: r, row, data });
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

  // Build raw modifier/activity/trigger lists from active content.
  const allMods: ActiveModifier[] = [];
  for (const a of active) {
    const mods = (a.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    for (let i = 0; i < mods.length; i++) {
      const m = mods[i];
      const kind = (m.kind as string) ?? 'stat-modifier';
      if (kind === 'stat-modifier') {
        allMods.push({
          id: `${a.row.kind}/${a.row.slug}/mod/${i}`,
          kind: 'stat-modifier',
          source: a,
          raw: m
        });
      } else if (kind === 'action-modifier') {
        allMods.push({
          id: (m.id as string) ?? `${a.row.kind}/${a.row.slug}/amod/${i}`,
          kind: 'action-modifier',
          source: a,
          raw: m
        });
      }
    }
    const triggers = (a.data.triggers as Array<Record<string, unknown>> | undefined) ?? [];
    for (let i = 0; i < triggers.length; i++) {
      const t = triggers[i];
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
        const value = typeof spec.value === 'function' ? spec.value(declEntry) : spec.value;
        allMods.push({
          id: `${a.row.kind}/${a.row.slug}/${spec.idSuffix}`,
          kind: 'stat-modifier',
          source: a,
          raw: {
            kind: 'stat-modifier',
            target: `${spec.targetPrefix}.${pick}`,
            mode: spec.mode,
            value
          }
        });
      }
      // Feature-pick: any content kind with choices.feature defers loading of
      // the chosen sub-feature (e.g. Giant Ancestry picking an ancestry type).
      const featureDecl = decl.feature as { allowedFeatures?: string[] } | undefined;
      const featurePick = (picks.feature as { feature?: string } | undefined)?.feature;
      if (featureDecl && featurePick) {
        if (!featureDecl.allowedFeatures || featureDecl.allowedFeatures.includes(featurePick)) {
          deferredRefs.push({ kind: 'feature', slug: featurePick });
        }
      }
    }
    if (a.row.kind === 'feat') {
      const featRef = character.feats.find((f) => f.slug === a.row.slug);
      const decl = (a.data.choices ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const picks = (featRef?.choices ?? {}) as Record<string, Record<string, unknown> | undefined>;
      // Spell + feature picks add new content refs to the active list (not
      // modifiers). Queued here, resolved alongside the feature-ref walk
      // below so their modifiers/activities/triggers feed back into derive.
      const spellDecl = decl.spell as { allowedSpells?: string[] } | undefined;
      const spellPick = picks.spell as { spells?: string[] } | undefined;
      if (spellDecl && Array.isArray(spellPick?.spells)) {
        for (const slug of spellPick.spells) {
          if (spellDecl.allowedSpells && !spellDecl.allowedSpells.includes(slug)) continue;
          deferredRefs.push({ kind: 'spell', slug });
        }
      }
      const featureDecl = decl.feature as { allowedFeatures?: string[] } | undefined;
      const featurePick = (picks.feature as { feature?: string } | undefined)?.feature;
      if (featureDecl && featurePick) {
        if (!featureDecl.allowedFeatures || featureDecl.allowedFeatures.includes(featurePick)) {
          deferredRefs.push({ kind: 'feature', slug: featurePick });
        }
      }

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
      const m = mods[i];
      const kind = (m.kind as string) ?? 'stat-modifier';
      if (kind === 'stat-modifier') {
        allMods.push({ id: `${row.kind}/${row.slug}/mod/${i}`, kind: 'stat-modifier', source: entry, raw: m });
      } else if (kind === 'action-modifier') {
        allMods.push({
          id: (m.id as string) ?? `${row.kind}/${row.slug}/amod/${i}`,
          kind: 'action-modifier',
          source: entry,
          raw: m
        });
      }
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
    conditionStacks: character.conditionStacks ?? {}
  };

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
  ctx.walkSpeed = speeds.walk ?? 0;

  // (e) Saves — proficient = ability appears in any class's `saves`, OR a
  // content modifier targets `proficiency.save.<ability>` (feat/feature
  // grants like Resilient flow through here).
  const saveProficiencies = new Set<AbilityKey>();
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
        m.target.startsWith('proficiency.save.') &&
        m.value === true
      ) {
        saveProficiencies.add(m.target.slice('proficiency.save.'.length) as AbilityKey);
      }
    }
  }
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const target = m.raw.target;
    if (typeof target !== 'string' || m.raw.value !== true) continue;
    if (target.startsWith('proficiency.save.')) {
      saveProficiencies.add(target.slice('proficiency.save.'.length) as AbilityKey);
    }
  }
  // Collect save advantage/disadvantage state. Targets:
  //   save.advantage.<ab>         — unconditional per-ability advantage
  //   save.disadvantage.<ab>      — same, disadvantage
  //   save.advantage.all          — every save has advantage
  //   save.advantage.vs-condition.<slug>  — every save vs <slug> has advantage
  //   save.disadvantage.vs-condition.<slug>
  const saveAdvantage = new Set<AbilityKey>();
  const saveDisadvantage = new Set<AbilityKey>();
  const savesAdvantageVs = new Set<string>();
  const savesDisadvantageVs = new Set<string>();
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const target = m.raw.target;
    if (typeof target !== 'string' || m.raw.value !== true) continue;
    if (target === 'save.advantage.all') for (const ab of ABILITIES) saveAdvantage.add(ab);
    else if (target === 'save.disadvantage.all') for (const ab of ABILITIES) saveDisadvantage.add(ab);
    else if (target.startsWith('save.advantage.vs-condition.'))
      savesAdvantageVs.add(target.slice('save.advantage.vs-condition.'.length));
    else if (target.startsWith('save.disadvantage.vs-condition.'))
      savesDisadvantageVs.add(target.slice('save.disadvantage.vs-condition.'.length));
    else if (target.startsWith('save.advantage.')) {
      const ab = target.slice('save.advantage.'.length) as AbilityKey;
      if ((ABILITIES as readonly string[]).includes(ab)) saveAdvantage.add(ab);
    } else if (target.startsWith('save.disadvantage.')) {
      const ab = target.slice('save.disadvantage.'.length) as AbilityKey;
      if ((ABILITIES as readonly string[]).includes(ab)) saveDisadvantage.add(ab);
    }
  }
  const saves: Record<AbilityKey, SaveCell> = {} as Record<AbilityKey, SaveCell>;
  for (const ab of ABILITIES) {
    const proficient = saveProficiencies.has(ab);
    const base = abilities[ab].mod + (proficient ? proficiencyBonus : 0);
    const bonus = applyTarget(allMods, character, `save.${ab}`, base, ctx) as number;
    saves[ab] = {
      bonus,
      proficient,
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
  const skills: Record<string, SkillCell> = {};
  for (const skill of SKILLS) {
    const ability = SKILL_ABILITY[skill];
    const proficient = skillProficiencies.has(skill);
    const expertise = skillExpertise.has(skill);
    const base =
      abilities[ability].mod +
      (proficient ? proficiencyBonus : 0) +
      (expertise && proficient ? proficiencyBonus : 0);
    const bonus = applyTarget(allMods, character, `skill.${skill}`, base, ctx) as number;
    skills[skill] = { bonus, ability, proficient, expertise };
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
  const unconditional = {
    res: new Set<string>(),
    imm: new Set<string>(),
    vul: new Set<string>()
  };
  function recordQualified(
    set: Set<string>,
    quals: Record<string, string>,
    unc: Set<string>,
    type: string,
    qualifier: string | undefined
  ): void {
    set.add(type);
    if (qualifier === undefined) {
      unc.add(type);
      delete quals[type];
    } else if (!unc.has(type) && quals[type] === undefined) {
      quals[type] = qualifier;
    }
  }
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const target = m.raw.target as string;
    if (!target || m.raw.value !== true) continue;
    const qualifier =
      typeof m.raw.qualifier === 'string' ? (m.raw.qualifier as string) : undefined;
    if (target.startsWith('resistance.')) {
      recordQualified(
        resistances,
        resistanceQualifiers,
        unconditional.res,
        target.slice('resistance.'.length),
        qualifier
      );
    } else if (target.startsWith('immunity.')) {
      recordQualified(
        immunities,
        immunityQualifiers,
        unconditional.imm,
        target.slice('immunity.'.length),
        qualifier
      );
    } else if (target.startsWith('vulnerability.')) {
      recordQualified(
        vulnerabilities,
        vulnerabilityQualifiers,
        unconditional.vul,
        target.slice('vulnerability.'.length),
        qualifier
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
    passivePerception: 10 + skills.perception.bonus,
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
    senses,
    languages: [...languages].sort(),
    tools: [...tools].sort(),
    armorProficiencies: [...armorProficiencies].sort(),
    weaponProficiencies: [...weaponProficiencies].sort()
  };

  // -------------------------------------------------------------------------
  // PHASE 3 — assemble activities (as concrete Actions)
  // -------------------------------------------------------------------------

  // Character-wide crit defaults composed from modifier targets:
  //   crit.threshold        — natural roll required to crit (DOWNGRADE to 19/18)
  //   crit.extra-weapon-die — extra weapon dice on a crit (Savage Attacks)
  // These land on every weapon-attack action emitted below.
  const charCritThreshold = applyTarget(allMods, character, 'crit.threshold', 20, ctx);
  const charCritExtraDie = applyTarget(allMods, character, 'crit.extra-weapon-die', 0, ctx);

  const actions: Action[] = [];
  for (const a of active) {
    let activities = (a.data.activities as Array<Record<string, unknown>> | undefined) ?? [];
    if (activities.length === 0 && a.row.kind === 'item') {
      const synth = synthesizeWeaponActivity(a.row.slug, a.row.name, a.data);
      if (synth) activities = [synth];
    }
    for (const act of activities) {
      const action = realizeActivity(act, a, character, stats, content, ctx);
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
  }

  // Aggregate extraAttacks from active features and set attackCount on
  // main-hand weapon attack actions (type 'attack', cost 'action').
  // extraAttacks: 1 means one additional attack (2 total); stacking grants
  // from Fighter L11/L20 accumulate additively so attackCount = 1 + sum.
  let totalExtraAttacks = 0;
  for (const a of active) {
    const extra = a.data.extraAttacks as number | undefined;
    if (typeof extra === 'number' && extra > 0) {
      totalExtraAttacks += extra;
    }
  }
  if (totalExtraAttacks > 0) {
    for (const action of actions) {
      if (action.type === 'attack' && action.cost === 'action') {
        action.attackCount = 1 + totalExtraAttacks;
      }
    }
  }

  // -------------------------------------------------------------------------
  // PHASE 4 — apply action modifiers
  // -------------------------------------------------------------------------

  for (const action of actions) {
    const sourceRow = content(action.sourceContent);
    const actionCtx = buildActionContext(action, sourceRow?.data);
    for (const m of allMods) {
      if (m.kind !== 'action-modifier') continue;
      const enabled =
        character.modifierToggles[m.id] ?? (m.raw.defaultEnabled as boolean | undefined) ?? true;
      const appliesWhen = m.raw.appliesWhen as { condition?: string } | undefined;
      if (appliesWhen?.condition && !character.conditions.includes(appliesWhen.condition)) continue;
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

  // -------------------------------------------------------------------------
  // PHASE 5 — register triggers
  // -------------------------------------------------------------------------

  const triggers: TriggerDeclaration[] = [];
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
    triggers.push({
      id: m.id,
      sourceContent: { kind: m.source.row.kind, slug: m.source.row.slug },
      name: (m.raw.name as string | undefined) ?? m.id,
      on,
      scope: m.raw.scope,
      grants: m.raw.grants,
      limit: m.raw.limit as { per: string; uses: number } | undefined
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
      const grants = t.grants as { type?: string } | undefined;
      if (!grants?.type) continue;
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

  // -------------------------------------------------------------------------
  // PHASE 6 — validate (soft)
  // -------------------------------------------------------------------------

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
    const limit = Math.max(1, abilities[spellcasting.ability].mod + c.level);
    if (character.spells.prepared.length > limit) {
      validations.push({
        severity: 'warning',
        code: 'prepared-spells-over-limit',
        message: `${character.spells.prepared.length} prepared (limit ${limit})`
      });
    }
  }

  // -------------------------------------------------------------------------
  // Resources — collect activities with `uses` blocks
  // -------------------------------------------------------------------------

  const resources: Resource[] = [];
  const spent = character.resourcesSpent ?? {};
  for (const a of active) {
    const activities = (a.data.activities as Array<Record<string, unknown>> | undefined) ?? [];
    for (const act of activities) {
      const uses = act.uses as { max?: number | string | object; per?: string } | undefined;
      if (uses?.max == null || !uses.per) continue;
      const max = evaluateValue(uses.max, ctx);
      if (typeof max !== 'number' || max <= 0) continue;
      const id = `${a.row.kind}/${a.row.slug}/${act.id as string}`;
      const applies = act.appliesCondition;
      resources.push({
        id,
        name: (act.name as string | undefined) ?? (act.id as string),
        max,
        used: Math.min(max, spent[id] ?? 0),
        per: uses.per,
        sourceContent: { kind: a.row.kind, slug: a.row.slug },
        ...(typeof applies === 'string' ? { appliesCondition: applies } : {})
      });
    }
    // Triggers with a `limit` are functionally resources too — Relentless
    // Endurance "1/long rest", Chronal Shift "2/long rest", etc.
    const triggerList = (a.data.triggers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const t of triggerList) {
      const limit = t.limit as { per?: string; uses?: number | string | object } | undefined;
      if (!limit?.per || limit.uses == null) continue;
      const maxRaw = evaluateValue(limit.uses, ctx);
      const max = typeof maxRaw === 'number' ? maxRaw : 0;
      if (max <= 0) continue;
      const id = `trigger/${a.row.slug}/${(t.id as string) ?? 'unnamed'}`;
      resources.push({
        id,
        name: (t.name as string | undefined) ?? (t.id as string) ?? id,
        max,
        used: Math.min(max, spent[id] ?? 0),
        per: limit.per,
        sourceContent: { kind: a.row.kind, slug: a.row.slug }
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

  return {
    stats,
    actions,
    triggers,
    resources,
    validations,
    toggles,
    alwaysPreparedFromContent: [...alwaysPreparedFromContent].sort(),
    outboundEffects
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classLevelFor(character: CharacterDocument, slug: string): number {
  return character.classes.find((c) => c.slug === slug)?.level ?? 0;
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

/** Lower-case, hyphenate, strip non-[a-z0-9-] — matches the slug convention
 *  used in feature content rows. Used to map 5etools-imported display names
 *  ("Divine Fury") to the engine's slugged feature lookups ("divine-fury"). */
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function applyTarget(
  mods: ActiveModifier[],
  character: CharacterDocument,
  target: string,
  base: number,
  ctx: EvalContext
): number | unknown {
  const targeted = mods.filter(
    (m) => m.kind === 'stat-modifier' && (m.raw.target as string) === target
  );
  // Filter for active state: enabled toggles + appliesWhen condition checks
  const eligible = targeted.filter((m) => {
    const enabled =
      character.modifierToggles[m.id] ?? (m.raw.defaultEnabled as boolean | undefined) ?? true;
    if (!enabled) return false;
    const appliesWhen = m.raw.appliesWhen as { condition?: string } | undefined;
    if (appliesWhen?.condition && !character.conditions.includes(appliesWhen.condition)) return false;
    return true;
  });
  if (eligible.length === 0) return base;
  // Sort by priority ascending; numeric mode application chains.
  const sorted = eligible.slice().sort((a, b) => {
    const pa = (a.raw.priority as number | undefined) ?? defaultPriority((a.raw.mode as Mode) ?? 'ADD');
    const pb = (b.raw.priority as number | undefined) ?? defaultPriority((b.raw.mode as Mode) ?? 'ADD');
    return pa - pb;
  });
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

  // Apply ac modifiers (e.g., shield +2)
  if (shield) {
    const shieldMods = (shield.data.modifiers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const m of shieldMods) {
      if (m.kind === 'stat-modifier' && (m.target as string) === 'ac' && (m.mode as string) === 'ADD') {
        const value = evaluateValue(m.value, ctx);
        if (typeof value === 'number') base += value;
      }
    }
  }
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
  // Apply modifiers per speed key
  for (const key of Object.keys(speeds)) {
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
    if (appliesWhen?.condition && !character.conditions.includes(appliesWhen.condition)) return false;
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
      speeds[key] = val;
    }
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

  if (type === 'attack') {
    const attack = act.attack as
      | {
          ability?: string;
          classification?: 'weapon' | 'spell';
          range?: 'melee' | 'ranged';
          damage?: Array<{ dice: unknown; type: string }>;
        }
      | undefined;
    if (attack) {
      const ability = resolveAttackAbility(attack, source, stats);
      const mod = stats.abilities[ability].mod;
      const proficient = computeAttackProficiency(attack, source, character, stats);
      action.attackBonus = mod + (proficient ? stats.proficiencyBonus : 0);
      action.attackAbility = ability;
      action.attackRange = attack.range;
      action.weaponProperties = (source.data.properties as string[] | undefined) ?? [];
      if (attack.damage) {
        action.damageRolls = attack.damage.map((d) => {
          const formula = typeof d.dice === 'string' ? d.dice : String(evaluateValue(d.dice, ctx) ?? '');
          return { formula: addAbilityToFormula(formula, mod), type: d.type };
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
    const ref = act.spell as { slug: string; version?: number } | undefined;
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
    const ref = act.spell as { slug: string; version?: number } | undefined;
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
    case 'attack.no-disadvantage.within-5ft':
      if (rawValue === true) action.attackNoDisadvantageWithin5ft = true;
      break;
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
