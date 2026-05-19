import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../passwords';

describe('hashPassword + verifyPassword', () => {
  // Round-trip — the most important guarantee. A regression here makes
  // every login fail.
  it('verifyPassword(stored) returns true when password matches', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('verifyPassword returns false on a wrong password', async () => {
    const stored = await hashPassword('hunter2');
    expect(await verifyPassword('hunter3', stored)).toBe(false);
  });

  // Locks the "salt:hash" stored format. A regression that omits the salt
  // or swaps the separator silently breaks every existing user record.
  it('hashPassword returns a "{salt}:{hex}" string with valid lengths', async () => {
    const stored = await hashPassword('pw');
    const [salt, hex] = stored.split(':');
    expect(salt).toMatch(/^[0-9a-f]+$/);
    expect(hex).toMatch(/^[0-9a-f]+$/);
    // KEY_LEN = 64 bytes → 128 hex chars; SALT_LEN = 16 bytes → 32 hex chars.
    expect(hex.length).toBe(128);
    expect(salt.length).toBe(32);
  });

  // Different salts → different stored values for the same password.
  it('produces different stored strings for the same password (random salt)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    // But both still verify.
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  // Locks the malformed-input guards — a corrupt DB row must not crash
  // login.
  it('verifyPassword returns false on malformed stored strings', async () => {
    expect(await verifyPassword('pw', '')).toBe(false);
    expect(await verifyPassword('pw', 'nosaltseparator')).toBe(false);
    expect(await verifyPassword('pw', 'salt:notHex!')).toBe(false);
    expect(await verifyPassword('pw', 'salt:abcd')).toBe(false); // wrong length
  });
});
