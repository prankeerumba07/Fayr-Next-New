import { Logger } from '@nestjs/common';
import { DevSmsSender } from './dev-sms-sender';
import { MessageCentralSmsSender } from './message-central-sms-sender';
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

describe('createSmsSender — the one boot line', () => {
  it('says the console sender is active and that no SMS is sent', () => {
    const lines = captureLogs();
    createSmsSender(cfg({ SMS_PROVIDER: 'dev' }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(BOOT_LINE.dev);
    expect(lines[0]).toMatch(/no SMS is sent/i);
  });

  it('says Message Central is active and that real texts will go out', () => {
    const lines = captureLogs();
    createSmsSender(cfg());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(BOOT_LINE.messagecentral);
    expect(lines[0]).toMatch(/real SMS/i);
  });

  it('says 2Factor is active and that real texts will go out', () => {
    const lines = captureLogs();
    createSmsSender(cfg({ SMS_PROVIDER: '2factor', TWOFACTOR_API_KEY: 'a-key-value' }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(BOOT_LINE['2factor']);
    expect(lines[0]).toMatch(/real SMS/i);
  });

  it('no two boot lines can be mistaken for one another', () => {
    const all = Object.values(BOOT_LINE);
    expect(new Set(all).size).toBe(all.length);
    expect(BOOT_LINE.dev).not.toMatch(/MESSAGE CENTRAL|2FACTOR/i);
    expect(BOOT_LINE.messagecentral).not.toMatch(/\bDEV\b|2FACTOR/);
    expect(BOOT_LINE['2factor']).not.toMatch(/\bDEV\b|MESSAGE CENTRAL/);
    // Every real sender must warn that texts are actually going out.
    for (const key of ['messagecentral', '2factor'] as const) {
      expect(BOOT_LINE[key]).toMatch(/real SMS/i);
    }
  });

  it('logs nothing at all when it refuses to boot — no half-truth in the terminal', () => {
    const lines = captureLogs();
    expect(() => createSmsSender(cfg({ MESSAGECENTRAL_CUSTOMER_ID: undefined }))).toThrow();
    expect(lines).toHaveLength(0);
  });
});
