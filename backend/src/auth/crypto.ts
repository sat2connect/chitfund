import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

const scryptAsync = (password: string, salt: Buffer, keylen: number, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keylen, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** OWASP-recommended scrypt cost by default; tests may lower it. Parameters are stored in the hash so they can be raised later. */
export type ScryptCost = { n: number; r: number; p: number };
export const DEFAULT_SCRYPT: ScryptCost = { n: 2 ** 15, r: 8, p: 1 };

export async function hashPassword(password: string, cost: ScryptCost = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, cost.n, cost.r, cost.p);
  return `scrypt$${cost.n}$${cost.r}$${cost.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Used for unknown users so a login attempt takes the same time whether or not the account exists. */
let dummy: Promise<string> | undefined;
export const dummyHash = (cost: ScryptCost = DEFAULT_SCRYPT) => (dummy ??= hashPassword('not-a-real-password', cost));

/** AES-256-GCM for secrets stored in the database (TOTP seeds). The key lives in the environment, not the database. */
export const encryptSecret = (plain: string, key: Buffer): string => {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
};

export const decryptSecret = (stored: string, key: Buffer): string => {
  const [v, iv, tag, ct] = stored.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
};

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no look-alikes (I, L, O, U, 0, 1)
/** Human-friendly one-time code, e.g. K7M2P-9XQ4T-HB3RV. Shown once; only its hash is stored. */
export const newOneTimeCode = (groups = 3, size = 5): string =>
  Array.from({ length: groups }, () => Array.from(randomBytes(size), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')).join('-');
export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
