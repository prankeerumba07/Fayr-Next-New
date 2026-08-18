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
