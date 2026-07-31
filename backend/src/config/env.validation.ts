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

  // --- Uploads (step 3, campaign images) ------------------------------------
  // Where operator-uploaded files (campaign images now; verification screenshots
  // later) are written. Local disk in dev; the StorageService abstraction lets a
  // deploy swap this for S3/Cloudflare R2 without touching the controllers.
  // Resolved relative to the process cwd, so the default lands at backend/uploads.
  UPLOAD_DIR: z.string().min(1).default('./uploads'),

  // --- Task loop (step 1.5) -------------------------------------------------
  // How long a claim may sit before purchase before it expires and returns the
  // user's tickets. Operator policy, not a fetched fact.
  CLAIM_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  // --- Scheduler (step 1.6) -------------------------------------------------
  // The maintenance cron: re-checks review visibility during HOLDING, auto-
  // releases eligible refunds, and expires unpurchased claims. Disabled under
  // NODE_ENV=test regardless (tests drive the tick directly). A single instance
  // runs each tick — guarded by a Postgres advisory lock — so it's safe to leave
  // enabled on every replica.
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Standard 5-field cron. Default: hourly. A review hold lasts days, so this
  // cadence is ample; tighten per deploy if needed.
  SCHEDULER_CRON: z.string().min(1).default('0 * * * *'),
  // Per-request timeout (ms) for the server-side review-permalink fetch.
  VISIBILITY_FETCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(10000),

  // --- Staff / Admin (step 2.1) ---------------------------------------------
  // Signing secret for STAFF access tokens. DISTINCT from JWT_ACCESS_SECRET on
  // purpose: a user token and a staff token live in separate trust domains, so
  // one can never be verified as the other. Security-sensitive → REQUIRED, no
  // default, 32-char minimum — same bar as the user access secret.
  STAFF_JWT_SECRET: z
    .string()
    .min(32, 'STAFF_JWT_SECRET must be at least 32 characters'),
  // Staff access-token lifetime. Longer than the user access token (no refresh
  // rotation on the staff side — staff simply re-login when it expires), but
  // still bounded so a leaked staff token doesn't live forever. `ms`-style string.
  STAFF_JWT_TTL: z.string().min(1).default('8h'),
  // Optional bootstrap admin: if BOTH are set, an ADMIN staff account is created
  // on boot when absent (idempotent — never overwrites an existing one). Leave
  // unset in environments that provision staff another way.
  STAFF_BOOTSTRAP_EMAIL: z.string().email().optional(),
  STAFF_BOOTSTRAP_PASSWORD: z
    .string()
    .min(12, 'STAFF_BOOTSTRAP_PASSWORD must be at least 12 characters')
    .optional(),
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
