/**
 * MOVE ONE PRACTICE CAMPAIGN'S CREATION DATE BACK, SO ITS RECORD IS HONEST.
 *
 *   npx ts-node scripts/backdate-practice-campaign.ts "boAt Rockerz" 400
 *
 * ── SAY THE UNCOMFORTABLE THING FIRST: THIS IS NO LONGER NEEDED TO MAKE AN
 *    OLD ORDER MATCH ──────────────────────────────────────────────────────────
 *
 * It was, until engine/practice-window.ts learned to widen the campaign floor as
 * well as the grace. Before that, PRACTICE_ORDER_WINDOW_DAYS was thrown away by
 * the campaign clamp and backdating the campaign was the only way through.
 *
 * It is not the way through any more, and it never was on its own. orderWindow's
 * floor is the LATER of (the claim moment less the grace) and the campaign's
 * creation. Backdating moves the second and leaves the first exactly where it
 * was, so with the practice window OFF all it buys is the difference between
 * those two bounds: a campaign made moments before the claim stops being the
 * floor, and the claim's own TWO HOUR grace becomes the floor instead. Two
 * hours. However many days are asked for. A months old order is still refused,
 * and there is a check that measures exactly this.
 *
 * Backdating only ever mattered in combination with a widened grace, and the
 * widened grace now moves both halves by itself.
 *
 * ── SO WHAT IS IT FOR ──────────────────────────────────────────────────────
 *
 * The record. A practice campaign made yesterday, with a refund paid against an
 * order from ten months before it existed, reads in the staff panel as a
 * campaign that paid for a purchase it could not have caused. That is what the
 * practice mark on the task is for — but a staff member reading the campaign
 * still sees two dates that make no sense together. This makes them make sense.
 *
 * It is a convenience for practice data and nothing more. It is NOT a way to
 * make a real order qualify, because it cannot be: on a real database it refuses
 * to run at all.
 *
 * ── WHAT IT REFUSES ───────────────────────────────────────────────────────
 *
 * ANY DATABASE THAT IS NOT A PRACTICE ONE, asked of the live connection and not
 * of the connection string, failing closed on a name it cannot read — the same
 * one function scripts/reset-amazon-claims.ts and tasks/practice-window.service.ts
 * use, so there is only ever ONE spelling of the rule.
 *
 * MORE THAN ONE CAMPAIGN MATCHING THE WORDS GIVEN. It names every one of them
 * and stops. Guessing which campaign somebody meant, and then rewriting its
 * dates, is not a guess anybody would want made on their behalf.
 *
 * A NUMBER OF DAYS THAT IS NOT A POSITIVE WHOLE NUMBER, and one above the same
 * ten year ceiling the practice window uses. Refused rather than clamped: this
 * command prints what it did, so a refusal is read, whereas a silent clamp on a
 * mistyped number would print a date nobody asked for.
 *
 * ── WHAT IT CHANGES, EXACTLY ──────────────────────────────────────────────
 *
 * One column on one row: campaigns.createdAt. Not the title, the picture, the
 * terms, the price, the seat count or the status. No task, no ticket, no ledger
 * entry, no money. The row's updatedAt does move, because the row really was
 * updated, and pretending otherwise would be the only dishonest thing here.
 *
 * IT IS RELATIVE, AND RUNNING IT TWICE MOVES TWICE. "Back by 400 days" from
 * wherever the campaign is now. That is what it prints — the old date and the
 * new one, every run — so there is no way to run it twice without seeing it.
 */
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  PRACTICE_WINDOW_MAX_DAYS,
  isAPracticeDatabase,
} from '../src/tasks/engine/practice-window';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackdateOptions {
  /** Suppress the printing. The end to end run does. */
  quiet?: boolean;
  /** Bypass the live lookup, for testing the refusal itself. */
  databaseNameOverride?: string;
}

export interface BackdateReport {
  databaseName: string;
  campaignId: string;
  title: string;
  days: number;
  wasCreatedAt: Date;
  nowCreatedAt: Date;
}

export async function backdatePracticeCampaign(
  app: INestApplicationContext,
  titleLike: string,
  days: number,
  opts: BackdateOptions = {},
): Promise<BackdateReport> {
  const prisma = app.get(PrismaService);
  const say = (m: string): void => {
    if (!opts.quiet) console.log(m);
  };

  // FIRST, BEFORE A SINGLE ROW IS READ OR WRITTEN.
  const databaseName = await practiceDatabaseName(
    prisma,
    opts.databaseNameOverride,
  );

  const howMany = wholeDays(days);
  const words = typeof titleLike === 'string' ? titleLike.trim() : '';
  if (words === '') {
    throw new Error(
      'Backdating refused: no campaign was named. Give some of its title, in '
        + 'quotes, and the number of days:\n'
        + '  npx ts-node scripts/backdate-practice-campaign.ts "boAt Rockerz" 400',
    );
  }

  // PARTIAL, AND IT DOES NOT CARE ABOUT CAPITALS, because the title in somebody's
  // head is rarely the title in the database character for character.
  const matches = await prisma.campaign.findMany({
    where: { title: { contains: words, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
  });

  if (matches.length === 0) {
    throw new Error(
      `Backdating refused: no campaign on "${databaseName}" has "${words}" in `
        + 'its title, so there is nothing to move.',
    );
  }
  if (matches.length > 1) {
    // NAMED, EVERY ONE OF THEM, AND NOTHING TOUCHED. Picking one — the newest,
    // the closest match, the first — would be a guess about somebody's data
    // followed by a rewrite of its dates.
    throw new Error(
      `Backdating refused: ${matches.length} campaigns have "${words}" in their `
        + 'title, and guessing which one you meant is not something this should '
        + 'do. Nothing was changed. Say more of the title, or use one of these '
        + 'exactly:\n'
        + matches.map((c) => `  ${c.title}`).join('\n'),
    );
  }

  const campaign = matches[0];
  const wasCreatedAt = campaign.createdAt;
  const nowCreatedAt = new Date(wasCreatedAt.getTime() - howMany * DAY_MS);

  // ONE COLUMN, ON ONE ROW, BY ITS ID. Deliberately not by the words that found
  // it: a title search that matched one row a moment ago is not a promise about
  // which rows it matches now.
  const after = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { createdAt: nowCreatedAt },
  });

  const report: BackdateReport = {
    databaseName,
    campaignId: campaign.id,
    title: campaign.title,
    days: howMany,
    wasCreatedAt,
    nowCreatedAt: after.createdAt,
  };

  print(say, report);
  return report;
}

