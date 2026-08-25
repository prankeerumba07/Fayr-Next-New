import { Logger } from '@nestjs/common';
import { DevSmsSender } from './dev-sms-sender';

/**
 * The console sender prints the code ON PURPOSE — that is the whole point of it.
 * But it had no test at all, and it was the one sender that never went through
 * mask.ts, so it printed the caller's full phone number alongside the live code.
 * Found by an adversarial review.
 */
describe('DevSmsSender', () => {
  function captureLogs() {
    const lines: string[] = [];
    const grab = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(grab as never);
    }
    return lines;
  }

  it('prints the code — that is its job', async () => {
    const lines = captureLogs();
    await new DevSmsSender().sendOtp('+919876543210', '483920');
    expect(lines.join('\n')).toContain('483920');
  });

  it('does NOT print the full phone number', async () => {
    const lines = captureLogs();
    await new DevSmsSender().sendOtp('+919876543210', '483920');
    const all = lines.join('\n');
    expect(all).not.toContain('9876543210');
    expect(all).not.toContain('+919876543210');
    expect(all).toContain('10'); // masked tail, enough to match a test run
  });

  it('says out loud that it is not sending anything', async () => {
    const lines = captureLogs();
    await new DevSmsSender().sendOtp('+919876543210', '483920');
    expect(lines.join('\n')).toMatch(/no SMS|not sent|DEV/i);
  });
});
