import { describe, it, expect } from 'vitest';
import { generateCampaignCode } from '../code';

const ALPHABET_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/;

describe('generateCampaignCode', () => {
  it('defaults to 6 characters', () => {
    expect(generateCampaignCode()).toHaveLength(6);
  });

  it('honors the length argument', () => {
    expect(generateCampaignCode(4)).toHaveLength(4);
    expect(generateCampaignCode(10)).toHaveLength(10);
  });

  // Locks the Crockford-minus-ambiguous alphabet. A regression that adds
  // 0 / O / 1 / I / L back in would make typed codes ambiguous.
  it('uses only unambiguous base32 characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCampaignCode();
      expect(code).toMatch(ALPHABET_RE);
    }
  });

  it('produces different codes across calls (random)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) codes.add(generateCampaignCode());
    // 100 calls of 6-char codes from 31 symbols → collision is astronomically
    // unlikely. If this ever fires we have a real bug.
    expect(codes.size).toBeGreaterThan(95);
  });
});
