export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  /** 'dev' trusts an x-dev-user header (development only); 'session' uses real accounts. */
  authMode: 'dev' | 'session';
  databaseUrl?: string;
  databaseSsl: boolean;
  databasePoolMax: number;
  corsOrigins: string[];
  cookieSecure: boolean;
  trustProxy: number;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  /** 32-byte key (hex) that encrypts MFA seeds. Never stored in the database. */
  authEncryptionKey?: Buffer;
  loginRateLimit: { windowMs: number; max: number };
}

const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

/**
 * Reads and validates configuration. In production it refuses to start with an unsafe or incomplete setup,
 * listing every problem at once rather than failing one at a time.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['env'];
  const isProduction = nodeEnv === 'production';
  const authMode = (env.AUTH_MODE ?? (isProduction ? 'session' : 'dev')) as AppConfig['authMode'];
  const corsOrigins = (env.CORS_ORIGINS ?? env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
  const keyHex = env.AUTH_ENCRYPTION_KEY;

  const cfg: AppConfig = {
    env: nodeEnv,
    isProduction,
    port: num(env.PORT, 4000),
    authMode,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL === 'true',
    databasePoolMax: num(env.DATABASE_POOL_MAX, 10),
    corsOrigins,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction,
    trustProxy: num(env.TRUST_PROXY, 0),
    sessionIdleMs: num(env.SESSION_IDLE_MINUTES, 30) * 60_000,
    sessionAbsoluteMs: num(env.SESSION_ABSOLUTE_HOURS, 12) * 3_600_000,
    authEncryptionKey: keyHex && /^[0-9a-fA-F]{64}$/.test(keyHex) ? Buffer.from(keyHex, 'hex') : undefined,
    loginRateLimit: { windowMs: 15 * 60_000, max: num(env.LOGIN_RATE_LIMIT_MAX, 20) },
  };

  const problems: string[] = [];
  if (!['development', 'test', 'production'].includes(nodeEnv)) problems.push(`NODE_ENV must be development, test or production (got "${nodeEnv}")`);
  if (!['dev', 'session'].includes(authMode)) problems.push(`AUTH_MODE must be dev or session (got "${authMode}")`);
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) problems.push('PORT must be a valid port number');
  if (authMode === 'session' && !cfg.authEncryptionKey) problems.push('AUTH_ENCRYPTION_KEY must be 64 hex characters (32 bytes) when AUTH_MODE=session');
  if (isProduction) {
    if (authMode !== 'session') problems.push('AUTH_MODE=dev (simulated sign-in) is not allowed in production');
    if (!cfg.databaseUrl) problems.push('DATABASE_URL is required in production');
    if (corsOrigins.includes('*')) problems.push('CORS_ORIGINS must list explicit origins, not *');
    if (corsOrigins.some((o) => !o.startsWith('https://'))) problems.push('CORS_ORIGINS must be https:// origins in production');
    if (!cfg.cookieSecure) problems.push('COOKIE_SECURE must not be disabled in production');
  }
  if (problems.length) throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
  return cfg;
}
