import { Logger } from '@nestjs/common';
import { DevSmsSender } from './dev-sms-sender';
import { MessageCentralSmsSender } from './message-central-sms-sender';
import { Fast2SmsSender } from './fast2sms-sms-sender';
import { TwilioSmsSender } from './twilio-sms-sender';
import { TwoFactorSmsSender } from './two-factor-sms-sender';
import { BOOT_LINE, createSmsSender } from './sms.provider';

/**
 * Which postman is live.
 *
 * The dangerous failure here is not a crash — it is a SILENT FALLBACK: believing
 * real texts are going out during a demo when the console sender is active. So a
 * named provider with broken credentials must refuse to boot, and the active
 * sender must announce itself in exactly one line.
 */

const FULL: Record<string, unknown> = {
  SMS_PROVIDER: 'messagecentral',
  MESSAGECENTRAL_BASE_URL: 'https://cpaas.messagecentral.com',
  MESSAGECENTRAL_CUSTOMER_ID: 'C-TEST0001',
  MESSAGECENTRAL_PASSWORD_BASE64: 'cGFzc3dvcmQ=',
  MESSAGECENTRAL_EMAIL: 'dev@example.com',
  MESSAGECENTRAL_SENDER_ID: 'EXAMPL',
  MESSAGECENTRAL_COUNTRY_CODE: '91',
  MESSAGECENTRAL_MESSAGE_TYPE: 'TRANSACTION',
  MESSAGECENTRAL_TIMEOUT_MS: 15000,
  MESSAGECENTRAL_TOKEN_TTL_MINUTES: 30,
  TWILIO_BASE_URL: 'https://api.twilio.com',
  TWILIO_FROM_NUMBER: '',
  TWILIO_MESSAGING_SERVICE_SID: '',
  TWILIO_COUNTRY_CODE: '91',
  TWILIO_TIMEOUT_MS: 15000,
  FAST2SMS_BASE_URL: 'https://www.fast2sms.com',
  FAST2SMS_COUNTRY_CODE: '91',
  FAST2SMS_TIMEOUT_MS: 15000,
};

const cfg = (over: Record<string, unknown> = {}) =>
  ({ get: (k: string) => ({ ...FULL, ...over })[k] }) as never;

function captureLogs() {
  const lines: string[] = [];
  const grab = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(grab as never);
  }
  return lines;
}

/** Run `fn` and return whatever it threw, so a test can inspect the message. */
const caught = (fn: () => unknown): Error | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e as Error;
  }
};

