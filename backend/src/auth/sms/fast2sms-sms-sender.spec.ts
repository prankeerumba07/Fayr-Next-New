import { Logger } from '@nestjs/common';
import { Fast2SmsSender } from './fast2sms-sms-sender';

/**
 * The Fast2SMS client, HTTP mocked. NOTHING here touches the live API.
 *
 * Their contract (docs verified 2026-08-19):
 *   GET/POST https://www.fast2sms.com/dev/bulkV2
 *   header: authorization: <api key>
 *   params: route=q, message=<our text>, numbers=<10 digits>
 *   success → {"return":true,"request_id":"lwdtp7cjyqxvfe9","message":["Message sent successfully"]}
 *
 * ⚠️ THE FAILURE BODY SHAPE IS NOT PUBLISHED. Their error-code LIST is (22 codes),
 * but no example failure body is documented anywhere we could find. So `return`
 * being exactly true is the ONLY thing treated as success, and every other shape —
 * including one we have never seen — is a failure. Getting this backwards is how a
 * failure gets reported as a success.
 */

const MOBILE = '+919876543210';
const CODE = '483920';
const KEY = 'Xy9AbCdEfGhIjKlMnOpQrStUvWxYz012345';

const ENV: Record<string, unknown> = {
  FAST2SMS_BASE_URL: 'https://www.fast2sms.com',
  FAST2SMS_API_KEY: KEY,
  FAST2SMS_COUNTRY_CODE: '91',
  FAST2SMS_TIMEOUT_MS: 15000,
};

const cfg = (over: Record<string, unknown> = {}) =>
  ({ get: (k: string) => ({ ...ENV, ...over })[k] }) as never;

const reply = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});

const OK = reply({
  return: true,
  request_id: 'lwdtp7cjyqxvfe9',
  message: ['Message sent successfully'],
});

let fetchMock: jest.Mock;
function build(over: Record<string, unknown> = {}) {
  fetchMock = jest.fn();
  global.fetch = fetchMock as never;
  return new Fast2SmsSender(cfg(over));
}
const call = () => fetchMock.mock.calls[0];
const sentForm = () => new URLSearchParams(String((call()[1] as { body: string }).body));

function captureLogs() {
  const lines: string[] = [];
  const grab = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(grab as never);
  }
  return lines;
}

describe('Fast2SmsSender — the request', () => {
  it('posts our own message on the Quick route with the national number', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(OK);
    await sender.sendOtp(MOBILE, CODE);

    expect(String(call()[0])).toBe('https://www.fast2sms.com/dev/bulkV2');
    const form = sentForm();
    // route=q is the Quick route: no DLT, random numeric sender.
    expect(form.get('route')).toBe('q');
    // They want 10 digits, not E.164 — the country code is not part of `numbers`.
    expect(form.get('numbers')).toBe('9876543210');
    expect(form.get('message')).toContain(CODE);
    expect(form.get('message')).toMatch(/Fayr/);
  });

  it('sends the key in a header, never in the URL or the body', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(OK);
    await sender.sendOtp(MOBILE, CODE);
    const init = call()[1] as { method: string; headers: Record<string, string> };
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(KEY);
    // A URL reaches logs and proxies; POST keeps the key out of it entirely.
    expect(String(call()[0])).not.toContain(KEY);
    expect(sentForm().get('authorization')).toBeNull();
  });

  it('refuses a number outside the configured country rather than mangling it', async () => {
    const sender = build();
    await expect(sender.sendOtp('+14155550123', CODE)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes an abort signal so a hung provider cannot hang the login', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(OK);
    await sender.sendOtp(MOBILE, CODE);
    expect((call()[1] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});

describe('Fast2SmsSender — only return:true is success', () => {
  it('accepts return:true', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(OK);
    await expect(sender.sendOtp(MOBILE, CODE)).resolves.toBeUndefined();
  });

  it('refuses return:false', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ return: false, status_code: 412, message: 'Invalid Authentication' }));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('refuses a MISSING return field — the shape we have never seen', async () => {
    // Their failure body is not documented. Anything that is not explicitly
    // return:true must fail, or an unknown shape silently counts as delivered.
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ status_code: 995, message: 'Spamming detected' }));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('refuses a truthy-but-not-true return value', async () => {
    for (const value of ['true', 1, 'yes']) {
      const sender = build();
      fetchMock.mockResolvedValueOnce(reply({ return: value, request_id: 'x' }));
      await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    }
  });

  it('refuses an unreadable body — the rule every sender shares', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply('<html>502</html>'));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('refuses an empty body', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply(''));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });
});

