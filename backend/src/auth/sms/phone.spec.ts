import { splitMobile } from './phone';

/**
 * Shared by every sender, so no provider can drift into its own idea of what a
 * valid number is. The failure being guarded against is texting a stranger: if we
 * guessed where to cut the digits of a foreign number, the remainder could be a
 * real Indian number belonging to someone else.
 */
describe('splitMobile', () => {
  it('splits an Indian E.164 number into both forms a provider might want', () => {
    expect(splitMobile('+919876543210', '91')).toEqual({
      e164: '+919876543210',
      national: '9876543210',
    });
  });

  it('returns null for a number outside the configured country', () => {
    expect(splitMobile('+14155550123', '91')).toBeNull();
    expect(splitMobile('+447700900123', '91')).toBeNull();
  });

  it('works for any configured country, not just India', () => {
    expect(splitMobile('+14155550123', '1')).toEqual({
      e164: '+14155550123',
      national: '4155550123',
    });
  });

  it('rejects anything that is not an E.164 number at all', () => {
    for (const bad of ['9876543210', '+91 98765 43210', '', '+', 'abc', null, undefined]) {
      expect(splitMobile(bad as unknown as string, '91')).toBeNull();
    }
  });

  it('rejects a number with nothing left after the country code', () => {
    expect(splitMobile('+91', '91')).toBeNull();
  });
});