describe('createSmsSender — selection', () => {
  it('defaults to the console sender when SMS_PROVIDER is unset', () => {
    expect(createSmsSender(cfg({ SMS_PROVIDER: undefined }))).toBeInstanceOf(DevSmsSender);
  });

  it("uses the console sender for 'dev'", () => {
    expect(createSmsSender(cfg({ SMS_PROVIDER: 'dev' }))).toBeInstanceOf(DevSmsSender);
  });

  it('works with NO credentials present at all, so a fresh clone runs offline', () => {
    const bare = { get: (k: string) => (k === 'SMS_PROVIDER' ? 'dev' : undefined) } as never;
    expect(createSmsSender(bare)).toBeInstanceOf(DevSmsSender);
  });

  it("uses Message Central for 'messagecentral'", () => {
    expect(createSmsSender(cfg())).toBeInstanceOf(MessageCentralSmsSender);
  });

  it("uses 2Factor for '2factor'", () => {
    expect(
      createSmsSender(cfg({ SMS_PROVIDER: '2factor', TWOFACTOR_API_KEY: 'a-key-value' })),
    ).toBeInstanceOf(TwoFactorSmsSender);
  });

  it('refuses to boot for 2factor with no API key, naming the variable', () => {
    expect(() => createSmsSender(cfg({ SMS_PROVIDER: '2factor' }))).toThrow('TWOFACTOR_API_KEY');
    expect(() =>
      createSmsSender(cfg({ SMS_PROVIDER: '2factor', TWOFACTOR_API_KEY: '  ' })),
    ).toThrow('TWOFACTOR_API_KEY');
  });

  it('never hands back a dev sender when 2factor is misconfigured', () => {
    let made: unknown = null;
    try { made = createSmsSender(cfg({ SMS_PROVIDER: '2factor' })); } catch { /* expected */ }
    expect(made).toBeNull();
  });

  it("uses Twilio for 'twilio'", () => {
    expect(
      createSmsSender(cfg({
        SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'ACxx',
        TWILIO_AUTH_TOKEN: 'tok',
        TWILIO_FROM_NUMBER: '+15550001111',
      })),
    ).toBeInstanceOf(TwilioSmsSender);
  });

  it('refuses to boot for twilio without a SID or token, naming the variable', () => {
    const base = { SMS_PROVIDER: 'twilio', TWILIO_FROM_NUMBER: '+15550001111' };
    expect(() => createSmsSender(cfg({ ...base, TWILIO_AUTH_TOKEN: 'tok' })))
      .toThrow('TWILIO_ACCOUNT_SID');
    expect(() => createSmsSender(cfg({ ...base, TWILIO_ACCOUNT_SID: 'ACxx' })))
      .toThrow('TWILIO_AUTH_TOKEN');
  });

  it('refuses to boot for twilio with no sender at all, naming both options', () => {
    const err = caught(() => createSmsSender(cfg({
      SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACxx', TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM_NUMBER: '', TWILIO_MESSAGING_SERVICE_SID: '',
    })));
    expect(err!.message).toContain('TWILIO_FROM_NUMBER');
    expect(err!.message).toContain('TWILIO_MESSAGING_SERVICE_SID');
  });

  it('accepts a Messaging Service instead of a from-number', () => {
    expect(() => createSmsSender(cfg({
      SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACxx', TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM_NUMBER: '', TWILIO_MESSAGING_SERVICE_SID: 'MGxx',
    }))).not.toThrow();
  });

  it("uses Fast2SMS for 'fast2sms'", () => {
    expect(createSmsSender(cfg({ SMS_PROVIDER: 'fast2sms', FAST2SMS_API_KEY: 'k' })))
      .toBeInstanceOf(Fast2SmsSender);
  });

  it('refuses to boot for fast2sms with no API key, naming the variable', () => {
    expect(() => createSmsSender(cfg({ SMS_PROVIDER: 'fast2sms' }))).toThrow('FAST2SMS_API_KEY');
    expect(() => createSmsSender(cfg({ SMS_PROVIDER: 'fast2sms', FAST2SMS_API_KEY: ' ' })))
      .toThrow('FAST2SMS_API_KEY');
  });

  it('THROWS on an unknown provider name — never falls back to dev', () => {
    expect(() => createSmsSender(cfg({ SMS_PROVIDER: 'msg91' }))).toThrow(/msg91/);
  });

  it('names the accepted values when it rejects one, so a typo is self-explaining', () => {
    const err = caught(() => createSmsSender(cfg({ SMS_PROVIDER: 'messagecentrall' })));
    expect(err?.message).toMatch(/dev/);
    expect(err?.message).toMatch(/messagecentral/);
  });
});

describe('createSmsSender — refuse to boot on incomplete credentials', () => {
  for (const missing of [
    'MESSAGECENTRAL_CUSTOMER_ID',
    'MESSAGECENTRAL_PASSWORD_BASE64',
    'MESSAGECENTRAL_EMAIL',
  ]) {
    it(`refuses to boot when ${missing} is absent, naming it`, () => {
      expect(() => createSmsSender(cfg({ [missing]: undefined }))).toThrow(missing);
    });

    it(`refuses to boot when ${missing} is blank, naming it`, () => {
      expect(() => createSmsSender(cfg({ [missing]: '   ' }))).toThrow(missing);
    });
  }

  it('refuses a password that is not valid base 64, naming the variable', () => {
    expect(() => createSmsSender(cfg({ MESSAGECENTRAL_PASSWORD_BASE64: 'not base64!!' }))).toThrow(
      /MESSAGECENTRAL_PASSWORD_BASE64/,
    );
  });

  it('never returns a dev sender as a consolation prize', () => {
    for (const over of [
      { MESSAGECENTRAL_CUSTOMER_ID: undefined },
      { MESSAGECENTRAL_EMAIL: '' },
      { MESSAGECENTRAL_PASSWORD_BASE64: '%%%' },
    ]) {
      let made: unknown = null;
      try { made = createSmsSender(cfg(over)); } catch { /* expected */ }
      expect(made).toBeNull();
    }
  });
});

