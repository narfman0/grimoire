// Allowlist of `source` slugs the public `/api/content` endpoints expose.
// User-imported homebrew (via POST /api/homebrew/import) has rows with
// sources outside this set, and stays scoped to the owning user.
//
// When license/attribution metadata returns (deferred per
// docs/content-distribution.md), this becomes a `SourceMetadata` map keyed
// by slug.

export const PUBLIC_SOURCES = new Set(['srd-5.2', 'srd-5.1']);
