import { Logger } from '@nestjs/common';
import { MessageCentralSmsSender } from './message-central-sms-sender';

/**
 * The Message Central client, with the HTTP layer mocked. NOTHING here touches
 * the live API.
 *
 * The request shape is asserted literally, because it was built from docs with a
 * known error in them (the documented token response is a copy-paste of the send
 * response and contains no token field). If the real console disagrees with what
 * is asserted here, THIS is the file that says what we actually send.
 */

const MOBILE = '+919876543210';
const CODE = '483920';
const BASE = 'https://cpaas.messagecentral.com';

const ENV: Record<string, unknown> = {
  MESSAGECENTRAL_BASE_URL: BASE,
  MESSAGECENTRAL_CUSTOMER_ID: 'C-TEST0001',
  MESSAGECENTRAL_PASSWORD_BASE64: 'cGFzc3dvcmQ=',
  MESSAGECENTRAL_EMAIL: 'dev@example.com',
  MESSAGECENTRAL_SENDER_ID: 'EXAMPL',
  MESSAGECENTRAL_COUNTRY_CODE: '91',
  MESSAGECENTRAL_MESSAGE_TYPE: 'TRANSACTION',
  MESSAGECENTRAL_TIMEOUT_MS: 15000,
  MESSAGECENTRAL_TOKEN_TTL_MINUTES: 30,
};

const config = { get: (k: string) => ENV[k] } as never;

const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});

const TOKEN_OK = json({ status: 200, token: 'jwt-token-1' });
const TOKEN_OK_2 = json({ status: 200, token: 'jwt-token-2' });
const SEND_OK = json({
  responseCode: 200,
  message: 'SUCCESS',
  data: { transactionId: 'abc-123', errorMessage: null },
});

let fetchMock: jest.Mock;
function build() {
  fetchMock = jest.fn();
  global.fetch = fetchMock as never;
  return new MessageCentralSmsSender(config);
}

const urlOf = (call: unknown[]) => String(call[0]);
const tokenCalls = () => fetchMock.mock.calls.filter((c) => urlOf(c).includes('/auth/v1/'));
const sendCalls = () => fetchMock.mock.calls.filter((c) => urlOf(c).includes('/verification/v3/send'));

describe('MessageCentralSmsSender — the request we actually send', () => {
  it('asks for a token with customerId, base-64 key, scope=NEW, country and email', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(SEND_OK);
    await sender.sendOtp(MOBILE, CODE);

    const url = new URL(urlOf(tokenCalls()[0]));
    expect(url.origin + url.pathname).toBe(`${BASE}/auth/v1/authentication/token`);
    expect(url.searchParams.get('customerId')).toBe('C-TEST0001');
    expect(url.searchParams.get('key')).toBe('cGFzc3dvcmQ=');
    expect(url.searchParams.get('scope')).toBe('NEW');
    expect(url.searchParams.get('country')).toBe('91');
    expect(url.searchParams.get('email')).toBe('dev@example.com');
    expect(tokenCalls()[0][1]).toMatchObject({ method: 'GET' });
  });

  it('sends via MessageNow: our own message text, type=SMS, split country code', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(SEND_OK);
    await sender.sendOtp(MOBILE, CODE);

    const call = sendCalls()[0];
    const url = new URL(urlOf(call));
    expect(url.origin + url.pathname).toBe(`${BASE}/verification/v3/send`);
    expect(url.searchParams.get('flowType')).toBe('SMS');
    expect(url.searchParams.get('type')).toBe('SMS');
    // The E.164 number is split: the provider wants them as separate params.
    expect(url.searchParams.get('countryCode')).toBe('91');
    expect(url.searchParams.get('mobileNumber')).toBe('9876543210');
    expect(url.searchParams.get('senderId')).toBe('EXAMPL');
    expect(url.searchParams.get('messageType')).toBe('TRANSACTION');
    // OUR text, carrying OUR code — this is what makes it a transport and keeps
    // the lock/cooldown in AuthService authoritative.
    expect(url.searchParams.get('message')).toContain(CODE);
    expect(url.searchParams.get('message')).toMatch(/Fayr/);
    expect((call[1] as { method: string }).method).toBe('POST');
    expect((call[1] as { headers: Record<string, string> }).headers.authToken).toBe('jwt-token-1');
  });

  it('accepts a token at data.token too, because the published shape is inconsistent', async () => {
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(json({ data: { token: 'nested-token' } }))
      .mockResolvedValueOnce(SEND_OK);
    await sender.sendOtp(MOBILE, CODE);
    expect((sendCalls()[0][1] as { headers: Record<string, string> }).headers.authToken).toBe(
      'nested-token',
    );
  });

  it('refuses a token response with no token at all rather than sending without one', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(json({ responseCode: 200, message: 'SUCCESS' }));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(sendCalls()).toHaveLength(0);
  });
});

