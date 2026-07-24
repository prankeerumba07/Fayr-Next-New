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
