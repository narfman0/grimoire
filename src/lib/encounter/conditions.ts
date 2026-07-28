// Helpers for the encounter page's condition + concentration plumbing.
// PCs round-trip the character document via REST; non-PCs flow through
// the participant HP/conditions REST + SSE. Pulled out of +page.svelte
// so the detail-panel component split can take these as a clean API.

export interface ParticipantLite {
  id: string;
  kind: string;
  conditions: string[];
}

/** Live condition list. PCs source from the SSR-mirrored character document;
 *  non-PCs source from the SSE snapshot, falling back to the SSR seed. */
export function conditionsForParticipant(
  p: ParticipantLite,
  pcConditions: Record<string, string[]> | undefined,
  liveConditions: string[] | undefined
): string[] {
  if (p.kind === 'pc') return pcConditions?.[p.id] ?? [];
  return liveConditions ?? p.conditions;
}

/** Toggle a value's presence in an array. Returns a new array; preserves
 *  order of the existing entries and appends new ones at the end. */
export function toggleArrayValue<T>(arr: readonly T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

/** Read the current character document, splice `fields` onto it, and PATCH
 *  it back. The single write path for PC-document mutations made from the
 *  encounter surface (conditions, concentration, action economy) — one
 *  read-modify-write instead of N, so a multi-field update can't tear.
 *  Returns ok. */
export async function patchCharacterDocFields(
  characterId: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  try {
    const res = await fetch(`/api/characters/${characterId}`);
    if (!res.ok) return false;
    const char = (await res.json()) as { document: Record<string, unknown> | null };
    const doc = { ...(char.document ?? {}), ...fields };
    const patch = await fetch(`/api/characters/${characterId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document: doc })
    });
    return patch.ok;
  } catch {
    return false;
  }
}

/** Single-field convenience over `patchCharacterDocFields`. Used for PC
 *  condition + concentration updates. */
export function patchCharacterDocField(
  characterId: string,
  field: string,
  value: unknown
): Promise<boolean> {
  return patchCharacterDocFields(characterId, { [field]: value });
}

/** Optimistic PC mutation: flip the local mirror, PATCH the document, revert
 *  on failure. Centralizes the three-step pattern shared by toggleCondition,
 *  startConcentrating, and clearConcentrating. */
export async function patchPcWithMirror<T>(opts: {
  characterId: string;
  field: string;
  next: T;
  prev: T;
  setLocal: (value: T) => void;
}): Promise<boolean> {
  opts.setLocal(opts.next);
  const ok = await patchCharacterDocField(opts.characterId, opts.field, opts.next);
  if (!ok) opts.setLocal(opts.prev);
  return ok;
}