describe('createSmsSender — SMS_MUST_BE_REAL, the per-copy latch', () => {
  // The hole every other guard leaves open: 'dev' is the DEFAULT value of
  // SMS_PROVIDER, and a laptop being used to text a real handset is not
  // production, so nothing above refuses it. On a copy with the latch on, the
  // console sender must stop the boot rather than quietly print live codes.

  it('refuses the console sender even outside production', () => {
    const err = caught(() =>
      createSmsSender(cfg({ SMS_MUST_BE_REAL: true, SMS_PROVIDER: 'dev' })),
    );
    expect(err).toBeDefined();
    expect(err!.message).toContain('SMS_MUST_BE_REAL');
  });

  it('refuses an ABSENT provider too, because absent means dev', () => {
    // This is the whole point of the latch. Deleting the line is the mistake.
    const err = caught(() =>
      createSmsSender(cfg({ SMS_MUST_BE_REAL: true, SMS_PROVIDER: undefined })),
    );
    expect(err).toBeDefined();
    expect(err!.message).toContain('absent means dev');
  });

  it('names the real providers to use instead, and does not offer dev', () => {
    const err = caught(() =>
      createSmsSender(cfg({ SMS_MUST_BE_REAL: true, SMS_PROVIDER: 'dev' })),
    );
    expect(err!.message).toContain('twilio');
    // "one of: messagecentral, 2factor, twilio, fast2sms" — dev must not be in
    // the list a person is told to choose from.
    const list = err!.message.split('one of: ')[1] ?? '';
    expect(list).not.toContain('dev');
  });

  it('says where to turn it off, so nobody has to guess', () => {
    const err = caught(() =>
      createSmsSender(cfg({ SMS_MUST_BE_REAL: true, SMS_PROVIDER: 'dev' })),
    );
    expect(err!.message).toContain('backend/.env');
  });

  it('logs nothing when it refuses — no line claiming a sender is active', () => {
    const lines = captureLogs();
    expect(() =>
      createSmsSender(cfg({ SMS_MUST_BE_REAL: true, SMS_PROVIDER: 'dev' })),
    ).toThrow();
    expect(lines).toHaveLength(0);
  });

  it('lets a real provider through, and still announces it in one line', () => {
    const lines = captureLogs();
    const sender = createSmsSender(cfg({
      SMS_MUST_BE_REAL: true,
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'ACxx',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM_NUMBER: '+15550001111',
    }));
    expect(sender).toBeInstanceOf(TwilioSmsSender);
    expect(lines).toEqual([BOOT_LINE.twilio]);
  });

  it('changes nothing at all when it is off', () => {
    // Off is the default, and a fresh clone with no vendor account must still run.
    for (const off of [false, undefined]) {
      expect(createSmsSender(cfg({ SMS_MUST_BE_REAL: off, SMS_PROVIDER: 'dev' })))
        .toBeInstanceOf(DevSmsSender);
    }
  });

  it('is only ever true, never a string that looks true', () => {
    // The setting arrives already turned into a real boolean by the env schema.
    // A raw string reaching here would mean the schema was bypassed, and 'false'
    // as a string is truthy, which is exactly the wrong way for this to fail.
    expect(createSmsSender(cfg({ SMS_MUST_BE_REAL: 'false', SMS_PROVIDER: 'dev' })))
      .toBeInstanceOf(DevSmsSender);
  });
});

