/**
 * GIVE THE PRACTICE ACCOUNT ITS OWN CLAIMS BACK, WITHOUT WAITING HALF AN HOUR.
 *
 * WHY THIS EXISTS. Walking through the app means claiming offers, and a claim is
 * held for thirty minutes before Fayr lets it go. By the end of one walk through
 * nearly every practice offer is claimed, and the next walk through cannot start
 * until the half hour is up. The owner asked for one command that frees his own
 * claims on the practice database so he can start again straight away.
 *
 * NOTHING IS DELETED, AND NOTHING IS MADE UP. Fayr already knows how to let a
 * claim go: it closes the task, gives the tickets back through the real ticket
 * ledger, and writes down that it happened. This runs that same work and ignores
 * one thing only, the thirty minute deadline. Every row that was there before is
 * still there afterwards, and the tickets come back the way they always do.
 *
 * IT REFUSES ON ANYTHING THAT IS NOT A PRACTICE DATABASE, before it reads a
 * single row, in the same shape as the demo seed and the answer book. A database
 * whose name does not end in _dev or _test is somebody's real records.
 *
 * IT WILL NOT LET THE MONEY AND THE CLAIMS DISAGREE. A claim with money recorded
 * against it is left exactly as it is and named in what it prints, because the
 * wallet is a running total of things that really happened and a claim quietly
 * given back underneath it would make two screens tell two different stories.
 * The same goes for an offer that was bought: Fayr never lets the same person
 * claim an offer they have already bought, so handing that one back would be a
 * lie the rest of the product would then have to live with.
 *
 * NO NUMBER IS EVER PRINTED. The account is named as "the practice account" and
 * shown with all but its last two digits covered over.
 *
 *   npx ts-node scripts/free-claims.ts
 *
 * See scripts/free-claims.ts for the command itself, and ./free-claims at the
 * top of the project for the one people actually type.
 */
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEMO_MOBILE_DEFAULT } from '../prisma/demo-seed';
import { maskMobile } from '../src/auth/sms/mask';
import { CLAIMED_SEATS_WHERE, isFull } from '../src/campaigns/seats';
import type { Env } from '../src/config/env.validation';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';

export interface FreePracticeClaimsOptions {
  /** Suppress the printing. The end to end run does. */
  quiet?: boolean;
  /** Bypass the live lookup, for testing the refusal itself. */
  databaseNameOverride?: string;
  /** Whose claims to free. Defaults to the practice account. */
  mobile?: string;
}

/** One claim that was let go, and what came back for it. */
export interface FreedClaim {
  taskId: string;
  offer: string;
  /** Read back off the ticket ledger after the fact, never assumed. */
  ticketsReturned: number;
  /**
   * Whether the offer really can be claimed again now. A let go claim keeps its
   * seat, so an offer with every seat taken stays shut even once it is free.
   */
  canBeClaimedAgain: boolean;
}

/** One claim that was not touched, and the reason, in words. */
export interface LeftAloneClaim {
  taskId: string;
  offer: string;
  /** The product's own word for how far this one got. */
  state: string;
  reason: string;
}

export interface FreePracticeClaimsReport {
  /** The account, with all but the last two digits covered over. */
  account: string;
  databaseName: string;
  freed: FreedClaim[];
  leftAlone: LeftAloneClaim[];
  ticketsReturned: number;
  ticketsNow: number;
}

/**
 * How far a claim got, in words anybody can read.
 *
 * The product's own words for these are fine on a screen built around them and
 * are not fine in a sentence explaining why something was refused, which is the
 * only place this is used.
 */
const HOW_FAR: Record<string, string> = {
  CLAIMED: 'claimed',
  PURCHASED: 'bought',
  DELIVERED: 'delivered',
  REVIEWED: 'reviewed',
  HOLDING: 'waiting out the return window',
  REFUNDED: 'refunded',
};

