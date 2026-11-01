// Character-document diff for the session log. Pure and isomorphic.
//
// `diffCharacterDocs(before, after)` returns structured changes for the
// fields the table cares about and ignores everything else (toggles, the
// per-round action economy, favourites, plans …), so a sheet that PATCHes on
// every click doesn't flood the log. `describeChange` turns one change into
// the line stored on the row; it takes a name resolver because the doc holds
// slugs and ids, and resolving them needs the content lookup the server has.

type Doc = Record<string, unknown>;

export type RestKind = 'short-rest' | 'long-rest';

export type CharacterChange =
  | {
      kind: 'hp';
      before: { currentHp: number; tempHp: number };
      after: { currentHp: number; tempHp: number };
    }
  | { kind: 'condition'; added: string[]; removed: string[] }
  | {
      kind: 'death-save';
      before: { successes: number; failures: number };
      after: { successes: number; failures: number };
    }
  | { kind: 'concentration'; before: string | null; after: string | null }
  | { kind: 'spell-slot'; level: number; delta: number }
  | { kind: 'resource'; id: string; delta: number }
  | { kind: 'activation'; id: string; before: number | null; after: number | null }
  | { kind: 'hit-dice'; classSlug: string; delta: number }
  | { kind: 'inventory'; added: ItemKey[]; removed: ItemKey[] }
  | { kind: 'charges'; item: ItemKey; before: number; after: number }
  | { kind: 'level'; classSlug: string; before: number; after: number };

export interface ItemKey {
  kind: string;
  slug: string;
  authorUserId: string | null;
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function concentration(v: unknown): string | null {
  const label = rec(v).label;
  return typeof label === 'string' ? label : null;
}

function deathSaves(v: unknown) {
  const r = rec(v);
  return { successes: num(r.successes), failures: num(r.failures) };
}

interface Slot {
  key: ItemKey;
  charges: number | null;
}

function slots(v: unknown): Slot[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => {
    const r = rec(s);
    return {
      key: {
        kind: typeof r.contentKind === 'string' ? r.contentKind : 'item',
        slug: typeof r.contentSlug === 'string' ? r.contentSlug : '?',
        authorUserId: typeof r.authorUserId === 'string' ? r.authorUserId : null
      },
      charges: typeof r.charges === 'number' ? r.charges : null
    };
  });
}

const itemId = (k: ItemKey) => `${k.kind}/${k.slug}/${k.authorUserId ?? ''}`;

/** Multiset difference of inventory slots by item identity. Positional
 *  matching would misreport a reorder as "removed X, added X". */
function inventoryChanges(before: Slot[], after: Slot[]): CharacterChange[] {
  const out: CharacterChange[] = [];
  const pool = new Map<string, Slot[]>();
  for (const s of before) {
    const id = itemId(s.key);
    pool.set(id, [...(pool.get(id) ?? []), s]);
  }
  const added: ItemKey[] = [];
  for (const s of after) {
    const id = itemId(s.key);
    const candidates = pool.get(id);
    if (candidates && candidates.length > 0) {
      const prev = candidates.shift() as Slot;
      if (prev.charges != null && s.charges != null && prev.charges !== s.charges) {
        out.push({ kind: 'charges', item: s.key, before: prev.charges, after: s.charges });
      }
    } else {
      added.push(s.key);
    }
  }
  const removed = [...pool.values()].flat().map((s) => s.key);
  if (added.length > 0 || removed.length > 0) out.unshift({ kind: 'inventory', added, removed });
  return out;
}

export function diffCharacterDocs(before: Doc | null, after: Doc | null): CharacterChange[] {
  // A brand-new sheet (or a deleted document) isn't a stream of changes.
  if (!before || !after) return [];
  const out: CharacterChange[] = [];

  const hpBefore = { currentHp: num(before.currentHp), tempHp: num(before.tempHp) };
  const hpAfter = { currentHp: num(after.currentHp), tempHp: num(after.tempHp) };
  if (hpBefore.currentHp !== hpAfter.currentHp || hpBefore.tempHp !== hpAfter.tempHp) {
    out.push({ kind: 'hp', before: hpBefore, after: hpAfter });
  }

  const cb = new Set(strs(before.conditions));
  const ca = new Set(strs(after.conditions));
  const added = [...ca].filter((c) => !cb.has(c));
  const removed = [...cb].filter((c) => !ca.has(c));
  if (added.length > 0 || removed.length > 0) out.push({ kind: 'condition', added, removed });

  const dsb = deathSaves(before.deathSaves);
  const dsa = deathSaves(after.deathSaves);
  if (dsb.successes !== dsa.successes || dsb.failures !== dsa.failures) {
    out.push({ kind: 'death-save', before: dsb, after: dsa });
  }

  const conB = concentration(before.concentrating);
  const conA = concentration(after.concentrating);
  if (conB !== conA) out.push({ kind: 'concentration', before: conB, after: conA });

  // resourcesSpent: spell slots use `spell-slot/L<n>`; everything else is a
  // class / item resource pool id. Spent counters go UP on use.
  const rb = rec(before.resourcesSpent);
  const ra = rec(after.resourcesSpent);
  for (const key of new Set([...Object.keys(rb), ...Object.keys(ra)])) {
    const delta = num(ra[key]) - num(rb[key]);
    if (delta === 0) continue;
    const m = /^spell-slot\/L(\d)$/.exec(key);
    if (m) out.push({ kind: 'spell-slot', level: Number(m[1]), delta });
    else out.push({ kind: 'resource', id: key, delta });
  }

  // Activations with use counters (Rage and friends).
  const ab = rec(before.activations);
  const aa = rec(after.activations);
  for (const id of new Set([...Object.keys(ab), ...Object.keys(aa)])) {
    const u0 = rec(ab[id]).usesRemaining;
    const u1 = rec(aa[id]).usesRemaining;
    const b = typeof u0 === 'number' ? u0 : null;
    const a = typeof u1 === 'number' ? u1 : null;
    if (b !== a && (b !== null || a !== null)) out.push({ kind: 'activation', id, before: b, after: a });
  }

  const hb = rec(before.hitDiceSpent);
  const ha = rec(after.hitDiceSpent);
  for (const cls of new Set([...Object.keys(hb), ...Object.keys(ha)])) {
    const delta = num(ha[cls]) - num(hb[cls]);
    if (delta !== 0) out.push({ kind: 'hit-dice', classSlug: cls, delta });
  }

  out.push(...inventoryChanges(slots(before.inventory), slots(after.inventory)));

  const lv = (d: Doc) => {
    const m = new Map<string, number>();
    if (Array.isArray(d.classes)) {
      for (const c of d.classes) {
        const r = rec(c);
        if (typeof r.slug === 'string') m.set(r.slug, num(r.level));
      }
    }
    return m;
  };
  const lb = lv(before);
  const la = lv(after);
  for (const slug of new Set([...lb.keys(), ...la.keys()])) {
    const b = lb.get(slug) ?? 0;
    const a = la.get(slug) ?? 0;
    if (a !== b) out.push({ kind: 'level', classSlug: slug, before: b, after: a });
  }

  return out;
}

