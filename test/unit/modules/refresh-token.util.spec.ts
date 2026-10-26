import {
  generateRefreshToken,
  hashRefreshToken,
} from '../../../src/modules/auth/refresh-token.util';

describe('refresh token utilities', () => {
  it('generates 256 bits of base64url entropy', () => {
    const token = generateRefreshToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates a different token every time', () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });

  it('hashes deterministically as 64 hex chars and never returns the raw token', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
  });
});
