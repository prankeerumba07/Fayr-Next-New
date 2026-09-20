import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  PRACTICE_HOLD_OFF,
  PRACTICE_WINDOW_OFF,
  isAPracticeDatabase,
  practiceHoldMs,
  practiceWindowDays,
} from './engine/practice-window';

/**
 * WHETHER THE PRACTICE ORDER WINDOW APPLIES, ASKED OF THE DATABASE ITSELF.
 *
 * ── THE GUARD, AND WHY IT ASKS THE DATABASE AND NOT THE SETTINGS ───────────
 *
 * `SELECT current_database()`. The same shape as scripts/free-practice-claims.ts,
 * and for the same reason recorded there: a database whose name does not end in
 * _dev or _test is somebody's real records.
 *
 * It asks the LIVE CONNECTION rather than parsing DATABASE_URL, because those two
 * can disagree — a connection string edited to point somewhere else is exactly
 * the mistake this guard exists for, and a guard that read the same setting the
 * connection was made from would agree with the mistake.
 *
 * ── ASKED ONCE AND REMEMBERED, WHICH IS SAFE HERE AND WOULD NOT ALWAYS BE ──
 *
 * A running process does not change which database it is connected to. So the
 * name is read on the first question and kept. Re-asking on every evidence
 * submission would add a round trip to the busiest path in the product to answer
 * a question whose answer cannot have changed.
 *
 * ── IT FAILS CLOSED, AND SAYS SO OUT LOUD ──────────────────────────────────
 *
 * If the name cannot be read at all, the answer is OFF. Not "probably a practice
 * database", not "carry on and check later": off. The cost of being wrong that
 * way is that the owner's test does not match and he tells us; the cost of being
 * wrong the other way is a real person's real old purchase being paid for.
 */
@Injectable()
export class PracticeWindowService {
  private readonly log = new Logger(PracticeWindowService.name);

  /** null until asked; then the name, or '' if it could not be read. */
  private databaseName: string | null = null;

  /** So the loud line about being on is written once and not per request. */
  private saidItIsOn = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The setting, whatever the database turns out to be. */
  private setting(): number {
    return this.config.get('PRACTICE_ORDER_WINDOW_DAYS', { infer: true });
  }

  /**
   * HOW LONG THE QUICK-COMMERCE HOLD IS FOR A REHEARSAL, IN MILLISECONDS.
   *
   * Zero means off, and zero is what every caller gets unless BOTH halves
   * agree: the setting is a positive number AND the live database is a practice
   * one. Exactly the shape daysAllowed uses above, for the same reason — a
   * value left in an environment file must not be able to shorten a hold on
   * anybody's real refund. The deciding is in practiceHoldMs, where a check can
   * walk it; this only fetches the two facts.
   */
  async holdMsAllowed(): Promise<number> {
    // ── NEVER UNDER TEST, WHATEVER THE SETTING SAYS ────────────────────────
    //
    // Found by the checks themselves, 20 September 2026. Putting
    // PRACTICE_HOLD_MINUTES=2 in backend/.env shortened the hold inside the e2e
    // run as well — the test database is named _test, so both gates passed —
    // and scheduler.e2e-spec.ts failed on "the three hour hold on a shop that
    // cannot be sent back to" and "AND NOT ONE MINUTE BEFORE". Those two are
    // asserting the PRODUCT'S rule, and a rehearsal setting that can quietly
    // rewrite what they measure makes them worthless.
    //
    // The same shape the scheduler already uses: disabled under NODE_ENV=test
    // regardless. The pure rule in practiceHoldMs keeps its own unit checks, so
    // nothing here goes unwalked.
    if (process.env.NODE_ENV === 'test') return PRACTICE_HOLD_OFF;

    const setting = this.config.get('PRACTICE_HOLD_MINUTES', { infer: true });
    if (typeof setting !== 'number' || setting <= 0) return PRACTICE_HOLD_OFF;

    const name = await this.nameOfTheDatabase();
    const ms = practiceHoldMs(setting, name);

    if (ms <= 0) {
      // SAID OUT LOUD, EVERY TIME. Somebody has deliberately asked for a short
      // hold and is not getting one, and a silent refusal here is an afternoon
      // spent wondering why a refund has not landed.
      this.log.warn(
        `PRACTICE_HOLD_MINUTES is set to ${setting} but "${name}" is not a `
        + 'practice or development database, so the quick-commerce hold is NOT '
        + 'shortened. A database whose name does not end in _dev or _test is '
        + 'somebody\'s real records.',
      );
      return PRACTICE_HOLD_OFF;
    }
    return ms;
  }

  private async nameOfTheDatabase(): Promise<string> {
    if (this.databaseName != null) return this.databaseName;
    try {
      const rows = await this.prisma.$queryRawUnsafe<
      { current_database: string }[]
      >('SELECT current_database()');
      this.databaseName = rows[0]?.current_database ?? '';
    } catch (e) {
      // FAILS CLOSED. A name we cannot read is not a practice database.
      this.databaseName = '';
      this.log.warn(
        'could not read the database name, so the practice order window stays off',
      );
    }
    return this.databaseName;
  }

  /**
   * HOW MANY DAYS THE WINDOW MAY BE WIDENED BY, right now. Zero means off, and
   * zero is what every caller gets unless BOTH halves agree: the setting is a
   * positive number AND the live database is a practice one.
   */
  async daysAllowed(): Promise<number> {
    const setting = this.setting();
    // Nothing to ask the database about if the setting is off. This also keeps
    // the query off the path entirely in a real deployment, where it is off.
    if (typeof setting !== 'number' || setting <= 0) return PRACTICE_WINDOW_OFF;

    const name = await this.nameOfTheDatabase();
    const days = practiceWindowDays(setting, name);

    if (days <= 0) {
      // SAID OUT LOUD, EVERY TIME, because somebody has deliberately asked for a
      // wider window and is not getting one. A silent refusal here is an
      // afternoon lost to wondering why an order will not match.
      this.log.warn(
        `PRACTICE_ORDER_WINDOW_DAYS is set to ${setting} but "${name}" is not a `
        + 'practice or development database, so the order window is NOT widened. '
        + 'A database whose name does not end in _dev or _test is somebody\'s real '
        + 'records.',
      );
      return PRACTICE_WINDOW_OFF;
    }

    if (!this.saidItIsOn) {
      this.saidItIsOn = true;
      this.log.warn(
        `THE PRACTICE ORDER WINDOW IS ON: orders up to ${days} days before the `
        + `claim will match on "${name}". Every task matched this way is marked, `
        + 'and the staff panel shows the mark.',
      );
    }
    return days;
  }

  /** For the checks, and for anything that wants the test without the setting. */
  static databaseIsAPracticeOne(name: string | null | undefined): boolean {
    return isAPracticeDatabase(name);
  }
}
