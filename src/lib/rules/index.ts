export { derive } from './derive';
export { applyUpcast, upcastStepsAt } from './upcast';
export {
  toggleActivation,
  refreshActivations,
  applyAutoCancelOnStateChange,
  pickRestVariant,
  type ToggleActivationOpts,
  type ToggleActivationResult,
  type ToggleOutcome
} from './activations';
export {
  matchesDamageSource,
  predicateToQualifierString,
  predicateFromQualifierString,
  type DamageSourcePredicate,
  type DamageSourceContext
} from './damage-source';
export {
  spendResource,
  refreshResourcesOnRest,
  type SpendResourceResult
} from './class-resources';
export type * from './types';