describe('MessageCentralSmsSender — token caching', () => {
  it('fetches one token and reuses it across sends', async () => {
    const sender = build();
    fetchMock.mockResolvedValue(SEND_OK).mockResolvedValueOnce(TOKEN_OK);
    await sender.sendOtp(MOBILE, CODE);
    await sender.sendOtp(MOBILE, '111222');
    expect(tokenCalls()).toHaveLength(1);
    expect(sendCalls()).toHaveLength(2);
  });

  it('refreshes the token once its cache lifetime has passed', async () => {
    jest.useFakeTimers();
    try {
      const sender = build();
      fetchMock.mockResolvedValue(SEND_OK).mockResolvedValueOnce(TOKEN_OK);
      await sender.sendOtp(MOBILE, CODE);

      jest.advanceTimersByTime(31 * 60 * 1000); // past MESSAGECENTRAL_TOKEN_TTL_MINUTES
      fetchMock.mockResolvedValueOnce(TOKEN_OK_2).mockResolvedValueOnce(SEND_OK);
      await sender.sendOtp(MOBILE, '111222');

      expect(tokenCalls()).toHaveLength(2);
      expect((sendCalls()[1][1] as { headers: Record<string, string> }).headers.authToken).toBe(
        'jwt-token-2',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-authenticates and retries ONCE when a cached token is rejected', async () => {
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce(json({ message: 'token expired' }, 401))
      .mockResolvedValueOnce(TOKEN_OK_2)
      .mockResolvedValueOnce(SEND_OK);

    await sender.sendOtp(MOBILE, CODE);
    // Safe to repeat: a 401 means the provider REJECTED the request, so nothing
    // was delivered and the user cannot receive two different codes.
    expect(sendCalls()).toHaveLength(2);
    expect(tokenCalls()).toHaveLength(2);
  });

  it('does not loop: a second auth rejection fails instead of retrying again', async () => {
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(TOKEN_OK_2)
      .mockResolvedValueOnce(json({}, 401));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(sendCalls()).toHaveLength(2);
  });
});

describe('MessageCentralSmsSender — never deliver two codes for one request', () => {
  it('does NOT retry a server error', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(json({}, 500));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(sendCalls()).toHaveLength(1);
  });

  it('does NOT retry a timeout — the message may already be on its way', async () => {
    const sender = build();
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockRejectedValueOnce(abort);
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(sendCalls()).toHaveLength(1);
  });

  it('passes an abort signal so a hung provider cannot hang the login request', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(SEND_OK);
    await sender.sendOtp(MOBILE, CODE);
    expect((sendCalls()[0][1] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  it('treats an errorMessage in a 200 body as a failure, not a success', async () => {
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce(
        json({ responseCode: 200, data: { errorMessage: 'INVALID_SENDER_ID' } }),
      );
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('treats an UNPARSEABLE 200 body as a failure, not a success', async () => {
    // The exact hole an adversarial review found: both halves of the success guard
    // read body.json, which is null when parsing fails — and `undefined != null` is
    // FALSE, so the second half short-circuits before it ever compares. A gateway
    // HTML page or a plain-text "Success" counted as delivered, with no trace: the
    // provider-reference line only logs when a transactionId is present.
    const sender = build();
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html><body>Service temporarily unavailable</body></html>'),
    });
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('treats a plain-text 200 body as a failure too', async () => {
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('Success') });
    // Even a body that SAYS success: we cannot read a delivery id out of it, so we
    // must not claim the code is on its way.
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('treats an empty 200 body as a failure', async () => {
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('') });
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
  });

  it('leaves a trace when it refuses an unreadable body — never silent', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(((...a: unknown[]) => {
        lines.push(a.map(String).join(' '));
      }) as never);
    }
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('<html>nope</html>') });
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    const all = lines.join('\n');
    expect(all).toMatch(/could not be read as JSON/i);
    expect(all).not.toContain(CODE);
    // And it must NOT claim the code was sent.
    expect(all).not.toMatch(/code sent/);
  });

  it('a missing responseCode with a valid body is still accepted', async () => {
    // Not every documented response carries responseCode; a readable JSON body with
    // no error must stay a success, or a working provider looks broken.
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce(json({ message: 'SUCCESS', data: { transactionId: 'x-1' } }));
    await expect(sender.sendOtp(MOBILE, CODE)).resolves.toBeUndefined();
  });

  it('refuses a number outside the configured country rather than mangling it', async () => {
    const sender = build();
    fetchMock.mockResolvedValue(SEND_OK);
    await expect(sender.sendOtp('+14155550123', CODE)).rejects.toThrow();
    expect(sendCalls()).toHaveLength(0);
  });
});

describe('MessageCentralSmsSender — what it is allowed to say out loud', () => {
  /** Capture everything the sender logs, at every level. */
  function captureLogs() {
    const lines: string[] = [];
    const grab = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(grab as never);
    }
    return lines;
  }

  it('never logs the code on success', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(SEND_OK);
    await sender.sendOtp(MOBILE, CODE);
    expect(lines.join('\n')).not.toContain(CODE);
  });

  it('never logs the code on failure, even when the provider echoes it back', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce(json({ error: `rejected message: Your Fayr code is ${CODE}` }, 400));
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    expect(lines.join('\n')).not.toContain(CODE);
  });

  it('never logs a full phone number, on either path', async () => {
    const lines = captureLogs();
    const sender = build();
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK)
      .mockResolvedValueOnce(SEND_OK)
      .mockResolvedValueOnce(json({ mobileNumber: '9876543210' }, 500));
    await sender.sendOtp(MOBILE, CODE);
    await expect(sender.sendOtp(MOBILE, CODE)).rejects.toThrow();
    const all = lines.join('\n');
    expect(all).not.toContain('9876543210');
    expect(all).not.toContain('+919876543210');
    expect(all).toContain('10'); // masked tail kept, so support can still match it
  });

  it('tells the user something plain, with no provider name, status code or enum', async () => {
    const sender = build();
    fetchMock.mockResolvedValueOnce(TOKEN_OK).mockResolvedValueOnce(json({}, 500));
    const err = await sender.sendOtp(MOBILE, CODE).catch((e: Error) => e);
    const shown = (err as { message: string }).message;
    expect(shown).not.toMatch(/message ?central|cpaas|500|4\d\d|INVALID_|_/i);
    expect(shown).toMatch(/could not send|couldn't send/i);
    expect(shown).toMatch(/try again/i);
  });
});
