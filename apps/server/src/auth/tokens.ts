import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random bearer secret (base64url, 43 chars). Shown to the client once; only its hash is stored. */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** SHA-256 is sufficient (no salt/stretching) because tokens are high-entropy random values, not passwords. */
export const hashToken = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();
