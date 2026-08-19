/**
 * Send ONE real login code to one real phone, straight from this machine.
 *
 * WHY THIS EXISTS. When a code does not arrive there are two completely different
 * possible causes — the phone could not reach this backend, or the SMS route did
 * not deliver — and the app cannot tell them apart. This script removes the phone's
 * network from the picture entirely: laptop → Message Central → phone. Whatever it
 * reports is about the SMS route and nothing else.
 *
 * It uses the REAL MessageCentralSmsSender, the same class the running server uses.
 * It is not a lookalike, so a pass here means the production path works.
 *
 * WHAT IT IS NOT. The code it sends is NOT stored in the database, so it cannot be
 * used to log in. This proves delivery only.
 *
 * Usage:  npm run sms:test -- +919876543210            (uses SMS_PROVIDER from .env)
 *         npm run sms:test -- +919876543210 2factor    (test ONE provider, no edit)
 */
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { validateEnv } from '../src/config/env.validation';
import { createSmsSender } from '../src/auth/sms/sms.provider';
import { maskMobile, scrubForLog, scrubUrlForLog } from '../src/auth/sms/mask';

const E164 = /^\+[1-9]\d{7,14}$/;

function die(step: string, detail: string, fix: string): never {
  console.error(`\n  ✗ ${step}`);
  console.error(`    ${detail}`);
  console.error(`\n  What to do: ${fix}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log('\nFayr — one-off SMS delivery test');
  console.log('════════════════════════════════════════════════════════════\n');

  // ── Step 1: refuse to run anywhere it could do harm ──────────────────────
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production') {
    die(
      'Refusing to run',
      'NODE_ENV=production. This sends a real message and prints diagnostics; it is a local tool.',
      'Run it on your own machine with NODE_ENV unset.',
    );
  }
  if (nodeEnv === 'test') {
    die(
      'Refusing to run',
      'NODE_ENV=test. Tests must never reach a live provider.',
      'Unset NODE_ENV and run again.',
    );
  }
  console.log(`  1. Environment is "${nodeEnv}" — safe to run.`);

  // ── Step 2: the number, from the command line ───────────────────────────
  const mobile = process.argv[2];
  if (!mobile) {
    die(
      'No number given',
      'This script needs the phone number to text, in international format.',
      'npm run sms:test -- +919876543210',
    );
  }
  if (!E164.test(mobile)) {
    die(
      `"${mobile}" is not in international format`,
      'It must start with + and the country code, with no spaces or dashes.',
      'For an Indian number: npm run sms:test -- +919876543210',
    );
  }
  console.log(`  2. Sending to ${maskMobile(mobile)} (masked here on purpose).`);

  // An optional second argument tests ONE provider without editing .env. It is
  // applied before validation, so a name with missing credentials fails the same
  // way the server would at boot rather than halfway through a send.
  const providerArg = process.argv[3];
  if (providerArg) {
    process.env.SMS_PROVIDER = providerArg;
    console.log(`     provider overridden for this run: ${providerArg}`);
  }

  // ── Step 3: read backend/.env through the SAME validator the server uses ──
  const envPath = resolve(__dirname, '..', '.env');
  loadDotenv({ path: envPath });
  console.log(`  3. Read ${envPath}`);

  let env: ReturnType<typeof validateEnv>;
  try {
    env = validateEnv(process.env);
  } catch (err) {
    die(
      'backend/.env did not pass the same check the server runs at boot',
      err instanceof Error ? err.message : String(err),
      'Fix the variable named above in backend/.env, then run this again.',
    );
  }

  if (env.SMS_PROVIDER === 'dev') {
    die(
      'SMS_PROVIDER is "dev"',
      'The console sender does not send anything, so there would be nothing to test.',
      'Pass a provider for this run: npm run sms:test -- '
      + `${mobile} 2factor   (or set SMS_PROVIDER in backend/.env)`,
    );
  }
  console.log(`  4. Credentials present and well-formed (values never printed).`);
  console.log(`     sender     ${env.SMS_PROVIDER}`);
  if (env.SMS_PROVIDER === 'messagecentral') {
    console.log(`     endpoint   ${env.MESSAGECENTRAL_BASE_URL}`);
    console.log(`     senderId   ${env.MESSAGECENTRAL_SENDER_ID}`);
    console.log(`     type       ${env.MESSAGECENTRAL_MESSAGE_TYPE}`);
    console.log(`     country    +${env.MESSAGECENTRAL_COUNTRY_CODE}`);
  } else {
    console.log(`     endpoint   ${env.TWOFACTOR_BASE_URL}`);
    console.log(
      `     template   ${env.TWOFACTOR_TEMPLATE_NAME || "(account default — no name given)"}`,
    );
    console.log(`     number     ${env.TWOFACTOR_NUMBER_FORMAT}`);
    console.log(`     country    +${env.TWOFACTOR_COUNTRY_CODE}`);
  }

  // ── Step 4: watch every HTTP call the real sender makes ──────────────────
  // Instrumentation AROUND the real class, not a reimplementation of it. The URL
  // carries the code and the base-64 password, so it is redacted before printing.
  const realFetch = global.fetch;
  let calls = 0;
  // Every credential this run could put in a URL. 2Factor carries its API key in
  // the PATH, so query-string redaction alone would print it in full.
  const knownSecrets = [
    env.MESSAGECENTRAL_PASSWORD_BASE64,
    env.MESSAGECENTRAL_CUSTOMER_ID,
    env.TWOFACTOR_API_KEY,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  global.fetch = (async (input: Parameters<typeof realFetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls += 1;
    console.log(
      `\n  ${calls}⇒ HTTP ${init?.method ?? 'GET'}  `
      + `${scrubUrlForLog(url, { secrets: knownSecrets })}`,
    );
    const started = Date.now();
    try {
      const res = await realFetch(input as never, init);
      const clone = res.clone();
      const text = await clone.text().catch(() => '');
      console.log(`  ← ${res.status} ${res.statusText} in ${Date.now() - started}ms`);
      console.log(`     body: ${text.length ? scrubForLog(text) : '(empty)'}`);
      if (!text.trim().startsWith('{') && text.length) {
        console.log('     NOTE: that body is not JSON. Tell Claude — it changes how this is read.');
      }
      return res;
    } catch (err) {
      console.log(
        `  ← no response after ${Date.now() - started}ms: `
        + `${err instanceof Error ? `${err.name}: ${scrubForLog(err.message)}` : scrubForLog(String(err))}`,
      );
      throw err;
    }
  }) as typeof global.fetch;

  // ── Step 5: send, through the real class ────────────────────────────────
  console.log('\n  5. Building the sender through the real factory, then sending.');
  let sender: { sendOtp(mobile: string, code: string): Promise<void> };
  try {
    sender = createSmsSender({
      get: (key: string) => (env as unknown as Record<string, unknown>)[key],
    } as never);
  } catch (err) {
    die(
      'The sender refused to start',
      err instanceof Error ? err.message : String(err),
      'Fix the variable named above in backend/.env, then run this again.',
    );
  }

  // Never printed, never stored. This code cannot log anyone in.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

  try {
    await sender.sendOtp(mobile, code);
  } catch (err) {
    console.error('\n════════════════════════════════════════════════════════════');
    console.error('  RESULT: the provider did NOT accept the message.');
    console.error(`\n  What the user would see: "${err instanceof Error ? err.message : String(err)}"`);
    console.error('\n  The ← lines above carry the reason. Send them to Claude as they are —');
    console.error('  they are already scrubbed of the code, the password and your number.');
    console.error('════════════════════════════════════════════════════════════\n');
    process.exit(2);
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  RESULT: the provider ACCEPTED the message.');
  console.log(`\n  A 6-digit code should now arrive at ${maskMobile(mobile)}.`);
  console.log('  It will NOT log you in — it was never saved. This tests delivery only.');
  console.log('\n  If nothing arrives within two minutes, the provider accepted it and');
  console.log('  did not deliver it. That is the route being filtered, not our code —');
  console.log('  check the delivery log in the Message Central console.');
  console.log('════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  // Nothing should reach here; if it does, say so plainly rather than dumping a
  // stack trace that might carry a URL.
  Logger.error(
    `unexpected failure: ${err instanceof Error ? scrubForLog(err.message) : scrubForLog(String(err))}`,
    'sms:test',
  );
  process.exit(3);
});
