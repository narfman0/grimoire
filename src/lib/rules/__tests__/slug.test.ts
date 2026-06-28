import { describe, it, expect } from 'vitest';
import { slugify } from '../slug';

// slugify is the single slug convention shared by feature-content lookups
// (e.g. "Divine Fury" -> "divine-fury") and human-readable character/campaign
// URLs. Lock its shape so the URL layer and the engine never diverge.
describe('slugify', () => {
  it('lower-cases and hyphenates spaces', () => {
    expect(slugify('Grog The Mighty')).toBe('grog-the-mighty');
  });

  it('collapses runs of non-alphanumerics to a single hyphen', () => {
    expect(slugify("Vox  Machina!! -- 2")).toBe('vox-machina-2');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('  --Strahd--  ')).toBe('strahd');
  });

  it('maps 5etools display names to engine slugs', () => {
    expect(slugify('Divine Fury')).toBe('divine-fury');
  });

  it('returns an empty string for names with no alphanumerics', () => {
    // Caller (allocate*Slug) supplies a fallback token; slugify stays pure.
    expect(slugify('🐢🐢🐢')).toBe('');
    expect(slugify('---')).toBe('');
  });

  it('drops non-ASCII letters (no transliteration)', () => {
    expect(slugify('Café del Mar')).toBe('caf-del-mar');
  });
});