/** Everything printed, in one place, so the shape is easy to read and change. */
function print(say: (m: string) => void, report: BackdateReport): void {
  say('');
  say(`The database is ${report.databaseName}.`);
  say(`Moved back by ${report.days === 1 ? '1 day' : `${report.days} days`}:`);
  say('');
  say(`  ${report.title}`);
  say(`      was made  ${plainDate(report.wasCreatedAt)}`);
  say(`      now made  ${plainDate(report.nowCreatedAt)}`);
  say('');
  say('Only that one date changed. Not the title, the picture, the terms, the');
  say('price, the seats or the status, and no task, ticket or money record.');
  say('Running this again moves it back again, from wherever it is now.');
  say('');
}

/** A date a person can read, and no clock: only the day matters here. */
function plainDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * THE NUMBER OF DAYS, OR A REFUSAL SAYING WHY.
 *
 * FORWARD IS REFUSED, not silently ignored. Moving a campaign's creation later
 * NARROWS the window every task on it is judged against, which is the one
 * direction nothing here should be able to move — and somebody typing a minus
 * sign meant something, so they are told rather than surprised.
 *
 * THE SAME TEN YEAR CEILING as the practice window, because it is the same kind
 * of mistake: a setting nobody sanity-checks, typed once. Above it this refuses
 * rather than clamping, because unlike the setting this command PRINTS the date
 * it produced, and a clamped answer printed as an answer is worse than a no.
 */
function wholeDays(days: number): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) {
    throw new Error(
      `Backdating refused: "${String(days)}" is not a number of days. Give a `
        + 'whole number, like 400.',
    );
  }
  if (!Number.isInteger(days)) {
    throw new Error(
      `Backdating refused: ${days} is not a whole number of days. Part of a day `
        + 'is not something anybody means here.',
    );
  }
  if (days <= 0) {
    throw new Error(
      `Backdating refused: ${days} would move the campaign's creation forward, `
        + 'or nowhere at all. Moving it forward NARROWS the window every task on '
        + 'it is judged against, which is not what this is for. Give a positive '
        + 'number of days.',
    );
  }
  if (days > PRACTICE_WINDOW_MAX_DAYS) {
    throw new Error(
      `Backdating refused: ${days} days is further back than the ${PRACTICE_WINDOW_MAX_DAYS} `
        + 'day ceiling, which is ten years and longer than any shop will show an '
        + 'order. That is more likely a typing mistake than a request.',
    );
  }
  return days;
}

/**
 * The same refusal reset-amazon-claims.ts and practice-window.service.ts make,
 * made again here from the same one function, so there is only ever ONE spelling
 * of the rule.
 *
 * It asks the LIVE CONNECTION its own name, not DATABASE_URL, because those two
 * can disagree — a connection string edited to point somewhere else is exactly
 * the mistake this guard exists for, and a guard that read the setting the
 * connection was made from would agree with the mistake.
 *
 * AND IT FAILS CLOSED. A name that cannot be read at all is not a practice
 * database. This one rewrites a date that every task on the campaign is judged
 * against, so on a real database being wrong here would move real people's
 * windows underneath them.
 */
async function practiceDatabaseName(
  prisma: PrismaService,
  override?: string,
): Promise<string> {
  let name = override;
  if (name == null) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
        'SELECT current_database()',
      );
      name = rows[0]?.current_database ?? '';
    } catch {
      name = '';
    }
  }
  if (!isAPracticeDatabase(name)) {
    throw new Error(
      `Backdating refused: "${name}" is not a practice or development database. `
        + "This rewrites a campaign's creation date, and every task on that "
        + 'campaign is judged against it.',
    );
  }
  return name;
}

async function main(): Promise<void> {
  const [titleLike, daysText] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    await backdatePracticeCampaign(
      app,
      titleLike ?? '',
      // NaN when it is not a number at all, which wholeDays refuses by name.
      daysText == null || daysText.trim() === '' ? NaN : Number(daysText),
    );
  } finally {
    await app.close();
  }
}

// So the checks can import the work above without the command running itself.
if (require.main === module) {
  main().catch((err: unknown) => {
    // The message, not the stack. Every way this stops on purpose stops with a
    // sentence written to be read.
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
