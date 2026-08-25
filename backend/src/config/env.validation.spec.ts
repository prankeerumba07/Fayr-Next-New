import { isBase64, validateEnv } from './env.validation';

/**
 * The boot gate.
 *
 * A misconfigured SMS provider must stop the process, not degrade quietly. The
 * failure being defended against is a demo where the terminal looks healthy, the
 * app says "code sent", and no text was ever sent.
 */

const BASE: Record<string, string> = {
  DATABASE_URL: 'postgresql://fayr:fayr@localhost:5432/fayr_dev?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  STAFF_JWT_SECRET: 'b'.repeat(32),
};

const MC: Record<string, string> = {
  SMS_PROVIDER: 'messagecentral',
  MESSAGECENTRAL_CUSTOMER_ID: 'C-TEST0001',
  MESSAGECENTRAL_PASSWORD_BASE64: 'cGFzc3dvcmQ=',
  MESSAGECENTRAL_EMAIL: 'dev@example.com',
};

/** Run `fn` and return whatever it threw, so a test can inspect the message. */
const caught = (fn: () => unknown): Error | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e as Error;
  }
};

describe('validateEnv — SMS provider', () => {
  it('defaults to the dev sender when SMS_PROVIDER is absent', () => {
    expect(validateEnv({ ...BASE }).SMS_PROVIDER).toBe('dev');
  });

  it('needs no Message Central credentials at all in dev', () => {
    expect(() => validateEnv({ ...BASE, SMS_PROVIDER: 'dev' })).not.toThrow();
  });

  it('accepts a complete Message Central configuration', () => {
    const env = validateEnv({ ...BASE, ...MC });
    expect(env.SMS_PROVIDER).toBe('messagecentral');
    expect(env.MESSAGECENTRAL_BASE_URL).toBe('https://cpaas.messagecentral.com');
    // Sensible defaults so a working .env only needs the three real secrets.
    expect(env.MESSAGECENTRAL_COUNTRY_CODE).toBe('91');
    expect(env.MESSAGECENTRAL_SENDER_ID).toBeTruthy();
  });

  it('rejects a typo in the provider name, listing what is allowed', () => {
    const err = caught(() => validateEnv({ ...BASE, SMS_PROVIDER: 'messagecentrall' }));
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/SMS_PROVIDER/);
  });

  for (const missing of Object.keys(MC).filter((k) => k !== 'SMS_PROVIDER')) {
    it(`refuses to boot without ${missing}, naming it in the error`, () => {
      const raw = { ...BASE, ...MC };
      delete raw[missing];
      const err = caught(() => validateEnv(raw));
      expect(err).toBeDefined();
      expect(err!.message).toContain(missing);
      expect(err!.message).toMatch(/SMS_PROVIDER=messagecentral/);
    });
  }

  it('refuses a password that is not real base 64', () => {
    const err = caught(() => validateEnv({ ...BASE, ...MC, MESSAGECENTRAL_PASSWORD_BASE64: 'not base64!!' }));
    expect(err!.message).toContain('MESSAGECENTRAL_PASSWORD_BASE64');
  });

  it('refuses an email that is not an email', () => {
    const err = caught(() => validateEnv({ ...BASE, ...MC, MESSAGECENTRAL_EMAIL: 'nope' }));
    expect(err!.message).toContain('MESSAGECENTRAL_EMAIL');
  });

  it('still validates everything else — one bad SMS value does not mask a bad secret', () => {
    const err = caught(() => validateEnv({ ...BASE, ...MC, JWT_ACCESS_SECRET: 'short' }));
    expect(err!.message).toContain('JWT_ACCESS_SECRET');
  });
});