export async function freePracticeClaims(
  app: INestApplicationContext,
  opts: FreePracticeClaimsOptions = {},
): Promise<FreePracticeClaimsReport> {
  const prisma = app.get(PrismaService);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const tasks = app.get(TaskService);
  const tickets = app.get(TicketService);

  const say = (m: string): void => {
    if (!opts.quiet) console.log(m);
  };

  const databaseName = await practiceDatabaseName(
    prisma,
    opts.databaseNameOverride,
  );

  const mobile =
    opts.mobile ?? settingsPracticeMobile(config) ?? DEMO_MOBILE_DEFAULT;
  const account = maskMobile(mobile);

  const user = await prisma.user.findUnique({ where: { mobile } });
  if (user == null) {
    throw new Error(
      `There is no practice account ${account} on "${databaseName}", so there `
        + 'is nothing to free. Put the practice data in first, with ./start, or '
        + 'name the account you meant.',
    );
  }

  say('');
  say(`Freeing the claims held by the practice account ${account}.`);
  say(`The database is ${databaseName}.`);

  // Only the claims that are still open. One that has already been let go is
  // already out of the way, holds nothing up, and is nobody's business here.
  const open = await prisma.task.findMany({
    where: { userId: user.id, closedAt: null },
    include: { campaign: true },
    orderBy: { createdAt: 'asc' },
  });

  const freed: FreedClaim[] = [];
  const leftAlone: LeftAloneClaim[] = [];

  for (const task of open) {
    const offer = task.campaign.title;
    const state = task.state;

    // THE FIRST REFUSAL: IT WAS BOUGHT. Fayr never lets the same person claim an
    // offer they have already bought, and it reads exactly this to decide that.
    // Freeing this one would put the offer back in front of him and then refuse
    // him at the till, which is worse than leaving it where it is.
    if (state !== 'CLAIMED') {
      leftAlone.push({
        taskId: task.id,
        offer,
        state,
        reason:
          `This one was bought and has got as far as being ${HOW_FAR[state] ?? 'started'}. `
          + 'Fayr never lets the same person claim an offer they have already '
          + 'bought, so freeing it would say something that is not true.',
      });
      continue;
    }

    // THE SECOND REFUSAL: THERE IS MONEY AGAINST IT. Asked of the database every
    // time rather than reasoned about, because "a claim cannot have money
    // against it yet" is exactly the kind of thing that is true until somebody
    // adds a step and nobody comes back to this file.
    const money = await moneyAgainst(prisma, task.id);
    if (
      money.movements > 0 ||
      money.walletEntries > 0 ||
      money.withdrawals > 0
    ) {
      const found = [
        `${countOf(money.movements, 'movement', 'movements')} of money in the wallet`,
        `${countOf(money.walletEntries, 'entry', 'entries')} written down against it`,
      ];
      if (money.withdrawals > 0) {
        found.push(
          `${countOf(money.withdrawals, 'withdrawal', 'withdrawals')} that used it`,
        );
      }
      leftAlone.push({
        taskId: task.id,
        offer,
        state,
        reason:
          `There is money recorded against this one: ${listOf(found)}. `
          + 'Freeing it would leave the money records saying one thing and the '
          + 'claim saying another, so it was left exactly as it is.',
      });
      continue;
    }

    // AND NOW THE PRODUCT'S OWN WAY OF LETTING A CLAIM GO, with the deadline
    // ignored and nothing else changed. It closes the task, gives the tickets
    // back through the ticket ledger, and writes the event. It refuses under its
    // own lock if the claim moved on in the moment since it was read above.
    let letGo: boolean;
    try {
      letGo = await tasks.freeClaimForPractice(user.id, task.id);
    } catch (err) {
      leftAlone.push({
        taskId: task.id,
        offer,
        state,
        reason:
          'Fayr refused to let this one go, so nothing about it was changed. '
          + `It said: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (!letGo) {
      leftAlone.push({
        taskId: task.id,
        offer,
        state,
        reason:
          'This one stopped being a waiting claim in the moment between being '
          + 'read and being freed, so it was left alone.',
      });
      continue;
    }

    // WHAT CAME BACK IS READ OFF THE LEDGER, NOT WORKED OUT. The number of
    // tickets a claim cost is whatever was really taken for it, which is not
    // always what the offer costs today, and the only honest place to read it is
    // the entry the return itself just wrote.
    const back = await prisma.ticketEntry.findFirst({
      where: { taskId: task.id, reason: 'EXPIRY_RETURN' },
    });

    // WHETHER IT CAN BE CLAIMED AGAIN IS READ OFF THE SAME COUNT THE GATE USES,
    // and not worked out here. Until 18 September 2026 a released claim kept its
    // seat, so on a one-seat offer this line said "free and still shut" — which
    // is what the owner saw, and why the rule changed in seats.ts. Nothing about
    // this call changed with it: it asks the one predicate, so it answers
    // whatever the gate would answer.
    const taken = await prisma.task.count({
      where: CLAIMED_SEATS_WHERE(task.campaignId),
    });

    freed.push({
      taskId: task.id,
      offer,
      ticketsReturned: back?.delta ?? 0,
      canBeClaimedAgain:
        task.campaign.status === 'ACTIVE' &&
        !isFull(task.campaign.totalSlots, taken),
    });
  }

  const report: FreePracticeClaimsReport = {
    account,
    databaseName,
    freed,
    leftAlone,
    ticketsReturned: freed.reduce((sum, f) => sum + f.ticketsReturned, 0),
    ticketsNow: await tickets.getBalance(user.id),
  };

  print(say, report);
  return report;
}

/** Everything printed, in one place, so the shape is easy to read and change. */
function print(
  say: (m: string) => void,
  report: FreePracticeClaimsReport,
): void {
  say('');
  if (report.freed.length === 0) {
    say('NOTHING WAS FREED.');
  } else {
    say(`FREED ${countOf(report.freed.length, 'claim', 'claims')}:`);
  }
  for (const f of report.freed) {
    say(
      `  ${f.offer}`
        + `  (${countOf(f.ticketsReturned, 'ticket', 'tickets')} came back)`,
    );
    say(
      f.canBeClaimedAgain
        ? '      You can claim this one again now.'
        : '      Every seat on this one is taken, so it is free and still shut.',
    );
  }

  say('');
  if (report.leftAlone.length === 0) {
    say('NOTHING WAS LEFT ALONE. Every claim that was open is now free.');
  } else {
    say(`LEFT ALONE ${countOf(report.leftAlone.length, 'claim', 'claims')}:`);
  }
  for (const l of report.leftAlone) {
    say(`  ${l.offer}`);
    say(`      ${l.reason}`);
  }

  say('');
  say(
    `${countOf(report.ticketsReturned, 'ticket', 'tickets')} came back. `
      + `The practice account now has ${countOf(report.ticketsNow, 'ticket', 'tickets')}.`,
  );
  say('Nothing was deleted, and no money record was touched.');
  say('');
}

/**
 * Money recorded against one claim, asked of the database.
 *
 * The wallet does not hang off a task by a column, it points back at one by
 * name, so this is the join that says "this movement of money was about this
 * claim". Withdrawals are counted through the movement they reserved or gave
 * back, because that is the only real link between a withdrawal and one claim.
 *
 * TICKETS ARE DELIBERATELY NOT MONEY HERE. Every waiting claim has a ticket
 * taken for it by definition, and giving that back is the whole point of what
 * this command does. Counting tickets as a reason to refuse would refuse
 * everything, always.
 */
async function moneyAgainst(
  prisma: PrismaService,
  taskId: string,
): Promise<{ movements: number; walletEntries: number; withdrawals: number }> {
  const movements = await prisma.ledgerTransaction.findMany({
    where: { referenceType: 'task', referenceId: taskId },
    select: { id: true },
  });
  if (movements.length === 0) {
    return { movements: 0, walletEntries: 0, withdrawals: 0 };
  }
  const ids = movements.map((m) => m.id);
  const walletEntries = await prisma.walletEntry.count({
    where: { transactionId: { in: ids } },
  });
  const withdrawals = await prisma.withdrawal.count({
    where: {
      OR: [{ reserveTxnId: { in: ids } }, { reversalTxnId: { in: ids } }],
    },
  });
  return { movements: movements.length, walletEntries, withdrawals };
}

/**
 * The same refusal the demo seed and the answer book make, made again here.
 *
 * This one closes claims and moves tickets on somebody's account. On a real
 * database that is somebody's real record of what they are owed, so the name is
 * read and checked before a single row is looked at. The name can be handed in
 * instead of looked up, which is how the check itself is tested.
 */
async function practiceDatabaseName(
  prisma: PrismaService,
  override?: string,
): Promise<string> {
  let name = override;
  if (name == null) {
    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    name = rows[0]?.current_database ?? '';
  }
  if (!/_dev$|_test$/.test(name)) {
    throw new Error(
      `Freeing the claims refused: "${name}" is not a practice or development `
        + 'database. This closes claims and moves tickets on a real account, '
        + 'and on a real database those are the record of what a person is owed.',
    );
  }
  return name;
}

/**
 * The practice account named in the settings, EXCEPT NEVER DURING A TEST RUN.
 *
 * The same rule the demo seed follows, and for the same reason it learned it: a
 * test whose result depends on a settings file git has never seen is not a test.
 * A run that wants a particular account hands the account in.
 */
function settingsPracticeMobile(
  config: ConfigService<Env, true>,
): string | undefined {
  if (String(config.get('NODE_ENV', { infer: true })) === 'test') {
    return undefined;
  }
  const set = process.env.DEMO_MOBILE?.trim();
  return set != null && set.length > 0 ? set : undefined;
}

/** "one thing, another thing and a third", so a list reads as a sentence. */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "1 ticket", "5 tickets", so no sentence has to say "ticket or tickets". */
function countOf(howMany: number, one: string, many: string): string {
  return `${howMany} ${howMany === 1 ? one : many}`;
}