describe('createSmsSender — the console sender is refused in production', () => {
  it('throws for dev under NODE_ENV=production', () => {
    expect(() => createSmsSender(cfg({ NODE_ENV: 'production', SMS_PROVIDER: 'dev' })))
      .toThrow(/production/i);
  });

  it('throws for an absent provider under NODE_ENV=production', () => {
    expect(() => createSmsSender(cfg({ NODE_ENV: 'production', SMS_PROVIDER: undefined })))
      .toThrow(/SMS_PROVIDER/);
  });

  it('logs nothing when it refuses — no line claiming a sender is active', () => {
    const lines = captureLogs();
    expect(() => createSmsSender(cfg({ NODE_ENV: 'production', SMS_PROVIDER: 'dev' }))).toThrow();
    expect(lines).toHaveLength(0);
  });

  it('allows a real provider in production', () => {
    expect(
      createSmsSender(cfg({ NODE_ENV: 'production', SMS_PROVIDER: '2factor', TWOFACTOR_API_KEY: 'k' })),
    ).toBeInstanceOf(TwoFactorSmsSender);
  });

  it('warns when real credentials sit beside SMS_PROVIDER=dev', () => {
    // The realistic mistake: credentials filled in, the provider line left at dev.
    // Not fatal outside production, but it must not pass in silence.
    const lines = captureLogs();
    createSmsSender(cfg({ SMS_PROVIDER: 'dev', TWOFACTOR_API_KEY: 'a-real-looking-key' }));
    expect(lines.join('\n')).toMatch(/credentials|configured/i);
  });
});

describe('createSmsSender — the one boot line', () => {
  /** The boot lines only — other diagnostics may legitimately share the terminal. */
  const bootLines = (lines: string[]) => lines.filter((l) => l.startsWith('Active sender:'));

  it('says the console sender is active and that no SMS is sent', () => {
    const lines = captureLogs();
    createSmsSender(cfg({ SMS_PROVIDER: 'dev' }));
    // Exactly ONE boot line, always — that line is the operator's only reliable
    // signal about which postman is live.
    expect(bootLines(lines)).toEqual([BOOT_LINE.dev]);
    expect(BOOT_LINE.dev).toMatch(/no SMS is sent/i);
  });

  it('says Message Central is active and that real texts will go out', () => {
    const lines = captureLogs();
    createSmsSender(cfg());
    expect(bootLines(lines)).toEqual([BOOT_LINE.messagecentral]);
    expect(BOOT_LINE.messagecentral).toMatch(/real SMS/i);
  });

  it('says 2Factor is active and that real texts will go out', () => {
    const lines = captureLogs();
    createSmsSender(cfg({ SMS_PROVIDER: '2factor', TWOFACTOR_API_KEY: 'a-key-value' }));
    expect(bootLines(lines)).toEqual([BOOT_LINE['2factor']]);
    expect(BOOT_LINE['2factor']).toMatch(/real SMS/i);
  });

  it('no two boot lines can be mistaken for one another', () => {
    const all = Object.values(BOOT_LINE);
    expect(new Set(all).size).toBe(all.length);
    expect(BOOT_LINE.dev).not.toMatch(/MESSAGE CENTRAL|2FACTOR/i);
    expect(BOOT_LINE.messagecentral).not.toMatch(/\bDEV\b|2FACTOR/);
    expect(BOOT_LINE['2factor']).not.toMatch(/\bDEV\b|MESSAGE CENTRAL/);
    // Every real sender must warn that texts are actually going out.
    for (const key of ['messagecentral', '2factor', 'twilio', 'fast2sms'] as const) {
      expect(BOOT_LINE[key]).toMatch(/real SMS/i);
    }
  });

  it('logs nothing at all when it refuses to boot — no half-truth in the terminal', () => {
    const lines = captureLogs();
    expect(() => createSmsSender(cfg({ MESSAGECENTRAL_CUSTOMER_ID: undefined }))).toThrow();
    expect(lines).toHaveLength(0);
  });
});
