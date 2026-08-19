import { Logger } from '@nestjs/common';
import { TwoFactorSmsSender } from './two-factor-sms-sender';

/**
 * The 2Factor client, HTTP mocked. NOTHING here touches the live API.
 *
 * Their contract, from their own docs and knowledge base:
 *   GET https://2factor.in/API/V1/{api_key}/SMS/{phone}/{otp}[/{template_name}]
 *   success → {"Status":"Success","Details":"<session id>"}
 *   failure → {"Status":"Error","Details":"Invalid API Key - No Account Exists"}
 *
 * The critical difference from Message Central: 2Factor reports failures with
 * Status:"Error" and NO documented HTTP status code, so HTTP 200 means nothing on
 * its own. `Status` is the only authority.
 */

const MOBILE = '+919876543210';
const CODE = '483920';
const KEY = 'a1b2c3d4-5e6f-11ee-be56-0242ac120002';

const ENV: Record<string, unknown> = {
  TWOFACTOR_BASE_URL: 'https://2factor.in',
  TWOFACTOR_API_KEY: KEY,
  TWOFACTOR_TEMPLATE_NAME: '',
  TWOFACTOR_COUNTRY_CODE: '91',
  TWOFACTOR_NUMBER_FORMAT: 'e164',
  TWOFACTOR_TIMEOUT_MS: 15000,
};

const cfg = (over: Record<string, unknown> = {}) =>
  ({ get: (k: string) => ({ ...ENV, ...over })[k] }) as never;

const reply = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});

const OK = reply({ Status: 'Success', Details: '5D6EBEE6-EC04-4776-846D' });

let fetchMock: jest.Mock;
function build(over: Record<string, unknown> = {}) {
  fetchMock = jest.fn();
  global.fetch = fetchMock as never;
  return new TwoFactorSmsSender(cfg(over));
}
const calledUrl = () => String(fetchMock.mock.calls[0][0]);

function captureLogs() {
  const lines: string[] = [];
  const grab = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(grab as never);
  }
  return lines;
}

describe('TwoFactorSmsSender — the request', () => {
  it('sends OUR code on the SMS route, never AUTOGEN', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(OK);
    await sender.sendOtp(MOBILE, CODE);

    const url = calledUrl();
    expect(url).toBe(`https://2factor.in/API/V1/${KEY}/SMS/${MOBILE}/${CODE}`);
    // AUTOGEN would have 2Factor invent the code, which would never match the hash
    // we stored — the same reason VerifyNow was rejected.
    expect(url).not.toContain('AUTOGEN');
  });

  it('appends a template name only when one is configured', async () => {
    const bare = build();
    fetchMock.mockResolvedValueOnce(OK);
    await bare.sendOtp(MOBILE, CODE);
    expect(calledUrl().endsWith(`/${CODE}`)).toBe(true);

    const templated = build({ TWOFACTOR_TEMPLATE_NAME: 'FayrLogin' });
    fetchMock.mockResolvedValueOnce(OK);
    await templated.sendOtp(MOBILE, CODE);
    expect(calledUrl()).toBe(`https://2factor.in/API/V1/${KEY}/SMS/${MOBILE}/${CODE}/FayrLogin`);
  });

  it('can send the national number instead, without a code change', async () => {
    // Their docs show +91XXXXXXXXXX, but plain 10-digit is widely used too. A knob
    // beats discovering which one this account wants from a 400.
    const sender = build({ TWOFACTOR_NUMBER_FORMAT: 'national' });
    fetchMock.mockResolvedValueOnce(OK);
    await sender.sendOtp(MOBILE, CODE);
    expect(calledUrl()).toBe(`https://2factor.in/API/V1/${KEY}/SMS/9876543210/${CODE}`);
  });

  it('passes an abort signal so a hung provider cannot hang the login', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(OK);
    await sender.sendOtp(MOBILE, CODE);
    expect((fetchMock.mock.calls[0][1] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a number outside the configured country rather than mangling it', async () => {
    const sender = build();
    await expect(sender.sendOtp('+14155550123', CODE)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TwoFactorSmsSender — Status is the only authority', () => {
  it('accepts Status:Success', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(OK);
    await expect(sender.sendOtp(MOBILE, CODE)).resolves.toBeUndefined();
  });

  it('REFUSES Status:Error even though the HTTP status is 200', async () => {
    // This is how every documented 2Factor failure arrives.
    const sender = build();
    fetchMock.mockResolvedValueOnce(
      reply({ Status: 'Error', Details: 'Invalid API Key - No Account Exists' }),
    );
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  for (const details of [
    'Access Denied - Account Disabled',
    'Access Denied - Account Expired',
    'Access Denied - Balance is too low',
    "Access Denied - Sender Id 'FAYRIN' not approved",
  ]) {
    it(`refuses their documented failure: ${details}`, async () => {
      const sender = build();
      fetchMock.mockResolvedValueOnce(reply({ Status: 'Error', Details: details }));
      await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    });
  }

  it('refuses a body with no Status field at all', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ Details: 'something' }));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('refuses an UNREADABLE body — same rule as every other sender', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply('<html>gateway timeout</html>'));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('refuses an empty body', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply(''));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('logs the provider Details so a failure is diagnosable', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(
      reply({ Status: 'Error', Details: 'Access Denied - Balance is too low' }),
    );
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(lines.join('\n')).toContain('Balance is too low');
  });
});

describe('TwoFactorSmsSender — never two codes for one request', () => {
  it('NEVER retries — there is no token to refresh, so no retry can be safe', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ Status: 'Error', Details: 'x' }, 500));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a timeout — the message may already be on its way', async () => {
    const sender = build();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValueOnce(abort);
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('TwoFactorSmsSender — what it may say out loud', () => {
  it('never logs the code, on success or failure', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce(reply({ Status: 'Error', Details: `bad otp ${CODE}` }));
    await sender.sendOtp(MOBILE, CODE);
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(lines.join('\n')).not.toContain(CODE);
  });

  it('never logs the API KEY, which travels in the URL path', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ Status: 'Error', Details: 'nope' }, 500));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(lines.join('\n')).not.toContain(KEY);
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

  it('tells the user the same plain sentence as every other sender', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ Status: 'Error', Details: 'Invalid API Key' }));
    const err = await sender.sendOtp(MOBILE, CODE).catch((e: Error) => e);
    const shown = (err as { message: string }).message;
    expect(shown).not.toMatch(/2factor|api key|500|Invalid|_/i);
    expect(shown).toMatch(/could not send/i);
    expect(shown).toMatch(/try again/i);
  });
});
