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
  // Where PRIVATE files (verification screenshots — user PII) are written.
  // Deliberately a SEPARATE dir, never mounted as static assets: private files
  // are only ever streamed back through an RBAC-checked endpoint, never a URL.
  PRIVATE_UPLOAD_DIR: z.string().min(1).default('./private-uploads'),

  // --- Screenshot OCR (step 3, Claude vision) -------------------------------
  // Anthropic API key for the vision extraction. OPTIONAL by design: when unset,
  // OCR degrades gracefully — screenshots still upload and land for MANUAL staff
  // review; extraction simply doesn't run. Never commit a real key (.env only).
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Default (cheap) vision model; escalation model used when confidence is low.
  // Confirmed IDs/pricing via the claude-api reference: Haiku 4.5 $1/$5 per MTok,
  // Sonnet 5 $3/$15 per MTok.
  OCR_MODEL: z.string().min(1).default('claude-haiku-4-5'),
  OCR_ESCALATION_MODEL: z.string().min(1).default('claude-sonnet-5'),
  // Escalate to the stronger model when extraction confidence is below this.
  OCR_CONFIDENCE_ESCALATE: z.coerce.number().int().min(0).max(100).default(70),
  // Safety ceiling on extractions per UTC day (cost guard). Enforced at upload.
  OCR_DAILY_CAP: z.coerce.number().int().min(0).max(100000).default(500),

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

  // --- One-time-code delivery (SMS) -----------------------------------------
  // Which sender delivers the login code.
  //
  // A DELIBERATELY SHORT ENUM. Only providers that are actually implemented are
  // accepted, so a value like 'twilio' or 'msg91' fails at boot with a list of
  // what works instead of booting into a sender that does not exist. And there is
  // no 'auto' or 'fallback' value on purpose: silently degrading to the console
  // sender is how someone ends up demoing to founders believing texts are going
  // out when they are not.
  SMS_PROVIDER: z.enum(['dev', 'messagecentral', '2factor']).default('dev'),

  // Message Central (MessageNow). Optional at the schema level because 'dev'
  // must need no credentials at all — a fresh clone has to run offline. The
  // conditional requirement is enforced in the superRefine below, which names the
  // exact variable that is missing.
  MESSAGECENTRAL_BASE_URL: z
    .string()
    .url()
    .default('https://cpaas.messagecentral.com'),
  MESSAGECENTRAL_CUSTOMER_ID: z.string().min(1).optional(),
  // The provider takes the console password BASE-64 ENCODED, not raw:
  //   printf '%s' 'your-password' | base64
  MESSAGECENTRAL_PASSWORD_BASE64: z.string().min(1).optional(),
  MESSAGECENTRAL_EMAIL: z.string().email().optional(),
  // Required by the send API. Usually IGNORED on the free international route,
  // which delivers from a random numeric sender — so it has a default and is not
  // something the operator has to discover before the first text works.
  MESSAGECENTRAL_SENDER_ID: z.string().min(1).max(11).default('FAYRIN'),
  // Sent as a separate parameter from the number itself, so the sender splits the
  // E.164 mobile on this prefix and REFUSES anything that does not match it.
  MESSAGECENTRAL_COUNTRY_CODE: z
    .string()
    .regex(/^\d{1,3}$/, 'MESSAGECENTRAL_COUNTRY_CODE must be 1-3 digits')
    .default('91'),
  // TRANSACTION by default, not OTP: the provider's OTP mode can generate its own
  // code (it accepts an otpLength), and a provider-generated code would never
  // match the one we hashed — the user would type a valid-looking code and be
  // told it is wrong. Switch to OTP only if delivery is being filtered.
  MESSAGECENTRAL_MESSAGE_TYPE: z
    .enum(['TRANSACTION', 'OTP', 'PROMOTIONAL'])
    .default('TRANSACTION'),
  // Per-request timeout. A login must fail fast rather than hang on a wedged
  // provider; the send is never retried after a timeout (see the sender).
  MESSAGECENTRAL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),
  // How long an auth token is reused before being refetched. The provider does
  // not publish an expiry, so this is a conservative cache lifetime; an explicit
  // 401/403 also refreshes it immediately.
  MESSAGECENTRAL_TOKEN_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(30),

  // 2Factor.in. Optional at the schema level for the same reason as above; the
  // conditional requirement is in the superRefine below.
  //
  // NOTE the shape of their API: the key and the login code are PATH segments, not
  // query parameters, so any URL that goes near a log must be redacted by
  // scrubUrlForLog — see two-factor-sms-sender.ts.
  TWOFACTOR_BASE_URL: z.string().url().default('https://2factor.in'),
  TWOFACTOR_API_KEY: z.string().min(1).optional(),
  // Optional. Empty means the account's DEFAULT approved template. A named template
  // must already be approved in their dashboard, or every send returns
  // Status:"Error" — which is why this is a setting and not a hardcoded name.
  TWOFACTOR_TEMPLATE_NAME: z.string().default(''),
  TWOFACTOR_COUNTRY_CODE: z
    .string()
    .regex(/^\d{1,3}$/, 'TWOFACTOR_COUNTRY_CODE must be 1-3 digits')
    .default('91'),
  // Their docs show +91XXXXXXXXXX; plain national is also widely accepted. Switch
  // rather than edit code if this account wants the other one.
  TWOFACTOR_NUMBER_FORMAT: z.enum(['e164', 'national']).default('e164'),
  TWOFACTOR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
});


