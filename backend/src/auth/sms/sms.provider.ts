import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env, isBase64 } from '../../config/env.validation';
import { DevSmsSender } from './dev-sms-sender';
import { MessageCentralSmsSender } from './message-central-sms-sender';
import { SMS_SENDER, type SmsSender } from './sms-sender';

/**
 * Which postman is live — decided by env, announced in exactly one line.
 *
 * The failure this is shaped against is not a crash. It is a SILENT FALLBACK:
 * believing real texts are going out during a demo while the console sender is
 * actually active. So there is no fallback path at all. A named provider with
 * missing or malformed credentials THROWS, which stops the boot, and the terminal
 * shows the reason with the exact variable to fix.
 *
 * The env schema (src/config/env.validation.ts) already enforces the same rules,
 * so this is the second of two independent gates. Deliberate duplication: the
 * schema catches a bad .env at boot, and this catches a sender constructed by any
 * other route (a test, a script, a future module) with a half-filled config.
 */

/** The one line printed at boot. Asserted in tests so it cannot drift silently. */
export const BOOT_LINE = {
  dev: 'Active sender: DEV — the code is printed in this terminal, no SMS is sent',
  messagecentral:
    'Active sender: MESSAGE CENTRAL — real SMS will be sent to real phones',
} as const;

const KNOWN = Object.keys(BOOT_LINE).join(', ');

/** Credentials that Message Central cannot work without. */
const MC_REQUIRED = [
  'MESSAGECENTRAL_CUSTOMER_ID',
  'MESSAGECENTRAL_PASSWORD_BASE64',
  'MESSAGECENTRAL_EMAIL',
] as const;

export function createSmsSender(config: ConfigService<Env, true>): SmsSender {
  const provider = String(config.get('SMS_PROVIDER', { infer: true }) ?? 'dev');
  // The logger is created per call rather than at module scope so a test can spy
  // on Logger.prototype and still see this line.
  const logger = new Logger('SmsSender');

  if (provider === 'dev') {
    logger.log(BOOT_LINE.dev);
    return new DevSmsSender();
  }

  if (provider === 'messagecentral') {
    // Validate BEFORE logging: a boot line claiming real SMS, followed by a
    // crash, is worse than no line at all.
    for (const name of MC_REQUIRED) {
      const value = config.get(name, { infer: true });
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(
          `${name} is required when SMS_PROVIDER=messagecentral. `
          + 'Set it in backend/.env, or set SMS_PROVIDER=dev to print codes to the console instead.',
        );
      }
    }
    const key = String(config.get('MESSAGECENTRAL_PASSWORD_BASE64', { infer: true })).trim();
    if (!isBase64(key)) {
      throw new Error(
        'MESSAGECENTRAL_PASSWORD_BASE64 must be base 64 encoded, not the raw password. '
        + "Run: printf '%s' 'your-password' | base64",
      );
    }
    const sender = new MessageCentralSmsSender(config);
    logger.log(BOOT_LINE.messagecentral);
    return sender;
  }

  // Never guess. An unrecognised name is a typo or an unbuilt provider, and both
  // must stop the boot rather than quietly print codes to a terminal nobody is
  // watching.
  throw new Error(
    `SMS_PROVIDER='${provider}' is not a sender this build knows how to use. `
    + `Accepted values: ${KNOWN}.`,
  );
}

/** DI binding. The only place the concrete sender is chosen. */
export const smsSenderProvider: Provider = {
  provide: SMS_SENDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => createSmsSender(config),
};
