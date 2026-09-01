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

  // --- The assistant ---------------------------------------------------------
  // Which answer source is asked FIRST. 'answer-book' searches the stored answers
  // and is the only one that answers anything today. 'model' puts a language model
  // in front of it — the seam exists, the model does not, so selecting it changes
  // nothing at all and every question falls straight through to the answer book.
  // Kept as a validated setting so a typo stops the boot instead of silently
  // choosing the default.
  ASSISTANT_ANSWER_SOURCE: z
    .enum(['answer-book', 'model'])
    .default('answer-book'),

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
  // How long a private verification screenshot is kept before the maintenance
  // cron deletes its BYTES. The row, its sha256 and the OCR case are kept
  // forever, so the duplicate-image fraud signal and the reason for a payout
  // both outlive the picture.
  //
  // min(1), not min(0), deliberately: a zero would not mean "keep forever", it
  // would mean every screenshot ever uploaded is expired the moment the cron
  // runs — including one a reviewer has open. An empty payout-cap field already
  // taught this codebase what a real zero costs, so a zero here fails at boot.
  SCREENSHOT_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(90),

  // --- Task loop (step 1.5) -------------------------------------------------
  // How long a claim may sit before purchase before it expires and returns the
  // user's tickets. Operator policy, not a fetched fact.
  //
  // MINUTES, AND THIRTY BY DEFAULT. The owner asked on 1 September 2026 for a
  // thirty minute slot: the purchase has to be made inside it. This used to be
  // CLAIM_TTL_DAYS, whole days, minimum one — so it could not express thirty
  // minutes at all. Every reader moved with it in the same commit, and the old
  // name is gone rather than kept working alongside this one, because two
  // settings for one window is how two screens end up quoting different numbers.
  //
  // The ceiling is ninety days in minutes, which is the ceiling the old setting
  // had. The floor is one minute; a floor of zero would expire a claim the instant
  // it was made and take the tickets with it until the next sweep.
  //
  // BEFORE RAISING THE SWEEP'S CADENCE, READ THIS. Thirty minutes will expire
  // constantly where seven days almost never did, so the sweep that returns the
  // tickets is now on the busy path. SCHEDULER_CRON is hourly by default, which
  // means somebody can wait up to an hour past the deadline for their tickets.
  // task.e2e-spec.ts proves the return itself; the cadence is an operator setting.
  CLAIM_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(129_600)
    .default(30),

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
  // --- The daily offer check -------------------------------------------------
  // Every live offer, checked once a night: pictures, amounts, seats, words. It
  // reads campaigns and tasks and writes only its own record of having run, so
  // running it more often is safe — but the findings it produces need a person to
  // act on them, and a report that arrives twice a day gets read half as often.
  CAMPAIGN_CHECK_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Default: 06:15, before anyone starts work, and off the hour so it never
  // competes with the maintenance tick for the database.
  CAMPAIGN_CHECK_CRON: z.string().min(1).default('15 6 * * *'),
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
  SMS_PROVIDER: z
    .enum(['dev', 'messagecentral', '2factor', 'twilio', 'fast2sms'])
    .default('dev'),

  // THE PER-COPY LATCH: THIS MACHINE SENDS REAL TEXTS OR IT DOES NOT BOOT.
  //
  // 'dev' is the default above, and it has to stay the default: a fresh clone must
  // run offline with no vendor account. But that default is itself the quiet
  // fallback — delete the SMS_PROVIDER line, mistype it, or load the wrong .env,
  // and the process boots healthy, sends nothing, and prints live codes into a
  // terminal. Every existing guard is about NODE_ENV=production, and a laptop
  // being used to test a real handset is not production.
  //
  // So this is turned on in the settings file of the copy that is testing real
  // texts, and nowhere else. With it on, 'dev' and an absent SMS_PROVIDER both
  // stop the boot and say why. The frozen demo copy does not set it and is
  // unaffected. Off by default so a fresh clone is not asked for credentials it
  // has no reason to have.
  SMS_MUST_BE_REAL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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
  TWOFACTOR_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),

  // Twilio Programmable Messaging. We supply the body and the code — never Twilio
  // Verify, which generates and validates its own.
  //
  // TRIAL SHAPE, WHICH DRIVES THE ERROR HANDLING: 100 free messages, recipients must
  // be added to Verified Caller IDs (at most 5), 30-day expiry. A send to an
  // unverified number fails with Twilio 21608, and India must be enabled in Geo
  // Permissions or it fails with 21408. Both are translated into instructions.
  TWILIO_BASE_URL: z.string().url().default('https://api.twilio.com'),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  // Secret. Sent as Basic auth in a HEADER, never in a URL, and never logged.
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  // The Twilio number the message comes from. Required unless a Messaging Service
  // is used instead.
  TWILIO_FROM_NUMBER: z.string().default(''),
  // Optional alternative sender. Their API takes one OR the other, not both.
  TWILIO_MESSAGING_SERVICE_SID: z.string().default(''),
  TWILIO_COUNTRY_CODE: z
    .string()
    .regex(/^\d{1,3}$/, 'TWILIO_COUNTRY_CODE must be 1-3 digits')
    .default('91'),
  TWILIO_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),

  // Fast2SMS, Quick route (route=q): no DLT, random numeric sender, about Rs 5 a
  // message — so the Rs 50 free credit is roughly TEN messages.
  //
  // Their key goes in an `authorization` HEADER. We POST rather than GET precisely so
  // it never appears in a URL, which would reach logs and proxies.
  FAST2SMS_BASE_URL: z.string().url().default('https://www.fast2sms.com'),
  FAST2SMS_API_KEY: z.string().min(1).optional(),
  FAST2SMS_COUNTRY_CODE: z
    .string()
    .regex(/^\d{1,3}$/, 'FAST2SMS_COUNTRY_CODE must be 1-3 digits')
    .default('91'),
  FAST2SMS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),
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
        'SMS_PROVIDER=dev is refused when NODE_ENV=production: the console sender ' +
        'writes live login codes into the log and sends no SMS. Name a real provider.',
    });
  }

  // THE LATCH. Deliberately BEFORE the per-provider rules: if this copy is meant
  // to be texting a real handset, "which credentials are missing" is the wrong
  // question and the answer to print is "you are not sending texts at all".
  if (env.SMS_MUST_BE_REAL && env.SMS_PROVIDER === 'dev') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SMS_PROVIDER'],
      message:
        'SMS_MUST_BE_REAL=true on this copy, so SMS_PROVIDER=dev is refused: the ' +
        'console sender prints live login codes into this terminal and sends no ' +
        'text message at all. An ABSENT SMS_PROVIDER lands here too, because dev ' +
        'is its default value. Name a real provider, or remove SMS_MUST_BE_REAL ' +
        'from backend/.env if you meant to work offline.',
    });
    return;
  }

  if (env.SMS_PROVIDER === 'fast2sms') {
    if (
      env.FAST2SMS_API_KEY == null ||
      env.FAST2SMS_API_KEY.trim().length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FAST2SMS_API_KEY'],
        message: 'FAST2SMS_API_KEY is required when SMS_PROVIDER=fast2sms',
      });
    }
    return;
  }

  if (env.SMS_PROVIDER === 'twilio') {
    const required: Array<[string, string | undefined]> = [
      ['TWILIO_ACCOUNT_SID', env.TWILIO_ACCOUNT_SID],
      ['TWILIO_AUTH_TOKEN', env.TWILIO_AUTH_TOKEN],
    ];
    for (const [name, value] of required) {
      if (value == null || value.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `${name} is required when SMS_PROVIDER=twilio`,
        });
      }
    }
    // One sender is mandatory, and neither is required on its own — so the rule is
    // "at least one", stated as such rather than as two confusing failures.
    if (
      env.TWILIO_FROM_NUMBER.trim().length === 0 &&
      env.TWILIO_MESSAGING_SERVICE_SID.trim().length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_FROM_NUMBER'],
        message:
          'TWILIO_FROM_NUMBER (or TWILIO_MESSAGING_SERVICE_SID) is required when ' +
          'SMS_PROVIDER=twilio',
      });
    }
    return;
  }

  if (env.SMS_PROVIDER === '2factor') {
    if (
      env.TWOFACTOR_API_KEY == null ||
      env.TWOFACTOR_API_KEY.trim().length === 0
    ) {
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
        'MESSAGECENTRAL_PASSWORD_BASE64 must be base 64 encoded ' +
        "(run: printf '%s' 'your-password' | base64)",
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