export interface NameResolver {
  resource(id: string): string;
  activation(id: string): string;
  item(key: ItemKey): string;
  className(slug: string): string;
}

/** Fallback names straight from ids/slugs, for when content isn't loaded. */
export const SLUG_NAMES: NameResolver = {
  resource: (id) => humanize(id),
  activation: (id) => humanize(id),
  item: (k) => humanize(k.slug),
  className: (s) => humanize(s)
};

function humanize(s: string): string {
  const last = s.split('/').pop() ?? s;
  return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ord = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** The log line for one change, prefixed with the character's name. */
export function describeChange(who: string, c: CharacterChange, names: NameResolver): string {
  switch (c.kind) {
    case 'hp': {
      const d = c.after.currentHp - c.before.currentHp;
      const parts: string[] = [];
      if (d !== 0) {
        parts.push(
          `${d < 0 ? 'took' : 'regained'} ${Math.abs(d)} HP (${c.before.currentHp} → ${c.after.currentHp})`
        );
      }
      if (c.after.tempHp !== c.before.tempHp) {
        parts.push(`temp HP ${c.before.tempHp} → ${c.after.tempHp}`);
      }
      return `${who} ${parts.join(', ')}`;
    }
    case 'condition': {
      const parts: string[] = [];
      if (c.added.length) parts.push(`is now ${c.added.join(', ')}`);
      if (c.removed.length) parts.push(`no longer ${c.removed.join(', ')}`);
      return `${who} ${parts.join('; ')}`;
    }
    case 'death-save':
      return `${who} death saves: ${plural(c.after.successes, 'success', 'successes')}, ${plural(c.after.failures, 'failure')}`;
    case 'concentration':
      return c.after
        ? `${who} is concentrating on ${c.after}`
        : `${who} stopped concentrating${c.before ? ` on ${c.before}` : ''}`;
    case 'spell-slot':
      return c.delta > 0
        ? `${who} used ${plural(c.delta, `${ord(c.level)}-level spell slot`)}`
        : `${who} regained ${plural(-c.delta, `${ord(c.level)}-level spell slot`)}`;
    case 'resource':
      return c.delta > 0
        ? `${who} used ${names.resource(c.id)}${c.delta > 1 ? ` ×${c.delta}` : ''}`
        : `${who} regained ${names.resource(c.id)}${c.delta < -1 ? ` ×${-c.delta}` : ''}`;
    case 'activation': {
      const n = names.activation(c.id);
      if (c.before != null && c.after != null && c.after < c.before) {
        return `${who} used ${n} (${c.after} left)`;
      }
      return `${who}: ${n} uses ${c.before ?? '—'} → ${c.after ?? '—'}`;
    }
    case 'hit-dice':
      return c.delta > 0
        ? `${who} spent ${plural(c.delta, `${names.className(c.classSlug)} hit die`, `${names.className(c.classSlug)} hit dice`)}`
        : `${who} recovered ${plural(-c.delta, `${names.className(c.classSlug)} hit die`, `${names.className(c.classSlug)} hit dice`)}`;
    case 'inventory': {
      const parts: string[] = [];
      if (c.added.length) parts.push(`gained ${c.added.map(names.item).join(', ')}`);
      if (c.removed.length) parts.push(`lost ${c.removed.map(names.item).join(', ')}`);
      return `${who} ${parts.join('; ')}`;
    }
    case 'charges':
      return `${who}: ${names.item(c.item)} charges ${c.before} → ${c.after}`;
    case 'level':
      return c.before === 0
        ? `${who} took a level in ${names.className(c.classSlug)} (${c.after})`
        : `${who}: ${names.className(c.classSlug)} ${c.before} → ${c.after}`;
  }
}

/** Log `kind` column for a change. Charges and inventory share a kind (the
 *  filter vocabulary is the table's, not the diff's). */
export function logKindOf(c: CharacterChange): string {
  switch (c.kind) {
    case 'charges':
      return 'inventory';
    case 'activation':
    case 'hit-dice':
      return 'resource';
    default:
      return c.kind;
  }
}

/** Does this change need content names to describe? (Skip the lookup when
 *  a write only moved HP — the common case mid-fight.) */
export function needsNames(c: CharacterChange): boolean {
  return ['resource', 'activation', 'hit-dice', 'inventory', 'charges', 'level'].includes(c.kind);
}
