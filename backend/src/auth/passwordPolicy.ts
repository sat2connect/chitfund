// A short list of the most common passwords. The length rule does most of the work; this blocks the obvious ones.
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'qwerty', 'qwertyuiop', 'letmein', 'welcome', 'admin', 'administrator', 'iloveyou', 'changeme',
  'abc123', '123456', '12345678', '123456789', '1234567890', 'chitfund', 'chitfund123', 'chitfund@123', 'welcome123', 'india123', 'tamilnadu', 'india@123',
]);

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Returns a list of problems; empty means acceptable. Length over complexity, in line with current NIST guidance. */
export function checkPassword(password: string, ctx: { username?: string; name?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters`);
  if (password.length > PASSWORD_MAX) problems.push(`Use at most ${PASSWORD_MAX} characters`);
  const lower = password.toLowerCase();
  const squashed = lower.replace(/[^a-z0-9]/g, '');
  if (COMMON.has(lower) || COMMON.has(squashed)) problems.push('This password is too common');
  if (/^(.)\1+$/.test(password)) problems.push('Do not repeat a single character');
  if (/^(0123456789|abcdefghij|qwertyuiop)/i.test(squashed)) problems.push('Do not use a simple keyboard or number sequence');
  const user = (ctx.username ?? '').toLowerCase().split('@')[0] ?? '';
  if (user.length >= 4 && lower.includes(user)) problems.push('Do not include your username');
  for (const part of (ctx.name ?? '').toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) {
      problems.push('Do not include your name');
      break;
    }
  }
  return problems;
}
