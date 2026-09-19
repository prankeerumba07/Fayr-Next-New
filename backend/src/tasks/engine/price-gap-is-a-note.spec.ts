import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { chargedDisagreesWithCampaign } from './charged-amount';

/**
 * THE PRICE-GAP REASON IS A NOTE, AND THE SERVER'S OWN WORD — Phase 8B-a.
 *
 * ── THE TWO THINGS THIS FILE HOLDS ───────────────────────────────────────────
 *
 * R3: "It is a note, not a payout input; the only payout input is R2." So no
 * file that decides money may so much as mention it. That is checked by walking
 * the source rather than by remembering, because the failure it guards against
 * is somebody reaching for a convenient field a year from now.
 *
 * R4: "Nothing on the phone moves money." The reason is computed by the server
 * from the order's own text and cannot arrive from a device — which is enforced
 * by the ABSENCE of a validator on the DTO property, a thing that is invisible
 * when you read the line and so is stated here out loud.
 *
 * Comments are stripped before matching, eleven times over now: a rule that a
 * word does not appear must not be satisfied by a word appearing in prose about
 * the rule.
 */

const BACKEND_SRC = join(__dirname, '..', '..');
const REPO = join(__dirname, '..', '..', '..', '..');

function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function everyFileUnder(dir: string, ext: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
      const full = join(at, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (ext.some((e) => name.endsWith(e))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe('the price-gap reason is a note and nothing else', () => {
  it('IS MENTIONED IN EXACTLY THE FILES THAT WRITE IT, CARRY IT OR SHOW IT', () => {
    const named: string[] = [];
    for (const file of everyFileUnder(BACKEND_SRC, ['.ts'])) {
      // Checks are not code that runs in front of anybody's money.
      if (file.endsWith('.spec.ts')) continue;
      if (withoutComments(readFileSync(file, 'utf8')).includes('priceGapReason')) {
        named.push(relative(BACKEND_SRC, file).split(sep).join('/'));
      }
    }
    // Five files, and every one of them is a place the note is PUT or SHOWN.
    // Not one of them decides an amount, a state, an eligibility or a hold.
    expect(named.sort()).toEqual([
      // The shape it lives on.
      'tasks/engine/evidence.types.ts',
      // The one place a submission is copied into that shape.
      'tasks/dto/submit-evidence.dto.ts',
      // Carried forward so a later fragment cannot wipe it.
      'tasks/order-candidates.ts',
      // Written, once, when the server confirms a watched purchase.
      'tasks/order-candidates.service.ts',
      // Shown to staff.
      'tasks/task.response.ts',
    ].sort());
  });

  it('AND NO FILE THAT DECIDES MONEY MENTIONS IT AT ALL', () => {
    // Named one by one rather than by folder, so that adding a money file does
    // not quietly fall outside the check.
    const money = [
      'tasks/engine/charged-amount.ts',
      'tasks/engine/money.ts',
      'tasks/engine/transition.ts',
      'tasks/engine/refusal-words.ts',
      'tasks/engine/return-policy.ts',
      'tasks/engine/staff-amount.ts',
      'tasks/task.service.ts',
      'tasks/awaiting-amount.response.ts',
      'wallet/wallet.service.ts',
      'running/running.rules.ts',
    ];
    for (const one of money) {
      const src = withoutComments(readFileSync(join(BACKEND_SRC, one), 'utf8'));
      expect(`${one}: ${src.includes('priceGapReason')}`).toBe(`${one}: false`);
    }
  });

  /**
   * WHAT A REAL DISCOUNT NOW DOES AT THE REFUND GATE, WRITTEN DOWN.
   *
   * Before this phase a confirmed order's amount was ALWAYS exactly the campaign's
   * own price — matchOrderToCampaign only matched on equality — so
   * chargedDisagreesWithCampaign could not fire on that path at all. It can now:
   * a watched purchase bought at a discount carries a base BELOW the offer's
   * price, which is the whole point of the phase.
   *
   * THE GATE THAT THEN STANDS IN FRONT OF IT IS THE RIGHT ONE, and it is already
   * satisfied: it asks for the person's "yes, this is my order", and on a watched
   * purchase the server's own match on the page Fayr watched being placed IS that
   * confirmation — orderConfirmed is true before the money is ever asked for.
   *
   * SO IF THE WATCHED CONFIRM EVER FAILED, a discounted purchase would hold for a
   * person rather than pay quietly. That is the safe direction and it is stated
   * here so nobody has to rediscover it.
   */
  it('A DISCOUNTED WATCHED PURCHASE TRIPS THE AMOUNT GATE, and the watched confirm is what clears it', () => {
    // ₹149 paid against a ₹325 offer is far outside max(₹2, 5%).
    expect(chargedDisagreesWithCampaign(14900n, 32500n)).toBe(true);
    // And the gate is "doubtful AND not confirmed", not "doubtful" alone.
    const service = withoutComments(readFileSync(join(BACKEND_SRC, 'tasks/task.service.ts'), 'utf8'));
    expect(service).toMatch(/const doubtful = match\?\.ambiguous === true \|\| priceDisagrees;/);
    expect(service).toMatch(/if \(doubtful && task\.orderConfirmed !== true\)/);
  });

  it('and the refund a release pays is computed from the charged amount alone', () => {
    const service = withoutComments(readFileSync(join(BACKEND_SRC, 'tasks/task.service.ts'), 'utf8'));
    // The one arithmetic that turns an amount into money, with the one input.
    expect(service).toMatch(/computeRefundPaise\(\s*charged\.paise,/);
    // And the charged amount comes from the resolver, never from a raw field.
    expect(service).toMatch(/const charged = resolveChargedPaise\(task\.order\);/);
  });

  describe('and no phone can set it', () => {
    const dto = readFileSync(join(BACKEND_SRC, 'tasks/dto/submit-evidence.dto.ts'), 'utf8');

    it('THE DTO PROPERTY IS GUARDED BY A VALIDATOR THAT ACCEPTS NOTHING', () => {
      // @Equals(undefined) passes when the field is absent and fails when it is
      // there, whatever it says. It is also what keeps the property ON the
      // whitelist: an undecorated one made forbidNonWhitelisted refuse every
      // evidence body carrying an order at all. See the note beside the line.
      const bare = withoutComments(dto);
      const at = bare.indexOf('priceGapReason?: string;');
      expect(at).toBeGreaterThan(-1);
      // EVERYTHING BETWEEN THE END OF THE PROPERTY BEFORE IT AND THIS ONE, with
      // the comments gone: exactly one decorator, and it is that one.
      const since = bare.lastIndexOf(';', at - 1);
      expect(since).toBeGreaterThan(-1);
      const gap = bare.slice(since + 1, at);
      expect((gap.match(/@[A-Za-z]+\(/g) ?? [])).toEqual(['@Equals(']);
      expect(gap).toMatch(/@Equals\(\s*undefined\s*,/);
      // AND NOT @IsOptional() BESIDE IT, which would skip the check entirely.
      expect(gap).not.toMatch(/@IsOptional/);
    });

    it('and every other money field on that shape DOES carry one', () => {
      // The contrast is the point: this is not a file where decorators were
      // forgotten, it is a file where exactly one property is left without one.
      for (const field of ['unitPricePaise', 'lineTotalPaise', 'orderTotalPaise', 'amountSource']) {
        const at = dto.indexOf(`${field}?:`);
        expect(at).toBeGreaterThan(-1);
        const before = withoutComments(dto.slice(0, at));
        expect(before.slice(before.lastIndexOf('\n') + 1)).toMatch(/@Is|@Matches/);
      }
    });
  });

  it('AND THE APP DECIDES NO AMOUNT: nothing on the phone knows this rule exists', () => {
    // WHAT THIS DOES AND DOES NOT SAY. It says no file on the phone computes a
    // refund base for a watched purchase or knows the reason exists — this
    // phase's rule lives on the server and nowhere else. It does NOT say the
    // phone is ignorant of money: src/chargedAmount.js is a deliberate,
    // documented mirror of the backend resolver that decides what a SCREEN
    // SHOWS, so the app never promises a figure the backend would refuse. That
    // file is older than this phase and is untouched by it.
    const app = everyFileUnder(join(REPO, 'src'), ['.js', '.mjs']);
    expect(app.length).toBeGreaterThan(50);
    const guilty: string[] = [];
    for (const file of app) {
      const src = withoutComments(readFileSync(file, 'utf8'));
      if (/priceGapReason|theRefundBase|watched-price|whatOneOfThemCost/.test(src)) {
        guilty.push(relative(REPO, file).split(sep).join('/'));
      }
    }
    expect(guilty).toEqual([]);
  });
});
