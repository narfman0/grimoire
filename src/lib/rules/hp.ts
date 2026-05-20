// Pure HP math shared by the encounter channel (non-PC participants), the
// encounter DM controls (PC + non-PC fallback paths), and the character
// sheet. Centralizing keeps the "temp HP absorbs first, never below 0,
// capped at maxHp on heal" rules in one place.

export interface HpState {
  currentHp: number | null;
  tempHp: number;
}

/** Apply damage with temp-HP-absorbs-first. Current HP never drops below 0;
 *  null currentHp passes through unchanged. `amount` is clamped to a
 *  non-negative integer, so callers don't need to pre-floor user input. */
export function applyDamageDelta<T extends HpState>(state: T, amount: number): T {
  const n = Math.max(0, Math.floor(amount));
  const temp = state.tempHp ?? 0;
  const tempAbsorbed = Math.min(temp, n);
  const remaining = n - tempAbsorbed;
  return {
    ...state,
    currentHp: state.currentHp == null ? null : Math.max(0, state.currentHp - remaining),
    tempHp: temp - tempAbsorbed
  };
}

/** Apply healing, capped at maxHp when provided. Temp HP is unaffected.
 *  Null currentHp passes through unchanged. */
export function applyHealDelta<T extends HpState>(
  state: T,
  amount: number,
  maxHp: number | null
): T {
  const n = Math.max(0, Math.floor(amount));
  return {
    ...state,
    currentHp:
      state.currentHp == null
        ? null
        : maxHp != null
          ? Math.min(maxHp, state.currentHp + n)
          : state.currentHp + n
  };
}
