import { z } from 'zod';

/**
 * The single source of truth for environment configuration.
 *
 * Every variable the service reads is declared here. `validateEnv` runs once at
 * boot (wired into ConfigModule) and THROWS if anything is missing or malformed,
 * so the process refuses to start with bad config rather than crashing later on
 * the first request that happens to read it. Defaults are only for values that
 * are genuinely safe to default in local dev — anything security-sensitive
 * (added in later steps, e.g. JWT secrets) will be required with no default.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  // Coerce because process.env values are always strings.
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Postgres connection string. Required — the service is useless without a DB,
  // so a missing/malformed URL must stop the boot with a clear message rather
  // than surfacing as a cryptic connection error on the first query.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => /^postgres(ql)?:\/\//i.test(v), {
      message: 'DATABASE_URL must be a postgres:// connection string',
    }),

  // --- Authentication (step 0.3) -------------------------------------------
  // Signing secret for JWT access tokens. Security-sensitive → REQUIRED with no
  // default: a forgeable token is a full account takeover, so the process must
  // refuse to boot without a real secret rather than fall back to a known one.
  // 32-char minimum keeps the HMAC key from being trivially brute-forced.
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  // Access-token lifetime. Short by design (see refresh rotation): a leaked
  // access token is only useful for this window. `ms`-style string for @nestjs/jwt.
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),
  // Refresh-token lifetime in days. Long-lived but revocable and rotated on every
  // use, so a stolen refresh token is caught by reuse detection.
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Comma-separated allowlist of browser origins permitted via CORS (e.g. the
  // web prototype at http://localhost:8000). In non-production an empty value
  // reflects the request origin for local convenience; in production an empty
  // value means NO cross-origin access — set it explicitly per deploy.
  CORS_ORIGINS: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

/**
 * ConfigModule's `validate` hook. Receives the raw merged env, returns the
 * parsed + typed object (which becomes what ConfigService serves). On failure it
 * throws a single readable error listing every problem, so a misconfigured
 * deploy fails fast and loud with an actionable message.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