describe('validateEnv — the console sender must never reach production', () => {
  // Found by an adversarial review. 'dev' is the DEFAULT, .env.example ships the
  // literal line SMS_PROVIDER=dev, and nothing refused it in production — so a
  // deploy that filled in real credentials but never edited that line would boot
  // clean, send no SMS, and print every live code into the production log.
  it('refuses SMS_PROVIDER=dev when NODE_ENV=production', () => {
    const err = caught(() => validateEnv({ ...BASE, NODE_ENV: 'production', SMS_PROVIDER: 'dev' }));
    expect(err).toBeDefined();
    expect(err!.message).toContain('SMS_PROVIDER');
    expect(err!.message).toMatch(/production/i);
  });

  it('refuses an ABSENT SMS_PROVIDER in production too — the default is the trap', () => {
    const err = caught(() => validateEnv({ ...BASE, NODE_ENV: 'production' }));
    expect(err!.message).toContain('SMS_PROVIDER');
  });

  it('allows a real provider in production', () => {
    expect(() =>
      validateEnv({ ...BASE, NODE_ENV: 'production', SMS_PROVIDER: '2factor', TWOFACTOR_API_KEY: 'k' }),
    ).not.toThrow();
  });

  it('still allows dev in development and test — a fresh clone must run offline', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'test' })).not.toThrow();
  });
});

describe('validateEnv — 2Factor', () => {
  it('accepts a complete 2Factor configuration', () => {
    const env = validateEnv({ ...BASE, SMS_PROVIDER: '2factor', TWOFACTOR_API_KEY: 'k' });
    expect(env.SMS_PROVIDER).toBe('2factor');
    expect(env.TWOFACTOR_BASE_URL).toBe('https://2factor.in');
    expect(env.TWOFACTOR_NUMBER_FORMAT).toBe('e164');
    // Empty means "the account's default approved template", not "missing".
    expect(env.TWOFACTOR_TEMPLATE_NAME).toBe('');
  });

  it('refuses to boot without TWOFACTOR_API_KEY, naming it', () => {
    const err = caught(() => validateEnv({ ...BASE, SMS_PROVIDER: '2factor' }));
    expect(err!.message).toContain('TWOFACTOR_API_KEY');
    expect(err!.message).toMatch(/SMS_PROVIDER=2factor/);
  });

  it('does NOT demand Message Central credentials when 2factor is selected', () => {
    // Each provider is gated on its own variables only.
    expect(() =>
      validateEnv({ ...BASE, SMS_PROVIDER: '2factor', TWOFACTOR_API_KEY: 'k' }),
    ).not.toThrow();
  });

  it('does NOT demand a 2Factor key when Message Central is selected', () => {
    expect(() => validateEnv({ ...BASE, ...MC })).not.toThrow();
  });

  it('rejects an unknown number format', () => {
    const err = caught(() =>
      validateEnv({ ...BASE, SMS_PROVIDER: '2factor', TWOFACTOR_API_KEY: 'k', TWOFACTOR_NUMBER_FORMAT: 'plus91' }),
    );
    expect(err!.message).toContain('TWOFACTOR_NUMBER_FORMAT');
  });
});

describe('validateEnv — Twilio and Fast2SMS', () => {
  it('accepts a complete Twilio configuration', () => {
    const env = validateEnv({
      ...BASE, SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACxx',
      TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550001111',
    });
    expect(env.SMS_PROVIDER).toBe('twilio');
    expect(env.TWILIO_BASE_URL).toBe('https://api.twilio.com');
  });

  it('refuses Twilio without a SID, a token, or any sender — naming each', () => {
    const full: Record<string, string> = {
      ...BASE, SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACxx',
      TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550001111',
    };
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']) {
      const raw = { ...full };
      delete raw[key];
      expect(caught(() => validateEnv(raw))!.message).toContain(key);
    }
    const noSender = { ...full, TWILIO_FROM_NUMBER: '' };
    const err = caught(() => validateEnv(noSender));
    expect(err!.message).toContain('TWILIO_FROM_NUMBER');
    expect(err!.message).toContain('TWILIO_MESSAGING_SERVICE_SID');
  });

  it('accepts a Messaging Service in place of a from-number', () => {
    expect(() => validateEnv({
      ...BASE, SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACxx',
      TWILIO_AUTH_TOKEN: 'tok', TWILIO_MESSAGING_SERVICE_SID: 'MGxx',
    })).not.toThrow();
  });

  it('accepts a complete Fast2SMS configuration and refuses a missing key', () => {
    expect(validateEnv({ ...BASE, SMS_PROVIDER: 'fast2sms', FAST2SMS_API_KEY: 'k' }).SMS_PROVIDER)
      .toBe('fast2sms');
    expect(caught(() => validateEnv({ ...BASE, SMS_PROVIDER: 'fast2sms' }))!.message)
      .toContain('FAST2SMS_API_KEY');
  });

  it('gates each provider on ITS OWN variables only', () => {
    // A Fast2SMS key must not satisfy Twilio, and vice versa.
    expect(caught(() => validateEnv({ ...BASE, SMS_PROVIDER: 'twilio', FAST2SMS_API_KEY: 'k' })))
      .toBeDefined();
    expect(() => validateEnv({ ...BASE, SMS_PROVIDER: 'fast2sms', FAST2SMS_API_KEY: 'k' }))
      .not.toThrow();
  });
});

