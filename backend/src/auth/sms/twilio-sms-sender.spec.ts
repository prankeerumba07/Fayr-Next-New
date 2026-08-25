import { Logger } from '@nestjs/common';
import { TwilioSmsSender } from './twilio-sms-sender';

/**
 * The Twilio client, HTTP mocked. NOTHING here touches the live API.
 *
 * Their contract (docs verified 2026-08-19):
 *   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
 *   application/x-www-form-urlencoded, Basic auth AccountSid:AuthToken
 *   body: To, From, Body
 *   201 → {"sid":"SM…","status":"queued","error_code":null,…}
 *   4xx → {"code":21608,"message":"…","more_info":"…","status":400}
 *
 * The trial failures that matter, both real and both likely:
 *   21608 — the 'to' number is not in Verified Caller IDs
 *   21408 — Geo Permissions for the destination region are disabled
 */

const MOBILE = '+919876543210';
const CODE = '483920';
const SID = 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN = 'f0e9d8c7b6a5f0e9d8c7b6a5f0e9d8c7';

const ENV: Record<string, unknown> = {
  TWILIO_BASE_URL: 'https://api.twilio.com',
  TWILIO_ACCOUNT_SID: SID,
  TWILIO_AUTH_TOKEN: TOKEN,
  TWILIO_FROM_NUMBER: '+15550001111',
  TWILIO_MESSAGING_SERVICE_SID: '',
  TWILIO_COUNTRY_CODE: '91',
  TWILIO_TIMEOUT_MS: 15000,
};

const cfg = (over: Record<string, unknown> = {}) =>
  ({ get: (k: string) => ({ ...ENV, ...over })[k] }) as never;

const reply = (body: unknown, status = 201) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});

const QUEUED = reply({ sid: 'SM0123456789abcdef', status: 'queued', error_code: null });

let fetchMock: jest.Mock;
function build(over: Record<string, unknown> = {}) {
  fetchMock = jest.fn();
  global.fetch = fetchMock as never;
  return new TwilioSmsSender(cfg(over));
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

describe('TwilioSmsSender — the request', () => {
  it('posts our own body to Programmable Messaging, never Verify', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(QUEUED);
    await sender.sendOtp(MOBILE, CODE);

    expect(String(call()[0])).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
    );
    // Verify would generate and check its own code — refused for the same reason as
    // VerifyNow and AUTOGEN.
    expect(String(call()[0])).not.toMatch(/verify/i);
    const form = sentForm();
    expect(form.get('To')).toBe(MOBILE);
    expect(form.get('From')).toBe('+15550001111');
    expect(form.get('Body')).toContain(CODE);
    expect(form.get('Body')).toMatch(/Fayr/);
  });

  it('uses form encoding and POST, as their API requires', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(QUEUED);
    await sender.sendOtp(MOBILE, CODE);
    const init = call()[1] as { method: string; headers: Record<string, string> };
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('authenticates with Basic auth over the SID and token', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(QUEUED);
    await sender.sendOtp(MOBILE, CODE);
    const auth = (call()[1] as { headers: Record<string, string> }).headers.authorization;
    expect(auth.startsWith('Basic ')).toBe(true);
    expect(Buffer.from(auth.slice(6), 'base64').toString()).toBe(`${SID}:${TOKEN}`);
    // The credential must never be in the URL, where it would reach a log.
    expect(String(call()[0])).not.toContain(TOKEN);
  });

  it('prefers a Messaging Service over a from-number when one is set', async () => {
    const sender = build({ TWILIO_MESSAGING_SERVICE_SID: 'MGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    fetchMock.mockResolvedValueOnce(QUEUED);
    await sender.sendOtp(MOBILE, CODE);
    const form = sentForm();
    expect(form.get('MessagingServiceSid')).toBe('MGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    // Their API accepts one sender, not both.
    expect(form.get('From')).toBeNull();
  });

  it('refuses a number outside the configured country rather than mangling it', async () => {
    const sender = build();
    await expect(sender.sendOtp('+14155550123', CODE)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes an abort signal so a hung provider cannot hang the login', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(QUEUED);
    await sender.sendOtp(MOBILE, CODE);
    expect((call()[1] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});

describe('TwilioSmsSender — the two trial failures, said plainly', () => {
  it('explains 21608 as the number not being in Verified Caller IDs', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(
      reply({ code: 21608, message: 'The number is unverified.', status: 400 }, 400),
    );
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    const all = lines.join('\n');
    // On a trial this is the single most likely failure; a generic error wastes time.
    expect(all).toMatch(/Verified Caller ID/i);
    expect(all).toMatch(/not in|add/i);
  });

  it('explains 21408 as Geo Permissions being disabled for the region', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(
      reply({ code: 21408, message: 'Permission to send has not been enabled.', status: 400 }, 400),
    );
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    const all = lines.join('\n');
    expect(all).toMatch(/Geo Permissions/i);
    expect(all).toMatch(/India|region/i);
  });

  it('names the console page to fix each one', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ code: 21608, message: 'x', status: 400 }, 400));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(lines.join('\n')).toMatch(/console/i);
  });

  it('still reports an unrecognised Twilio code with its number and message', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(
      reply({ code: 21610, message: 'Attempt to send to unsubscribed recipient', status: 400 }, 400),
    );
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    const all = lines.join('\n');
    expect(all).toContain('21610');
    expect(all).toMatch(/unsubscribed/i);
  });

  it('tells the USER the same plain sentence regardless of which code it was', async () => {
    for (const code of [21608, 21408, 21610]) {
      const sender = build();
      fetchMock.mockResolvedValueOnce(reply({ code, message: 'x', status: 400 }, 400));
      const err = await sender.sendOtp(MOBILE, CODE).catch((e: Error) => e);
      const shown = (err as { message: string }).message;
      expect(shown).not.toMatch(/twilio|verified caller|geo|21\d{3}|_/i);
      expect(shown).toMatch(/could not send/i);
      expect(shown).toMatch(/try again/i);
    }
  });
});

