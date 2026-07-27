// DM resolve/amend orchestration helpers, extracted from the encounter page
// so the HP+log mutation paths can be unit-tested and shared between the
// resolve and amend flows (which used to duplicate ~30 lines of HP math each).

import type { ConnectedEncounter, ParticipantHp } from './encounter-channel';

export type HitOutcome =
  | ''
  | 'hit'
  | 'miss'
  | 'crit'
  | 'fumble'
  | 'heal'
  | 'saved'
  | 'failed-save';

/** Outcomes that cause an HP change on the target. Pure attack misses /
 *  fumbles never touch HP. `saved` halves damage; everything else is full. */
const HP_OUTCOMES: ReadonlySet<HitOutcome> = new Set<HitOutcome>([
  'hit',
  'crit',
  'heal',
  'saved',
  'failed-save'
]);

/** Saves are half damage (rounded down); everything else is full. */
export function effectiveDamage(outcome: HitOutcome, damage: number): number {
  return outcome === 'saved' ? Math.floor(damage / 2) : damage;
}

/** Critical hits against a crit-immune target (adamantine armor —
 *  `stats.incomingCritImmune`) become normal hits: the log entry reads
 *  'hit' and `attack.crit` reaction triggers don't fire. The damage number
 *  stays whatever the DM entered — dropping the extra crit dice is part of
 *  the downgrade they're being told about. Every other outcome passes
 *  through unchanged. */
export function downgradeCritForTarget(
  outcome: HitOutcome,
  targetCritImmune: boolean
): HitOutcome {
  return outcome === 'crit' && targetCritImmune ? 'hit' : outcome;
}

/** Reaction-trigger events that fire from a given attack/save outcome. */
export function firedEventsFor(outcome: HitOutcome): string[] {
  const events: string[] = [];
  if (outcome === 'hit') events.push('attack.hit');
  if (outcome === 'crit') {
    events.push('attack.hit');
    events.push('attack.crit');
  }
  if (outcome === 'failed-save') {
    events.push('spell.hit');
    events.push('save.failed');
  }
  return events;
}

export interface ResolveTarget {
  id: string;
  kind: string;
  maxHp: number | null;
  currentHp: number | null;
  tempHp: number;
  conditions: string[];
}

function seedFor(p: { currentHp: number | null; tempHp: number; conditions: string[] }): ParticipantHp {
  return { currentHp: p.currentHp, tempHp: p.tempHp ?? 0, conditions: p.conditions ?? [] };
}

export interface ApplyHpAndLogInput {
  conn: ConnectedEncounter;
  encounterId: string;
  actingParticipantId: string;
  target: ResolveTarget | null;
  outcome: HitOutcome;
  damage: number | null;
  attack: number | null;
  round: number;
  actionId: string;
  actionLabel: string;
  notes: string;
  /** If provided, use this snapshot as the starting HP instead of the static
   *  SSR seed. Required by amend, which re-reads HP after reverting the
   *  prior entry so the new damage starts from the corrected baseline. */
  liveSeed?: ParticipantHp | null;
  amendsLogId?: string | null;
}

export interface ApplyHpAndLogResult {
  ok: boolean;
  status: number;
  errorText: string | null;
  targetHpBefore: number | null;
  targetHpAfter: number | null;
}

/** Apply HP delta on a non-PC target via the participant HP API
 *  (PCs route through the character document elsewhere) and post one combat-log entry. */
