// Dice evaluator. Pure and isomorphic; randomness is injected, never reached
// for. See docs/proposals/dice-roller.md for why this lives outside
// src/lib/rules/ (derive() must stay deterministic, and purity.test.ts now
// enforces that it never imports from here).

export { parseDice, averageOf, formatExpr } from './parse';
export { rollPool, rollD20 } from './roll';
export { defaultRng, mulberry32, faceRng } from './rng';
export type {
  Rng,
  DiceTerm,
  DiceExpr,
  RolledDie,
  RollResult,
  D20Options,
  PoolOptions
} from './types';

// derive() → roll options. Types only from $lib/rules, erased at build.
export {
  d20OptionsForSkill,
  d20OptionsForSave,
  d20OptionsForAbilityCheck,
  d20OptionsForToolCheck,
  d20OptionsForInitiative,
  d20OptionsForDeathSave,
  d20OptionsForAttack,
  poolOptionsForDamage,
  poolOptionsForHealing,
  poolOptionsForHitDice,
  skillAutoFails,
  abilityCheckAutoFails
} from './from-derived';
export type { DamageContext } from './from-derived';
export type { SkillRollInput, SaveRollInput, ToolRollInput, StatsRollInput } from './from-derived';
