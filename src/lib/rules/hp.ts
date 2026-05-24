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

/** Form HP bucket — see `applyFormDamage`. The form's HP pool is
 *  independent of the base character's HP. Damage flows through the
 *  form's pool first; overflow on a 0-HP form cascades to the base
 *  PC's stack (which still routes through tempHp → overlayHp →
 *  currentHp per `applyDamageDelta`). */
export interface FormHpState {
  current: number;
  max: number;
}

/** Result of `applyFormDamage`: the new form-HP bucket, the new base
 *  HP state (with overflow damage applied if the form dropped to 0),
 *  and the overflow amount that cascaded — useful for UI attribution
 *  ("Greenscale absorbed 5, you took the remaining 3"). */
export interface ApplyFormDamageResult<T extends HpState> {
  form: FormHpState;
  base: T;
  overflowToBase: number;
}

/** Damage routing for a polymorphed character. Absorption order is
 *  tempHp → overlayHp → formHp → base currentHp (the first three
 *  belong to the base HP stack; only base HP catches the cascade when
 *  form HP runs out).
 *
 *  Rationale: temp HP / overlay HP are conceptually "external" buffers
 *  the PC carries with them into the form (Heroism temp HP doesn't
 *  vanish when you Wild Shape mid-cast). Form HP is the form's own
 *  body. When the form's body is destroyed, the leftover hit lands on
 *  the PC's own meat. RAW Wild Shape: when the form drops, "any
 *  excess damage carries over to your normal form." */
export function applyFormDamage<T extends HpState>(
  baseState: T,
  formHp: FormHpState,
  amount: number
): ApplyFormDamageResult<T> {
  const n = Math.max(0, Math.floor(amount));
  // Step 1: drain tempHp and overlayHp via the same math as the
  // base-only path. We use a synthetic intermediate state with
  // currentHp = null so the base currentHp is preserved here; the
  // form's HP takes the next bite.
  const buffered = applyDamageDelta(
    { ...baseState, currentHp: null } as T,
    n
  );
  // Reconstruct: the amount that *would have* hit currentHp on the
  // base-only path is exactly (n - tempHpAbsorbed - overlayAbsorbed).
  const tempAbsorbed = (baseState.tempHp ?? 0) - (buffered.tempHp ?? 0);
  const overlayAbsorbed =
    baseState.overlayHp !== undefined && buffered.overlayHp !== undefined
      ? baseState.overlayHp - buffered.overlayHp
      : 0;
  let remaining = n - tempAbsorbed - overlayAbsorbed;

  // Step 2: form HP absorbs next. Overflow cascades to base.
  const formAbsorbed = Math.min(formHp.current, remaining);
  remaining -= formAbsorbed;
  const nextForm: FormHpState = {
    current: formHp.current - formAbsorbed,
    max: formHp.max
  };

  // Step 3: any leftover lands on the base PC's currentHp (floored at 0).
  const overflowToBase = remaining;
  const baseCurrent =
    baseState.currentHp == null
      ? null
      : Math.max(0, baseState.currentHp - overflowToBase);
  const nextBase: T = {
    ...buffered,
    currentHp: baseCurrent
  } as T;
  return { form: nextForm, base: nextBase, overflowToBase };
}