export async function applyHpAndLog(input: ApplyHpAndLogInput): Promise<ApplyHpAndLogResult> {
  const {
    conn,
    encounterId,
    actingParticipantId,
    target,
    outcome,
    damage,
    attack,
    round,
    actionId,
    actionLabel,
    notes,
    liveSeed,
    amendsLogId
  } = input;

  let targetHpBefore: number | null = null;
  let targetHpAfter: number | null = null;
  if (
    target &&
    target.kind !== 'pc' &&
    typeof damage === 'number' &&
    damage > 0 &&
    HP_OUTCOMES.has(outcome)
  ) {
    const seed: ParticipantHp = liveSeed ?? seedFor(target);
    targetHpBefore = seed.currentHp;
    const effective = effectiveDamage(outcome, damage);
    let next = seed;
    if (effective > 0 || outcome === 'heal') {
      next =
        outcome === 'heal'
          ? conn.applyHeal(target.id, damage, target.maxHp, seed)
          : conn.applyDamage(target.id, effective, seed);
    }
    targetHpAfter = next.currentHp;
  }

  // New entries POST to /log; amendments PATCH the existing row directly
  // (no more append-an-amendment-row pattern — see encounter-schemas.ts).
  const isAmend = !!amendsLogId;
  const url = isAmend
    ? `/api/encounters/${encounterId}/log/${amendsLogId}`
    : `/api/encounters/${encounterId}/log`;
  const body: Record<string, unknown> = isAmend
    ? {
        targetParticipantId: target?.id ?? null,
        actionLabel,
        attackRoll: attack,
        damageRoll: damage,
        hit: outcome || null,
        targetHpBefore,
        targetHpAfter,
        notes: notes.slice(0, 500) || null
      }
    : {
        participantId: actingParticipantId,
        targetParticipantId: target?.id ?? null,
        actionId,
        actionLabel,
        round,
        attackRoll: attack,
        damageRoll: damage,
        hit: outcome || null,
        targetHpBefore,
        targetHpAfter,
        notes: notes.slice(0, 500) || null
      };

  const res = await fetch(url, {
    method: isAmend ? 'PATCH' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const errorText = res.ok ? null : (await res.text().catch(() => '')).slice(0, 200);
  return { ok: res.ok, status: res.status, errorText, targetHpBefore, targetHpAfter };
}

/** Revert the HP change from a prior log entry by applying the inverse delta
 *  to the *current* live HP — preserves any unrelated damage that landed
 *  between the original and the amendment. No-op for PC targets (their HP
 *  lives on the character document). */
export function revertPriorHpChange(
  conn: ConnectedEncounter,
  prior: {
    targetParticipantId: string | null;
    targetHpBefore: number | null;
    targetHpAfter: number | null;
  },
  target: ResolveTarget | null
): void {
  if (!target || target.kind === 'pc') return;
  if (!prior.targetParticipantId || prior.targetHpBefore == null || prior.targetHpAfter == null) {
    return;
  }
  const delta = prior.targetHpBefore - prior.targetHpAfter;
  if (delta === 0) return;
  const seed = seedFor(target);
  if (delta > 0) conn.applyHeal(target.id, delta, target.maxHp, seed);
  else conn.applyDamage(target.id, -delta, seed);
}

export interface ReactionTrigger {
  id: string;
  name: string;
  on: string[];
  /** Structured grant payload from the TriggerDeclaration — carried
   *  through so the prompt UI can render its one-line summary
   *  ($lib/rules/grant-summary). */
  grants?: { type: string; [k: string]: unknown };
}

export interface ReactionPrompt {
  participantId: string;
  participantName: string;
  triggerId: string;
  triggerName: string;
  /** The matched trigger's grants, verbatim (see ReactionTrigger.grants). */
  grants?: { type: string; [k: string]: unknown };
}

/** Build reaction prompts for PCs whose triggers intersect the fired events,
 *  skipping any PC that's already burned their reaction this round. One
 *  prompt per participant per resolution. */
export function reactionPromptsForResolution(input: {
  firedEvents: string[];
  participants: Array<{ id: string; name: string; kind: string }>;
  triggersByParticipantId: Record<string, ReactionTrigger[]>;
  reactionUsedByParticipantId: Record<string, boolean>;
}): ReactionPrompt[] {
  if (input.firedEvents.length === 0) return [];
  const prompts: ReactionPrompt[] = [];
  for (const p of input.participants) {
    if (p.kind !== 'pc') continue;
    if (input.reactionUsedByParticipantId[p.id]) continue;
    const triggers = input.triggersByParticipantId[p.id] ?? [];
    for (const t of triggers) {
      if (t.on.some((ev) => input.firedEvents.includes(ev))) {
        prompts.push({
          participantId: p.id,
          participantName: p.name,
          triggerId: t.id,
          triggerName: t.name,
          ...(t.grants ? { grants: t.grants } : {})
        });
        break;
      }
    }
  }
  return prompts;
}
