import { createHash, randomBytes } from 'node:crypto';

/** 32 bytes = 256 bits of entropy, encoded as base64url (43 characters). */
const REFRESH_TOKEN_BYTES = 32;

export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/** Only the SHA-256 hash is stored; the raw token exists only in the cookie (§6.4). */
export function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