describe('isBase64 — the boot gate on a pasted credential', () => {
  it('accepts a properly padded value', () => {
    expect(isBase64(Buffer.from('password').toString('base64'))).toBe(true);
  });

  it('accepts an UNPADDED value — plenty of tools strip the "="', () => {
    const padded = Buffer.from('elevenchars').toString('base64');
    expect(padded.endsWith('=')).toBe(true);
    // Rejecting this would stop a configuration the provider would have accepted.
    expect(isBase64(padded.replace(/=+$/, ''))).toBe(true);
  });

  it('rejects a raw password containing a symbol or a space', () => {
    expect(isBase64('MyPassword2026!')).toBe(false);
    expect(isBase64('my password')).toBe(false);
  });

  it('rejects an impossible length', () => {
    expect(isBase64('YWJjZWY')).toBe(true); // 7 chars → valid unpadded
    expect(isBase64('YWJjZQ==Z')).toBe(false);
    expect(isBase64('')).toBe(false);
  });

  it('is honest about its limit: an all-alphanumeric password still passes', () => {
    // Documented, not a bug — nothing can tell these apart. The test records it so
    // nobody later mistakes this gate for proof the credential is correct.
    expect(isBase64('abcdefgh')).toBe(true); // 8 chars, all base-64 legal
    // The length and canonical-bits rules do catch many by luck, though:
    expect(isBase64('opspass123456')).toBe(false); // 13 chars — impossible length
    expect(isBase64('opspass1234567')).toBe(false); // non-canonical trailing bits
  });
});

describe('validateEnv — screenshot retention', () => {
  it('defaults to 90 days when nothing is set', () => {
    // The period is policy, so it has a default and lives in config — not a
    // number buried in the purge code where nobody can find or change it.
    expect(validateEnv({ ...BASE }).SCREENSHOT_RETENTION_DAYS).toBe(90);
  });

  it('takes an operator-set period', () => {
    expect(
      validateEnv({ ...BASE, SCREENSHOT_RETENTION_DAYS: '30' })
        .SCREENSHOT_RETENTION_DAYS,
    ).toBe(30);
  });

  it('REFUSES zero rather than reading it as "purge everything"', () => {
    // The zero trap, and it has bitten this codebase before: an empty payout cap
    // field stored a real zero and computed a ₹0.00 refund. A zero here would
    // mean every screenshot ever uploaded is expired the moment the cron runs,
    // including the one a reviewer has open. It must fail at boot, loudly.
    const err = caught(() =>
      validateEnv({ ...BASE, SCREENSHOT_RETENTION_DAYS: '0' }),
    );
    expect(err?.message).toMatch(/SCREENSHOT_RETENTION_DAYS/);
  });

  it('refuses a negative period and a non-number', () => {
    expect(
      caught(() => validateEnv({ ...BASE, SCREENSHOT_RETENTION_DAYS: '-1' })),
    ).toBeDefined();
    expect(
      caught(() =>
        validateEnv({ ...BASE, SCREENSHOT_RETENTION_DAYS: 'ninety' }),
      ),
    ).toBeDefined();
  });
});
