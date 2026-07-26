// Sets aren't JSON-serializable; before shipping a Derived over the wire
// (or handing it to components that expect plain arrays) the three
// resistance-style Sets are swapped for arrays. This is the client-safe
// copy of the swap; the server keeps its own identical `serializeDerived`
// in $lib/server/content/lookup.ts (that module pulls in db code and can't
// be imported client-side).
import type { Derived } from './types';

export function serializeDerivedClient(d: Derived) {
  return {
    ...d,
    stats: {
      ...d.stats,
      resistances: [...d.stats.resistances],
      immunities: [...d.stats.immunities],
      vulnerabilities: [...d.stats.vulnerabilities]
    }
  };
}

export type SerializedDerived = ReturnType<typeof serializeDerivedClient>;
