// Mode application for stat modifiers. Mirrors Foundry's Active Effect modes:
// ADD/MULTIPLY/OVERRIDE/UPGRADE/DOWNGRADE/CUSTOM. Default priority is
// `mode * 10` per ACTIVE_EFFECT_MODES — ascending priority applies first.

export type Mode = 'CUSTOM' | 'MULTIPLY' | 'ADD' | 'DOWNGRADE' | 'UPGRADE' | 'OVERRIDE';

const PRIORITY: Record<Mode, number> = {
  CUSTOM: 0,
  MULTIPLY: 10,
  ADD: 20,
  DOWNGRADE: 30,
  UPGRADE: 40,
  OVERRIDE: 50
};

export function defaultPriority(mode: Mode): number {
  return PRIORITY[mode] ?? 20;
}

/** Numeric mode application. Returns `current` unchanged for boolean/non-numeric. */
export function applyNumericMode(current: number, mode: Mode, value: number): number {
  switch (mode) {
    case 'ADD':
      return current + value;
    case 'MULTIPLY':
      return current * value;
    case 'UPGRADE':
      return Math.max(current, value);
    case 'DOWNGRADE':
      return Math.min(current, value);
    case 'OVERRIDE':
      return value;
    case 'CUSTOM':
      return current; // no hooks in v0
  }
}
