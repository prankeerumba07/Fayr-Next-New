import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env, isBase64 } from '../../config/env.validation';
import { DevSmsSender } from './dev-sms-sender';
import { MessageCentralSmsSender } from './message-central-sms-sender';
import { Fast2SmsSender } from './fast2sms-sms-sender';
import { TwilioSmsSender } from './twilio-sms-sender';
import { TwoFactorSmsSender } from './two-factor-sms-sender';
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
  '2factor': 'Active sender: 2FACTOR — real SMS will be sent to real phones',
  twilio: 'Active sender: TWILIO — real SMS will be sent to real phones',
  fast2sms: 'Active sender: FAST2SMS — real SMS will be sent to real phones',
} as const;

const KNOWN = Object.keys(BOOT_LINE).join(', ');

/** Credentials whose presence means someone intended to send real messages. */
const REAL_PROVIDER_KEYS = [
  'MESSAGECENTRAL_CUSTOMER_ID',
  'TWOFACTOR_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'FAST2SMS_API_KEY',
] as const;

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
    // Second of the two gates (the env schema is the first). The console sender
    // logs live codes, so production is refused outright rather than warned about.
    if (String(config.get('NODE_ENV', { infer: true })) === 'production') {
      throw new Error(
        'SMS_PROVIDER=dev is refused when NODE_ENV=production: the console sender '
        + 'writes live login codes into the log and sends no SMS. Name a real provider.',
      );
    }
    // Credentials present but dev selected is the mistake that produces a healthy
    // looking process and no texts. Outside production it is legitimate (offline
    // work), so warn rather than refuse — but never pass in silence.
    const configured = REAL_PROVIDER_KEYS.filter((k) => {
      const v = config.get(k, { infer: true });
      return typeof v === 'string' && v.trim().length > 0;
    });
    if (configured.length > 0) {
      logger.warn(
        `SMS_PROVIDER=dev, but credentials are configured (${configured.join(', ')}). `
        + 'No SMS will be sent. Set SMS_PROVIDER to a real provider to use them.',
      );
    }
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

  if (provider === '2factor') {
    // Same order as above: validate BEFORE logging, so a boot line never promises
    // real SMS and then crashes.
    const key = config.get('TWOFACTOR_API_KEY', { infer: true });
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error(
        'TWOFACTOR_API_KEY is required when SMS_PROVIDER=2factor. '
        + 'Set it in backend/.env, or set SMS_PROVIDER=dev to print codes to the console instead.',
      );
    }
    const sender = new TwoFactorSmsSender(config);
    logger.log(BOOT_LINE['2factor']);
    return sender;
  }

  if (provider === 'twilio') {
    for (const name of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] as const) {
      const value = config.get(name, { infer: true });
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(
          `${name} is required when SMS_PROVIDER=twilio. `
          + 'Set it in backend/.env, or set SMS_PROVIDER=dev to print codes to the console instead.',
        );
      }
    }
    const from = String(config.get('TWILIO_FROM_NUMBER', { infer: true }) ?? '').trim();
    const service = String(config.get('TWILIO_MESSAGING_SERVICE_SID', { infer: true }) ?? '').trim();
    if (from.length === 0 && service.length === 0) {
      throw new Error(
        'TWILIO_FROM_NUMBER (or TWILIO_MESSAGING_SERVICE_SID) is required when '
        + 'SMS_PROVIDER=twilio. It is the number the code is sent from.',
      );
    }
    const sender = new TwilioSmsSender(config);
    logger.log(BOOT_LINE.twilio);
    return sender;
  }

  if (provider === 'fast2sms') {
    const key = config.get('FAST2SMS_API_KEY', { infer: true });
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error(
        'FAST2SMS_API_KEY is required when SMS_PROVIDER=fast2sms. '
        + 'Set it in backend/.env, or set SMS_PROVIDER=dev to print codes to the console instead.',
      );
    }
    const sender = new Fast2SmsSender(config);
    logger.log(BOOT_LINE.fast2sms);
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
