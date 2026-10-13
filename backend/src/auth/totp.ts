import { createHmac, randomBytes } from 'node:crypto';

/** RFC 4648 base32, as used by authenticator apps. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32Encode = (buf: Buffer): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

export const base32Decode = (s: string): Buffer => {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

export const newTotpSecret = () => base32Encode(randomBytes(20));
export const STEP_SECONDS = 30;

/** RFC 6238 time-based one-time password (HMAC-SHA1, 6 digits by default). */
export function totp(secretBase32: string, atMs: number, digits = 6): string {
  return hotp(base32Decode(secretBase32), Math.floor(atMs / 1000 / STEP_SECONDS), digits);
}

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * Checks a code against the current step and one step either side (clock drift).
 * Returns the matched step, or null. A step at or before `lastUsedStep` is refused so a code cannot be replayed.
 */
export function verifyTotp(secretBase32: string, code: string, atMs: number, lastUsedStep?: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretBase32);
  const current = Math.floor(atMs / 1000 / STEP_SECONDS);
  for (const step of [current, current - 1, current + 1]) {
    if (lastUsedStep != null && step <= lastUsedStep) continue;
    if (hotp(key, step) === code) return step;
  }
  return null;
}

export const otpauthUri = (issuer: string, account: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
