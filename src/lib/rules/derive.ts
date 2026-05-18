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
  Resource,
  SkillCell,
  StatBlock,
  TriggerDeclaration,
  ValidationIssue
} from './types';
import { ABILITIES } from './types';

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
  for (const c of character.conditions) {
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
    if (a.row.kind === 'feat') {
      const featRef = character.feats.find((f) => f.slug === a.row.slug);
      const decl = a.data.choices as
        | {
            asi?: { bonus?: number; allowedAbilities?: string[] };
            skillProficiency?: { allowedSkills?: string[] };
            expertise?: { allowedSkills?: string[] | 'proficient' };
          }
        | undefined;
      const picks = (featRef?.choices as
        | {
            asi?: { ability?: string };
            skillProficiency?: { skill?: string };
            expertise?: { skill?: string };
          }
        | undefined) ?? {};
      if (decl?.asi && picks.asi?.ability) {
        const allowed = decl.asi.allowedAbilities ?? ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        if (allowed.includes(picks.asi.ability)) {
          allMods.push({
            id: `feat/${a.row.slug}/asi`,
            kind: 'stat-modifier',
            source: a,
            raw: {
              kind: 'stat-modifier',
              target: `ability.${picks.asi.ability}`,
              mode: 'ADD',
              value: decl.asi.bonus ?? 1
            }
          });
        }
      }
      if (decl?.skillProficiency && picks.skillProficiency?.skill) {
        const allowed = decl.skillProficiency.allowedSkills;
        if (!allowed || allowed.includes(picks.skillProficiency.skill)) {
          allMods.push({
            id: `feat/${a.row.slug}/skill-prof`,
            kind: 'stat-modifier',
            source: a,
            raw: {
              kind: 'stat-modifier',
              target: `proficiency.skill.${picks.skillProficiency.skill}`,
              mode: 'OVERRIDE',
              value: true
            }
          });
        }
      }
      if (decl?.expertise && picks.expertise?.skill) {
        // 'proficient' = restrict to skills the character is already
        // proficient in. We don't have the resolved skill set yet at this
        // point in derive, so we let the UI enforce it; the engine just
        // applies the expertise flag and Phase 2 reads it.
        const allowed = decl.expertise.allowedSkills;
        const allowedOk =
          allowed === 'proficient' || !allowed || (Array.isArray(allowed) && allowed.includes(picks.expertise.skill));
        if (allowedOk) {
          allMods.push({
            id: `feat/${a.row.slug}/expertise`,
            kind: 'stat-modifier',
            source: a,
            raw: {
              kind: 'stat-modifier',
              target: `expertise.skill.${picks.expertise.skill}`,
              mode: 'OVERRIDE',
              value: true
            }
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // PHASE 2 — compose stat block
  // -------------------------------------------------------------------------

  const classLevels: Record<string, number> = {};
  for (const c of character.classes) classLevels[c.slug] = c.level;

  const ctx = {
    totalLevel,
    proficiencyBonus,
    rageDamage: rageDamageFor(character, proficiencyBonus),
    classLevels
  };

  // (a) Ability scores
  const abilities: Record<AbilityKey, AbilityCell> = {} as Record<AbilityKey, AbilityCell>;
  for (const ab of ABILITIES) {
    const target = `ability.${ab}`;
    const score = applyTarget(allMods, character, target, character.abilityScores[ab], ctx);
    abilities[ab] = { score: typeof score === 'number' ? score : character.abilityScores[ab], mod: 0 };
  }
  for (const ab of ABILITIES) abilities[ab].mod = abilityModifier(abilities[ab].score);

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

  // (e) Saves — proficient = ability appears in any class's `saves`
  const saveProficiencies = new Set<AbilityKey>();
  for (const c of character.classes) {
    const classRow = content({ kind: 'class', slug: c.slug });
    if (!classRow) continue;
    const saves = (classRow.data.saves as AbilityKey[] | undefined) ?? [];
    for (const s of saves) saveProficiencies.add(s);
  }
  const saves: Record<AbilityKey, { bonus: number; proficient: boolean }> = {} as Record<
    AbilityKey,
    { bonus: number; proficient: boolean }
  >;
  for (const ab of ABILITIES) {
    const proficient = saveProficiencies.has(ab);
    const base = abilities[ab].mod + (proficient ? proficiencyBonus : 0);
    const bonus = applyTarget(allMods, character, `save.${ab}`, base, ctx) as number;
    saves[ab] = { bonus, proficient };
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

  // (h) Resistances/immunities/vulnerabilities
  const resistances = new Set<string>();
  const immunities = new Set<string>();
  const vulnerabilities = new Set<string>();
  for (const m of allMods) {
    if (m.kind !== 'stat-modifier') continue;
    const target = m.raw.target as string;
    if (!target) continue;
    if (target.startsWith('resistance.') && m.raw.value === true)
      resistances.add(target.slice('resistance.'.length));
    if (target.startsWith('immunity.') && m.raw.value === true)
      immunities.add(target.slice('immunity.'.length));
    if (target.startsWith('vulnerability.') && m.raw.value === true)
      vulnerabilities.add(target.slice('vulnerability.'.length));
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
    saves: saves as Record<AbilityKey, { bonus: number; proficient: boolean }> as StatBlock['saves'],
    skills,
    ac,
    hp: { current: character.currentHp, max: hpMax, temp: character.tempHp },
    speeds,
    proficiencyBonus,
    initiative: abilities.dex.mod,
    passivePerception: 10 + skills.perception.bonus,
    spellSaveDC: spellInfo.dc,
    spellAttackBonus: spellInfo.attack,
    spellcastingAbility: spellInfo.ability,
    spellSlots: spellInfo.slots,
    totalLevel,
    resistances,
    immunities,
    vulnerabilities,
    senses
  };

  // -------------------------------------------------------------------------
  // PHASE 3 — assemble activities (as concrete Actions)
  // -------------------------------------------------------------------------

  const actions: Action[] = [];
  for (const a of active) {
    const activities = (a.data.activities as Array<Record<string, unknown>> | undefined) ?? [];
    for (const act of activities) {
      const action = realizeActivity(act, a, character, stats, content);
      if (action) actions.push(action);
    }
  }

  // -------------------------------------------------------------------------
  // PHASE 4 — apply action modifiers
  // -------------------------------------------------------------------------

  for (const action of actions) {
    const actionCtx = buildActionContext(action);
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
      action.appliedModifiers.push({
        modifierId: m.id,
        sourceContent: { kind: m.source.row.kind, slug: m.source.row.slug },
        name: (m.raw.name as string | undefined) ?? m.id
      });
    }
  }

  // -------------------------------------------------------------------------
  // PHASE 5 — register triggers
  // -------------------------------------------------------------------------

  const triggers: TriggerDeclaration[] = [];
  for (const m of allMods) {
    if (m.kind !== 'trigger') continue;
    triggers.push({
      id: m.id,
      sourceContent: { kind: m.source.row.kind, slug: m.source.row.slug },
      name: (m.raw.name as string | undefined) ?? m.id,
      on: ((m.raw.on as string[] | undefined) ?? []).slice(),
      scope: m.raw.scope,
      grants: m.raw.grants,
      limit: m.raw.limit as { per: string; uses: number } | undefined
    });
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
      const limit = t.limit as { per?: string; uses?: number } | undefined;
      if (!limit?.per || !limit.uses) continue;
      const id = `trigger/${a.row.slug}/${(t.id as string) ?? 'unnamed'}`;
      resources.push({
        id,
        name: (t.name as string | undefined) ?? (t.id as string) ?? id,
        max: limit.uses,
        used: Math.min(limit.uses, spent[id] ?? 0),
        per: limit.per,
        sourceContent: { kind: a.row.kind, slug: a.row.slug }
      });
    }
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

  return { stats, actions, triggers, resources, validations, toggles };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classLevelFor(character: CharacterDocument, slug: string): number {
  return character.classes.find((c) => c.slug === slug)?.level ?? 0;
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
  // Find a caster class on the character
  for (const c of character.classes) {
    const row = content({ kind: 'class', slug: c.slug });
    if (!row) continue;
    const sc = row.data.spellcasting as
      | { ability: AbilityKey; progression: string }
      | null;
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
    case 'pact':
      return pactCasterSlots(level);
    default:
      return {};
  }
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
  _content: ContentLookup
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
          damage?: Array<{ dice: string; type: string }>;
        }
      | undefined;
    if (attack) {
      const ability = resolveAttackAbility(attack, source, stats);
      const mod = stats.abilities[ability].mod;
      const proficient = computeAttackProficiency(attack, source, character);
      action.attackBonus = mod + (proficient ? stats.proficiencyBonus : 0);
      action.attackAbility = ability;
      action.attackRange = attack.range;
      action.weaponProperties = (source.data.properties as string[] | undefined) ?? [];
      if (attack.damage) {
        action.damageRolls = attack.damage.map((d) => ({
          formula: addAbilityToFormula(d.dice, mod),
          type: d.type
        }));
      } else {
        // 5etools shape: damage lives at act.damage.parts as a sibling of
        // act.attack, not inline. Pull from there too. Ability mod typically
        // isn't added to cantrip damage, so we copy `dice` straight through;
        // weapon-style spells with the mod still go through the inline path.
        const parts = (act.damage as { parts?: Array<{ dice: string; type: string }> } | undefined)?.parts;
        if (parts) {
          action.damageRolls = parts.map((d) => ({ formula: d.dice, type: d.type }));
        }
      }
    }
  } else if (type === 'save') {
    const save = act.save as { ability: string; dc?: { calc?: string; value?: number } } | undefined;
    if (save) {
      const value =
        save.dc?.calc === 'spell' ? (stats.spellSaveDC ?? 8) : (save.dc?.value ?? 8);
      action.saveDC = { ability: save.ability, value };
      const damage = (act.damage as { parts?: Array<{ dice: string; type: string }> } | undefined)?.parts;
      if (damage) {
        action.damageRolls = damage.map((d) => ({ formula: d.dice, type: d.type }));
      }
    }
  } else if (type === 'damage') {
    const damage = (act.damage as { parts?: Array<{ dice: string; type: string }> } | undefined)?.parts;
    if (damage) {
      action.damageRolls = damage.map((d) => ({ formula: d.dice, type: d.type }));
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
  character: CharacterDocument
): boolean {
  if (attack.classification === 'spell') return true; // spell attack uses spellcasting prof
  // Weapon proficiency: assume proficient if the character's class(es) cover this weapon type.
  // v0 shortcut: most martial/simple distinctions in fixtures will trust the assignment.
  const weaponType = source.data.weaponType as string | undefined;
  // Best-effort: simple-* always; martial-* if any class proficiency includes 'martial'.
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

function buildActionContext(action: Action): PredicateContext {
  return {
    activityType: action.type,
    attack: {
      range: action.attackRange,
      ability: action.attackAbility
    },
    weapon: {
      property: action.weaponProperties ?? [],
      proficient: action.attackBonus != null // crude v0 proxy
    }
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