describe('TwilioSmsSender — status is not trusted alone', () => {
  it('accepts a queued message', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(QUEUED);
    await expect(sender.sendOtp(MOBILE, CODE)).resolves.toBeUndefined();
  });

  it('accepts the other healthy statuses they document', async () => {
    for (const status of ['accepted', 'sending', 'sent']) {
      const sender = build();
      fetchMock.mockResolvedValueOnce(reply({ sid: 'SM1', status, error_code: null }));
      await expect(sender.sendOtp(MOBILE, CODE)).resolves.toBeUndefined();
    }
  });

  it('REFUSES a 201 whose message status is failed or undelivered', async () => {
    for (const status of ['failed', 'undelivered']) {
      const sender = build();
      fetchMock.mockResolvedValueOnce(reply({ sid: 'SM1', status, error_code: 30006 }));
      await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    }
  });

  it('REFUSES a 201 that carries an error_code', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ sid: 'SM1', status: 'queued', error_code: 21608 }));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('REFUSES an unreadable body — the rule every sender shares', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply('<html>502 Bad Gateway</html>', 200));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('REFUSES an empty body', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply('', 200));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('REFUSES a body with no status and no sid', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ ok: true }));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });
});

describe('TwilioSmsSender — never two codes for one request', () => {
  it('NEVER retries, whatever the failure', async () => {
    for (const r of [reply({ code: 500, message: 'x' }, 500), reply({}, 429)]) {
      const sender = build();
      fetchMock.mockResolvedValueOnce(r);
      await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('does not retry a timeout — the message may already be on its way', async () => {
    const sender = build();
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('TwilioSmsSender — what it may say out loud', () => {
  it('never logs the auth token', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(reply({ code: 20003, message: `bad auth ${TOKEN}` }, 401));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('never logs the code, on success or failure', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(QUEUED)
      .mockResolvedValueOnce(reply({ code: 21610, message: `body was ${CODE}` }, 400));
    await sender.sendOtp(MOBILE, CODE);
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(lines.join('\n')).not.toContain(CODE);
  });

  it('never logs a full phone number', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(QUEUED);
    await sender.sendOtp(MOBILE, CODE);
    const all = lines.join('\n');
    expect(all).not.toContain('9876543210');
    expect(all).toContain('10');
  });
});
