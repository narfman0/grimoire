// Allowlist of `source` slugs the public `/api/content` endpoints expose.
// Non-public packs (loaded via $GRIMOIRE_PACKS_DIR) have rows with sources
// outside this set, and stay campaign-private.
//
// When license/attribution metadata returns (deferred per docs/pack-loader.md),
// this becomes a `SourceMetadata` map keyed by slug.

export const PUBLIC_SOURCES = new Set(['srd-5.2', 'srd-5.1']);
