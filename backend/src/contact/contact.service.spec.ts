import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { ContactService } from './contact.service';
import { CALL_BUTTON, writeToUsWords } from './contact.words';

/**
 * THE ONE PLACE THAT KNOWS THE NUMBER, CHECKED AT ITS EDGES.
 *
 * The numbers here are made up. The real one is in backend/.env and in no check.
 */
function serviceWith(value: unknown): ContactService {
  const config = {
    get: (key: string) => (key === 'FAYR_SUPPORT_PHONE' ? value : undefined),
  } as unknown as ConfigService<Env, true>;
  return new ContactService(config);
}

const GOOD = '+919000000001';

describe('the support number', () => {
  it('is offered when it is a full international number', () => {
    const said = serviceWith(GOOD).howToReachUs();
    expect(said.phone).toBe(GOOD);
    expect(said.words).toContain(GOOD);
    expect(said.button).toBe(CALL_BUTTON);
  });

  it('is read fresh every time, so a change plus a restart is the whole procedure', () => {
    let value = GOOD;
    const config = {
      get: () => value,
    } as unknown as ConfigService<Env, true>;
    const service = new ContactService(config);
    expect(service.phoneNumber()).toBe(GOOD);
    value = '';
    expect(service.phoneNumber()).toBeNull();
  });

  it('surrounding spaces are trimmed off rather than making it unusable', () => {
    expect(serviceWith(`  ${GOOD}  `).phoneNumber()).toBe(GOOD);
  });

  describe('when there is none', () => {
    // Empty is a decision. Every other one of these is a mistake, and a mistake
    // must land on the SAME safe answer rather than on a phone that cannot dial.
    const nothingUsable = [
      ['not set at all', undefined],
      ['set to nothing', ''],
      ['set to spaces', '   '],
      ['half a number', '+9179'],
      ['too few digits', '+9179'],
      ['no plus sign', '919000000001'],
      ['spaces inside it', '+91 90000 00001'],
      ['dashes inside it', '+91-90000-00001'],
      ['a leading zero after the plus', '+09000000001'],
      ['far too long', `+91${'9'.repeat(20)}`],
      ['words', 'call the office'],
      ['not text at all', 42],
      ['nothing at all', null],
    ] as const;

    for (const [what, value] of nothingUsable) {
      it(`${what} offers no number and says to write in the app`, () => {
        const service = serviceWith(value);
        expect(service.phoneNumber()).toBeNull();
        const said = service.howToReachUs();
        expect(said.phone).toBeNull();
        expect(said.button).toBeNull();
        expect(said.words).toBe(writeToUsWords('en'));
        expect(said.words).not.toMatch(/\d/);
        // Always something to read. Never a blank.
        expect(said.words.trim().length).toBeGreaterThan(0);
        expect(said.title.trim().length).toBeGreaterThan(0);
      });
    }
  });

  it('answers in the language it is asked in', () => {
    const service = serviceWith(GOOD);
    expect(service.howToReachUs('hi').words).toContain('फोन');
    expect(service.howToReachUs('hi-en').words).toContain('phone');
    expect(service.howToReachUs('hi').words).toContain(GOOD);
  });

  /**
   * IT NEVER WRITES THE NUMBER DOWN. A log is a file, and the rule is that the
   * number lives in exactly one file. So this service has no logger at all, and
   * this check reads its own source to say so rather than trusting the reading.
   */
  it('has nothing that could write the number into a log', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const source = readFileSync(`${__dirname}/contact.service.ts`, 'utf8');
    expect(source).not.toContain('Logger');
    expect(source).not.toContain('console.');
  });
});
