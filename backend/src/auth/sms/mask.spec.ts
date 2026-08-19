import { maskMobile, scrubForLog, scrubUrlForLog } from './mask';

/**
 * A login code and a phone number are both credentials. Neither may reach a log
 * file, a crash report, or a support ticket — and the easiest way to leak one is
 * to log a provider's error body verbatim, because providers echo the request
 * back.
 */
describe('maskMobile', () => {
  it('keeps only the last two digits', () => {
    expect(maskMobile('+919876543210')).toBe('+**********10');
  });

  it('preserves the shape so a number is still recognisable, without leaking it', () => {
    const masked = maskMobile('+919876543210');
    expect(masked).toHaveLength('+919876543210'.length);
    expect(masked).not.toContain('9876543');
  });

  it('masks a short number ENTIRELY rather than leaking most of it', () => {
    // Two digits would be the whole number: never emit it.
    expect(maskMobile('12')).toBe('**');
    expect(maskMobile('7')).toBe('*');
  });

  it('never returns the input unchanged, whatever it is given', () => {
    for (const input of ['+919876543210', '9876543210', '12345', '99']) {
      expect(maskMobile(input)).not.toBe(input);
    }
  });

  it('degrades to a phrase rather than "undefined"', () => {
    expect(maskMobile('')).toBe('(no number)');
    expect(maskMobile(undefined as unknown as string)).toBe('(no number)');
  });
});

describe('scrubForLog', () => {
  it('removes a six-digit login code from a provider error body', () => {
    const body = '{"error":"bad template","message":"Your Fayr code is 483920."}';
    const out = scrubForLog(body);
    expect(out).not.toContain('483920');
  });

  it('masks an echoed phone number but keeps the last two digits for diagnosis', () => {
    const out = scrubForLog('{"mobileNumber":"9876543210"}');
    expect(out).not.toContain('9876543210');
    expect(out).toContain('10');
  });

  it('leaves short numbers like status codes readable', () => {
    expect(scrubForLog('HTTP 503 after 2 tries')).toBe('HTTP 503 after 2 tries');
  });

  it('scrubs every occurrence, not just the first', () => {
    const out = scrubForLog('code 111111 resent as 222222');
    expect(out).not.toContain('111111');
    expect(out).not.toContain('222222');
  });

  it('handles a non-string safely', () => {
    expect(scrubForLog(undefined as unknown as string)).toBe('');
  });
});

describe('scrubUrlForLog', () => {
  const SEND =
    'https://cpaas.messagecentral.com/verification/v3/send?countryCode=91'
    + '&mobileNumber=9876543210&message=483920%20is%20your%20Fayr%20code.&senderId=FAYRIN';
  const TOKEN =
    'https://cpaas.messagecentral.com/auth/v1/authentication/token'
    + '?customerId=C-0001&key=cGFzc3dvcmQ=&scope=NEW&country=91&email=dev@example.com';

  it('removes the login code, which travels in the query string', () => {
    expect(scrubUrlForLog(SEND)).not.toContain('483920');
  });

  it('removes the base-64 password entirely — not masked, GONE', () => {
    const out = scrubUrlForLog(TOKEN);
    expect(out).not.toContain('cGFzc3dvcmQ=');
    // A masked password would still leak its length; the value must not appear.
    expect(out).toMatch(/key=\(hidden\)/);
  });

  it('masks the phone number but keeps the last two digits', () => {
    const out = scrubUrlForLog(SEND);
    expect(out).not.toContain('9876543210');
    expect(out).toContain('10');
  });

  it('keeps the parts that make a failure diagnosable', () => {
    const out = scrubUrlForLog(SEND);
    expect(out).toContain('/verification/v3/send');
    expect(out).toContain('countryCode=91');
    expect(out).toContain('senderId=FAYRIN');
  });

  it('hides the whole message parameter, not just its digits', () => {
    // "is your Fayr code" is harmless, but the parameter is where the secret
    // lives — treat the entire value as secret rather than trusting a digit rule.
    expect(scrubUrlForLog(SEND)).toMatch(/message=\(hidden\)/);
  });

  it('does not throw on a string that is not a URL', () => {
    expect(scrubUrlForLog('not a url at all')).toBe('not a url at all');
    expect(scrubUrlForLog(undefined as unknown as string)).toBe('');
  });
});

describe('scrubUrlForLog — secrets in the PATH, not just the query', () => {
  // 2Factor puts the API KEY and the login CODE in the path:
  //   https://2factor.in/API/V1/<api-key>/SMS/+91XXXXXXXXXX/<code>/<template>
  // Query-string redaction alone would print both in full.
  const KEY = 'a1b2c3d4-5e6f-11ee-be56-0242ac120002';
  const URL2F = `https://2factor.in/API/V1/${KEY}/SMS/+919876543210/483920/FayrLogin`;

  it('hides an API key that sits in the path', () => {
    expect(scrubUrlForLog(URL2F)).not.toContain(KEY);
  });

  it('hides the login code in the path', () => {
    expect(scrubUrlForLog(URL2F)).not.toContain('483920');
  });

  it('masks the phone number in the path', () => {
    expect(scrubUrlForLog(URL2F)).not.toContain('9876543210');
  });

  it('keeps what makes a failure diagnosable', () => {
    const out = scrubUrlForLog(URL2F);
    expect(out).toContain('2factor.in');
    expect(out).toContain('/SMS/');
    expect(out).toContain('FayrLogin'); // a template name is not a secret
  });

  it('also removes any literal secret it is handed, whatever shape it is', () => {
    const out = scrubUrlForLog('https://x.test/API/short/go', { secrets: ['short'] });
    expect(out).not.toMatch(/\/short\//);
    expect(out).toContain('(hidden)');
  });

  it('ignores empty or blank entries in the secrets list', () => {
    const url = 'https://x.test/API/v1/go';
    expect(scrubUrlForLog(url, { secrets: ['', '   ', undefined as unknown as string] })).toBe(url);
  });

  it('leaves an ordinary path alone', () => {
    expect(scrubUrlForLog('https://cpaas.messagecentral.com/verification/v3/send'))
      .toBe('https://cpaas.messagecentral.com/verification/v3/send');
  });
});
