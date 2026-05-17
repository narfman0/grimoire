// Crockford-ish base32 minus visually-ambiguous chars (0/O/1/I/L).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateCampaignCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