describe('Fast2SmsSender — every documented error is explained', () => {
  // Their published list, verbatim. The ones an OTP flow will actually meet get
  // words that name the fix; the rest are still logged with code and message.
  const DOCUMENTED: Array<[number, string]> = [
    [401, 'Sender ID Missing'],
    [402, 'Message Text Missing'],
    [403, 'Route Missing'],
    [404, 'Language Missing'],
    [405, 'Numbers Missing'],
    [406, 'Invalid Sender ID'],
    [407, 'Invalid words used in message'],
    [408, 'Invalid Route'],
    [409, 'Invalid Route Authentication'],
    [410, 'Invalid Language'],
    [411, 'Invalid Numbers'],
    [412, 'Invalid Authentication, Check Authorization Key'],
    [413, 'Invalid Authentication, Authorization Key Disabled'],
    [414, 'IP is blacklisted from Dev API section'],
    [415, 'Account Disabled'],
    [416, "You don't have sufficient wallet balance"],
    [417, 'Use english letters or change language to unicode'],
    [424, 'Invalid Message ID'],
    [425, 'Invalid Template'],
    [426, 'Invalid link used in variables'],
    [500, 'Template/Sender id blacklisted at DLT'],
    [990, "You're hitting old API. Refer updated documentation"],
    [995, 'Spamming detected (sending multiple SMS to same number is not allowed)'],
    [996, 'Before using OTP SMS API, complete KYC.'],
    [997, 'Only numeric variable_values is allowed in OTP route'],
    [998, 'Use DLT or Quick SMS route for sending Bulk SMS'],
    [999, 'Complete single transaction of minimum 100 INR in Fast2SMS wallet before using API'],
  ];

  it.each(DOCUMENTED)('refuses %i and logs something useful', async (code, message) => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ return: false, status_code: code, message }));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    const all = lines.join('\n');
    expect(all).toContain(String(code));
    expect(all.length).toBeGreaterThan(String(code).length + 10);
  });

  it('names the fix for the failures an OTP flow will actually meet', async () => {
    const cases: Array<[number, RegExp]> = [
      [412, /authorization key|FAST2SMS_API_KEY/i],
      [413, /disabled/i],
      [415, /account/i],
      [416, /balance|top up|credit/i],
      [995, /same number|too many|spam/i],
      [999, /100|wallet/i],
      [414, /blacklisted|IP/i],
    ];
    for (const [code, expected] of cases) {
      const lines = captureLogs();
      const sender = build();
      fetchMock.mockResolvedValueOnce(reply({ return: false, status_code: code, message: 'x' }));
      await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
      expect(lines.join('\n')).toMatch(expected);
      jest.restoreAllMocks();
    }
  });

  it('tells the USER the same plain sentence whatever the code was', async () => {
    for (const code of [412, 416, 995, 999]) {
      const sender = build();
      fetchMock.mockResolvedValueOnce(reply({ return: false, status_code: code, message: 'x' }));
      const err = await sender.sendOtp(MOBILE, CODE).catch((e: Error) => e);
      const shown = (err as { message: string }).message;
      expect(shown).not.toMatch(/fast2sms|wallet|balance|\d{3}|_/i);
      expect(shown).toMatch(/could not send/i);
      expect(shown).toMatch(/try again/i);
    }
  });
});

describe('Fast2SmsSender — never two codes for one request', () => {
  it('NEVER retries', async () => {
    for (const r of [reply({ return: false }, 500), reply({}, 429)]) {
      const sender = build();
      fetchMock.mockResolvedValueOnce(r);
      await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('does not retry a timeout', async () => {
    const sender = build();
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Fast2SmsSender — what it may say out loud', () => {
  it('never logs the API key, even when echoed back', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(
      reply({ return: false, status_code: 412, message: `bad key ${KEY}` }),
    );
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(lines.join('\n')).not.toContain(KEY);
  });

  it('never logs the code', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce(reply({ return: false, status_code: 407, message: `text was ${CODE}` }));
    await sender.sendOtp(MOBILE, CODE);
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(lines.join('\n')).not.toContain(CODE);
  });

  it('never logs a full phone number', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(OK);
    await sender.sendOtp(MOBILE, CODE);
    const all = lines.join('\n');
    expect(all).not.toContain('9876543210');
    expect(all).toContain('10');
  });
});
