import { maskMobile, scrubForLog } from './mask';

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
