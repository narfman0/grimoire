// Test re-export: real character data lives in $lib/fixtures/party/ so both
// the test suite and the sheet preview pages can share it.

import type { ContentLookup, ContentRow } from '../../types';

export { CHARACTER } from '$lib/fixtures/party/tortle-chronurgy-wizard';

export function makeLookup(packs: Map<string, ContentRow>): ContentLookup {
  return (ref) => packs.get(`${ref.kind}/${ref.slug}`);
}
