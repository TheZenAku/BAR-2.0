import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from './password.ts';
import { hashToken, newToken } from './tokens.ts';

describe('password hashing (Argon2id)', () => {
  it('produces salted PHC strings with the configured parameters', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct');
    expect(needsRehash(a)).toBe(false);
  });

  it('verifies the right password only (Unicode exact, no normalization surprises)', async () => {
    const hash = await hashPassword('pässwörd 123');
    await expect(verifyPassword(hash, 'pässwörd 123')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'passwörd 123')).resolves.toBe(false);
    await expect(verifyPassword(hash, 'pässwörd 123 ')).resolves.toBe(false);
  });

  it('treats malformed or tampered hashes as a mismatch and flags them for rehash', async () => {
    for (const bad of [
      '',
      'plain',
      '$argon2i$v=19$m=19456,t=2,p=1$AAAA$BBBB',
      '$argon2id$v=19$m=999999,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ]) {
      await expect(verifyPassword(bad, 'x')).resolves.toBe(false);
      expect(needsRehash(bad)).toBe(true);
    }
    expect(
      needsRehash('$argon2id$v=19$m=4096,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    ).toBe(true);
  });

  it('dummy verification always fails and costs a real derivation', async () => {
    const t0 = performance.now();
    await expect(verifyAgainstDummy('anything')).resolves.toBe(false);
    const t1 = performance.now();
    await verifyAgainstDummy('anything');
    expect(performance.now() - t1).toBeGreaterThan(1); // not short-circuited
    expect(t1 - t0).toBeGreaterThan(1);
  });
});

describe('opaque tokens', () => {
  it('are 256-bit base64url and hash to 32 bytes deterministically', () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toHaveLength(32);
    expect(hashToken(t).equals(hashToken(t))).toBe(true);
  });
});
