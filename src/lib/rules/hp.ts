// Pure HP math shared by the encounter channel (non-PC participants), the
// encounter DM controls (PC + non-PC fallback paths), and the character
// sheet. Centralizing keeps the "temp HP absorbs first, never below 0,
// capped at maxHp on heal" rules in one place.

export interface HpState {
  currentHp: number | null;
  tempHp: number;
  /** Aggregate overlay-HP pool current value (sum across all the
   *  character's Derived.overlayHpPools). Absorbs damage after tempHp
   *  but before currentHp. Optional — encounter runtime supplies it
   *  when the character has at least one overlay pool. Per-pool
   *  bookkeeping is the runtime's responsibility; this field is the
   *  aggregate the damage math reads from. */
  overlayHp?: number;
}

/** Apply damage. Absorption order: tempHp → overlayHp → currentHp.
 *  Current HP never drops below 0; null currentHp passes through
 *  unchanged. `amount` is clamped to a non-negative integer, so callers
 *  don't need to pre-floor user input. */
export function applyDamageDelta<T extends HpState>(state: T, amount: number): T {
  const n = Math.max(0, Math.floor(amount));
  const temp = state.tempHp ?? 0;
  const tempAbsorbed = Math.min(temp, n);
  let remaining = n - tempAbsorbed;
  const overlay = state.overlayHp ?? 0;
  const overlayAbsorbed = Math.min(overlay, remaining);
  remaining -= overlayAbsorbed;
  const next: T = {
    ...state,
    currentHp: state.currentHp == null ? null : Math.max(0, state.currentHp - remaining),
    tempHp: temp - tempAbsorbed
  };
  if (state.overlayHp !== undefined) {
    next.overlayHp = overlay - overlayAbsorbed;
  }
  return next;
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
