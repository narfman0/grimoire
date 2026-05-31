/** Lower-case, hyphenate, strip non-[a-z0-9-]. The single slug convention
 *  used everywhere: feature-content lookups (mapping 5etools display names
 *  like "Divine Fury" to "divine-fury") AND human-readable URL slugs for
 *  characters/campaigns. Pure (no I/O) so it lives in the rules engine; the
 *  server's collision-suffixing layer (src/lib/server/slug.ts) builds on it. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
