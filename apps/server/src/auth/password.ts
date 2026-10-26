import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

// Argon2id via Node's built-in implementation (no native addon). Parameters: OWASP Password Storage Cheat Sheet
// minimum (m = 19 MiB, t = 2, p = 1). Hashes are stored in PHC string format, so parameters can be raised later:
// `needsRehash` flags old hashes and login transparently upgrades them.
export const ARGON2_PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;
const VERSION = 19;

type Params = { memory: number; passes: number; parallelism: number; tagLength: number };

const b64 = (buf: Buffer): string => buf.toString('base64').replace(/=+$/, '');

function derive(password: string, salt: Buffer, p: Params): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, ...p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, ARGON2_PARAMS);
  const { memory: m, passes: t, parallelism: p } = ARGON2_PARAMS;
  return `$argon2id$v=${VERSION}$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(key)}`;
}

const PHC_RE = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function parse(hash: string): { params: Params; salt: Buffer; key: Buffer } | undefined {
  const m = PHC_RE.exec(hash);
  if (!m) return undefined;
  const key = Buffer.from(m[5]!, 'base64');
  const params = { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]), tagLength: key.length };
  // Bounds guard against a tampered row turning verification into a resource-exhaustion vector.
  if (params.memory > 262_144 || params.passes > 10 || params.parallelism > 8 || key.length < 16) return undefined;
  return { params, salt: Buffer.from(m[4]!, 'base64'), key };
}

/** Constant-time comparison. Returns false (never throws) for malformed hashes. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parsed = parse(hash);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.params);
  return timingSafeEqual(key, parsed.key);
}

export function needsRehash(hash: string): boolean {
  const p = parse(hash)?.params;
  return (
    p === undefined ||
    p.memory !== ARGON2_PARAMS.memory ||
    p.passes !== ARGON2_PARAMS.passes ||
    p.parallelism !== ARGON2_PARAMS.parallelism ||
    p.tagLength !== ARGON2_PARAMS.tagLength
  );
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies against a throwaway hash so that "unknown account" costs the same as "wrong password"
 * (prevents account enumeration by response time). Always resolves to false.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
  return false;
}
