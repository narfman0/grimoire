import type {
  AbilityKey,
  Action,
  SaveCell,
  SkillCell,
  StatBlock,
  ToolCheckCell
} from '$lib/rules/types';
import type { D20Options, PoolOptions } from './types';

// derive() → roll options. This is the *one* place that knows which engine
// flag maps to which dice behaviour.
//
// Why it earns its own file: before this, roughly 35 roll-time flags were
// computed, tested and documented by the engine and consumed by nothing —
// `critThreshold`, `damageDieMin`, `damageRerollAndKeepHigher`,
// `deathSaveAdvantage`, `hitDiceMaximized`, `initiativeAdvantage` and the rest
// had zero references outside src/lib/rules/. Wiring them component-by-
// component would have scattered the same mapping across five call sites and
// let them drift. Components call these adapters and stay dumb.
//
// Types only from $lib/rules — `import type` is erased at build, so nothing
// here couples the dice module to the engine at runtime. (The reverse
// direction is forbidden outright: purity.test.ts fails any import that
// escapes src/lib/rules/.)

/** Skill check — activates SkillCell.advantage / disadvantage / bonusDice /
 *  d20Floor, the four flags that until now rendered as inert chips on the
 *  sheet. */
export function d20OptionsForSkill(cell: SkillCell, stats?: StatBlock): D20Options {
  return {
    advantage: cell.advantage,
    disadvantage: cell.disadvantage,
    ...(cell.bonusDice?.length ? { bonusDice: cell.bonusDice } : {}),
    // The skill cell already folds in `check.d20Floor`; stats is accepted for
    // symmetry with the other adapters and as a fallback for callers holding
    // a hand-built cell.
    ...(cell.d20Floor != null
      ? { d20Floor: cell.d20Floor }
      : stats?.checkD20Floor != null
        ? { d20Floor: stats.checkD20Floor }
        : {})
  };
}

/** Whether this check fails regardless of the roll. Deliberately *not* folded
 *  into D20Options: RAW says the check fails, which is not the same as rolling
 *  at disadvantage, and the caller has to render it differently. */
export function skillAutoFails(cell: SkillCell): boolean {
  return cell.autoFail === true;
}

/** Saving throw. The floor lives on the stat block (`save.d20Floor`), not the
 *  cell. */
export function d20OptionsForSave(cell: SaveCell, stats?: StatBlock): D20Options {
  return {
    advantage: cell.advantage,
    disadvantage: cell.disadvantage,
    ...(stats?.saveD20Floor != null ? { d20Floor: stats.saveD20Floor } : {})
  };
}

/** Raw (non-skill) ability check. `abilityCheckAdvantage` uses 'both' to mean
 *  both were granted — passing both through lets rollD20 apply the RAW
 *  cancellation in one place rather than re-deriving it here. */
export function d20OptionsForAbilityCheck(ability: AbilityKey, stats: StatBlock): D20Options {
  const state = stats.abilityCheckAdvantage?.[ability];
  const bonusDice = stats.abilityCheckBonusDice?.[ability];
  return {
    advantage: state === 'advantage' || state === 'both',
    disadvantage: state === 'disadvantage' || state === 'both',
    ...(bonusDice?.length ? { bonusDice } : {}),
    ...(stats.checkD20Floor != null ? { d20Floor: stats.checkD20Floor } : {})
  };
}

/** Whether a raw ability check auto-fails. See skillAutoFails. */
export function abilityCheckAutoFails(ability: AbilityKey, stats: StatBlock): boolean {
  return stats.abilityCheckAutoFail?.[ability] === true;
}

/** Tool check. A tool check *is* an ability check, so the check-wide floor
 *  applies; tools have no fixed governing ability, so there's no numeric
 *  bonus to fold in — the caller supplies the modifier. */
export function d20OptionsForToolCheck(cell: ToolCheckCell, stats?: StatBlock): D20Options {
  return {
    advantage: cell.advantage,
    disadvantage: cell.disadvantage,
    ...(cell.bonusDice?.length ? { bonusDice: cell.bonusDice } : {}),
    ...(stats?.checkD20Floor != null ? { d20Floor: stats.checkD20Floor } : {})
  };
}

/** Initiative. Activates `initiativeAdvantage`, which the encounter's NPC
 *  auto-roll has been computing and ignoring. */
export function d20OptionsForInitiative(stats: StatBlock): D20Options {
  return { advantage: stats.initiativeAdvantage === true };
}

/** Death saving throw. Crit/fumble stay at the default 20/1 — a natural 20 on
 *  a death save regains 1 HP and a natural 1 costs two failures, and no
 *  feature moves those thresholds. */
export function d20OptionsForDeathSave(stats: StatBlock): D20Options {
  return { advantage: stats.deathSaveAdvantage === true };
}

/** Attack roll. Carries the crit threshold so the result classifies itself
 *  (Champion's Improved Critical at 19, Superior Critical at 18). */
export function d20OptionsForAttack(action: Pick<Action, 'critThreshold'>): D20Options {
  return {
    ...(action.critThreshold != null ? { critThreshold: action.critThreshold } : {})
  };
}

/** Context that decides which of an action's conditional damage flags apply. */
export interface DamageContext {
  /** The attack crit — double the dice and add any crit extra die. */
  crit?: boolean;
  /** The target is an object, enabling the `*VsObjects` variants (sword of
   *  sharpness, Tearulai). */
  vsObject?: boolean;
}

/** Damage roll. This is where the action-level flags finally do work. */
export function poolOptionsForDamage(
  action: Pick<
    Action,
    | 'damageDieMin'
    | 'damageMaximized'
    | 'damageMaximizedVsObjects'
    | 'damageDiceDoubled'
    | 'damageDiceDoubledVsObjects'
    | 'damageRerollAndKeepHigher'
    | 'critExtraDie'
  >,
  ctx: DamageContext = {}
): PoolOptions {
  const maximize =
    action.damageMaximized === true ||
    (ctx.vsObject === true && action.damageMaximizedVsObjects === true);

  const doubleDice =
    ctx.crit === true ||
    action.damageDiceDoubled === true ||
    (ctx.vsObject === true && action.damageDiceDoubledVsObjects === true);

  return {
    ...(action.damageDieMin != null ? { dieMin: action.damageDieMin } : {}),
    ...(maximize ? { maximize: true } : {}),
    ...(doubleDice ? { doubleDice: true } : {}),
    ...(action.damageRerollAndKeepHigher === true ? { rerollAndKeepHigher: true } : {}),
    // Savage Attacks adds its die *on a crit only*, and rollPool appends it
    // after doubling so the crit doesn't double it as well.
    ...(ctx.crit === true && action.critExtraDie ? { extraDice: action.critExtraDie } : {})
  };
}

/** Healing roll (Supreme Healing, Circle of Mortality). */
export function poolOptionsForHealing(action: Pick<Action, 'healMaximized'>): PoolOptions {
  return action.healMaximized === true ? { maximize: true } : {};
}

/** Hit dice spent on a short rest. Activates `hitDiceMaximized` (periapt of
 *  wound closure) — the sheet currently awards the average and never rolls. */
export function poolOptionsForHitDice(stats: StatBlock): PoolOptions {
  return stats.hitDiceMaximized === true ? { maximize: true } : {};
}