/**
 * Cross-field rules that a per-field schema cannot express.
 *
 * The SMS one matters more than it looks: naming a real provider without complete
 * credentials must STOP THE BOOT. The alternative — falling back to the console
 * sender — produces a process that looks healthy, an app that says "code sent",
 * and no text. Each message names the exact variable so the fix needs no guessing.
 */
const withCrossFieldRules = envSchema.superRefine((env, ctx) => {
  // THE CONSOLE SENDER MUST NEVER REACH PRODUCTION.
  //
  // 'dev' is the default and .env.example ships the literal line SMS_PROVIDER=dev,
  // so the realistic failure is a deploy that fills in real credentials and never
  // edits that line: it boots clean, sends nothing, and writes every live code into
  // the production log. "NEVER wire this in production" was only ever a comment.
  if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'dev') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SMS_PROVIDER'],
      message:
        'SMS_PROVIDER=dev is refused when NODE_ENV=production: the console sender '
        + 'writes live login codes into the log and sends no SMS. Name a real provider.',
    });
  }

  if (env.SMS_PROVIDER === '2factor') {
    if (env.TWOFACTOR_API_KEY == null || env.TWOFACTOR_API_KEY.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWOFACTOR_API_KEY'],
        message: 'TWOFACTOR_API_KEY is required when SMS_PROVIDER=2factor',
      });
    }
    return;
  }
  if (env.SMS_PROVIDER !== 'messagecentral') return;

  const required: Array<[keyof typeof env, string | undefined]> = [
    ['MESSAGECENTRAL_CUSTOMER_ID', env.MESSAGECENTRAL_CUSTOMER_ID],
    ['MESSAGECENTRAL_PASSWORD_BASE64', env.MESSAGECENTRAL_PASSWORD_BASE64],
    ['MESSAGECENTRAL_EMAIL', env.MESSAGECENTRAL_EMAIL],
  ];
  for (const [name, value] of required) {
    if (value == null || value.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name as string],
        message: `${String(name)} is required when SMS_PROVIDER=messagecentral`,
      });
    }
  }

  // Malformed is as fatal as missing: a password that is not real base 64 fails
  // on every send with an auth error that looks like a provider outage.
  const key = env.MESSAGECENTRAL_PASSWORD_BASE64;
  if (key != null && key.trim().length > 0 && !isBase64(key.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MESSAGECENTRAL_PASSWORD_BASE64'],
      message:
        'MESSAGECENTRAL_PASSWORD_BASE64 must be base 64 encoded '
        + "(run: printf '%s' 'your-password' | base64)",
    });
  }
});

/**
 * Catches a raw password pasted where a base-64 one belongs.
 *
 * Deliberately accepts UNPADDED base 64: plenty of tools strip the '=' padding,
 * and rejecting a value that the provider would have accepted is the worse error
 * of the two — it stops a working configuration from booting.
 *
 * It cannot be airtight, and should not be read as such: a password made only of
 * letters and digits whose length is a multiple of 4 ("abcdefgh") is genuinely
 * indistinguishable from base 64 and will pass. It does catch the common mistakes
 * — a symbol, a space, an impossible length, non-canonical trailing bits — but
 * passing it is NOT evidence the credential is correct, only that it is plausible.
 */
export function isBase64(value: string): boolean {
  const body = value.replace(/=+$/, '');
  if (body.length === 0) return false;
  // A base-64 group decodes 4 chars at a time; a trailing group of 1 is impossible.
  if (body.length % 4 === 1) return false;
  if (!/^[A-Za-z0-9+/]+$/.test(body)) return false;
  try {
    // Re-pad before the round trip so an unpadded value is judged on its content.
    const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('base64') === padded;
  } catch {
    return false;
  }
}

export type Env = z.infer<typeof envSchema>;

/**
 * ConfigModule's `validate` hook. Receives the raw merged env, returns the
 * parsed + typed object (which becomes what ConfigService serves). On failure it
 * throws a single readable error listing every problem, so a misconfigured
 * deploy fails fast and loud with an actionable message.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = withCrossFieldRules.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
