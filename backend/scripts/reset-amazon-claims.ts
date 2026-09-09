/**
 * DELETE THE PRACTICE ACCOUNT'S AMAZON CLAIMS, SO THE SEATS COME BACK.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT ./free-claims ───────────────────────
 *
 * ./free-claims LETS A CLAIM GO. It closes the task, gives the tickets back and
 * writes down that it happened. What it deliberately does NOT do is remove the
 * row — and a row that is still there still holds its seat, because a taken seat
 * is ANY task on the campaign whatever state it reached (campaigns/seats.ts).
 * So after enough walk throughs the Amazon offers read "All seats taken" and no
 * amount of freeing claims will open them again.
 *
 * This is the other command: it REMOVES the rows, which is the only thing that
 * gives a seat back. Same practice-database guard, same shape of output, opposite
 * treatment of the row.
 *
 * ── WHAT IT REFUSES TO DELETE, AND WHY THAT IS THE WHOLE POINT ─────────────
 *
 * ANY ROW WITH MONEY AGAINST IT IS LEFT EXACTLY WHERE IT IS. A refund is a
 * record of something that really happened to somebody, and a deleted claim
 * underneath a paid refund would leave the money records pointing at nothing.
 * That refusal is asked FOUR ways rather than one, and which of them actually
 * decides — and which is there for the sentence it prints — is written against
 * each below. The short version is that "the charged amount" is not one field,
 * and asking only the obvious one would delete rows that plainly have money on
 * them.
 *
 * ── THE TICKETS DO NOT COME BACK, AND IT SAYS SO ───────────────────────────
 *
 * The ticket ledger is append-only and does not hang off a task by a foreign
 * key, so removing a claim leaves its deduction standing. That is honest — the
 * tickets really were spent — but it means this command costs tickets where
 * ./free-claims returns them. It prints how many, every run, and says which
 * command to run first if you want them back. It does NOT quietly top anybody
 * up: a ticket count that is adjusted by a convenience script is no longer a
 * record of anything.
 *
 * ── AMAZON ONLY, THIS ACCOUNT ONLY ─────────────────────────────────────────
 *
 * The rows are chosen by THE CAMPAIGN'S marketplace, not the task's own copy of
 * it. Both columns exist and normally agree; the campaign is the one the owner
 * asked about and the one a person reading the panel sees.
 *
 *   npx ts-node scripts/reset-amazon-campaigns.ts
 *
 * See scripts/reset-amazon-campaigns.ts for the command itself, and
 * ./reset-amazon-campaigns at the top of the project for the one people type.
 */
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, Task } from '@prisma/client';
import { DEMO_MOBILE_DEFAULT } from '../prisma/demo-seed';
import { maskMobile } from '../src/auth/sms/mask';
import type { Env } from '../src/config/env.validation';
import { PrismaService } from '../src/prisma/prisma.service';
import { resolveChargedPaise } from '../src/tasks/engine/charged-amount';
import { isAPracticeDatabase } from '../src/tasks/engine/practice-window';
import { toEngineTask } from '../src/tasks/task.mapper';
import { TicketService } from '../src/tickets/ticket.service';

export interface ResetAmazonClaimsOptions {
  /** Suppress the printing. The end to end run does. */
  quiet?: boolean;
  /** Bypass the live lookup, for testing the refusal itself. */
  databaseNameOverride?: string;
  /** Whose claims to remove. Defaults to the practice account. */
  mobile?: string;
}

/** One row that was removed, and what removing it cost. */
export interface DeletedClaim {
  taskId: string;
  offer: string;
  /** The product's own word for how far it got. Recorded, never consulted. */
  state: string;
  /**
   * Tickets taken for this claim that are NOT coming back, read off the ledger.
   * Net, so a claim whose tickets were already returned counts as nothing lost.
   */
  ticketsGone: number;
}

/** One row that was NOT removed, and what was found on it. */
export interface LeftAloneClaim {
  taskId: string;
  offer: string;
  state: string;
  /** The sentence the owner asked for. */
  reason: string;
  /** Every kind of money that was found, in words. */
  found: string[];
}

/** One row that could not be removed, with what the database said. */
export interface CouldNotDelete {
  taskId: string;
  offer: string;
  said: string;
}

export interface ResetAmazonClaimsReport {
  /** The account, with all but the last two digits covered over. */
  account: string;
  databaseName: string;
  deleted: DeletedClaim[];
  leftAlone: LeftAloneClaim[];
  couldNotDelete: CouldNotDelete[];
  /** How many rows went, grouped by the offer they were claiming. */
  byOffer: { offer: string; howMany: number }[];
  ticketsGone: number;
  ticketsNow: number;
}

/** The one sentence the owner asked for, spelled once. */
export const LEFT_ALONE_SENTENCE = 'left alone — has money against it.';

export async function resetAmazonClaims(
  app: INestApplicationContext,
  opts: ResetAmazonClaimsOptions = {},
): Promise<ResetAmazonClaimsReport> {
  const prisma = app.get(PrismaService);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const tickets = app.get(TicketService);

  const say = (m: string): void => {
    if (!opts.quiet) console.log(m);
  };

  // FIRST, BEFORE A SINGLE ROW IS READ. A refusal that has already deleted half
  // the rows is not a refusal.
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
        + 'is nothing to reset. Put the practice data in first, with ./start, or '
        + 'name the account you meant.',
    );
  }

  say('');
  say(`Removing the Amazon claims held by the practice account ${account}.`);
  say(`The database is ${databaseName}.`);
  say(
    'ROWS ARE DELETED, NOT CLOSED, because only a deleted row gives the seat '
      + 'back.',
  );

  // AMAZON, AND THIS ACCOUNT, AND NOTHING ELSE. Both halves matter: another
  // account's rows are not ours to remove, and another marketplace's campaigns
  // were not asked about.
  //
  // NO STATE IS CONSULTED AT ALL. Whatever a row got to — still waiting, bought,
  // waiting out the return window, expired unpurchased — it goes, unless there is
  // money against it. That is the owner's rule and it is also the simpler one:
  // the moment a state is named here, a state added next month is silently
  // outside the list.
  const where: Prisma.TaskWhereInput = {
    userId: user.id,
    campaign: { platform: 'AMAZON' },
  };
  const rows = await prisma.task.findMany({
    where,
    include: { campaign: true },
    orderBy: { createdAt: 'asc' },
  });

  const deleted: DeletedClaim[] = [];
  const leftAlone: LeftAloneClaim[] = [];
  const couldNotDelete: CouldNotDelete[] = [];

  for (const row of rows) {
    const offer = row.campaign.title;
    const state = row.state;

    const found = await moneyAgainst(prisma, row);
    if (found.length > 0) {
      leftAlone.push({
        taskId: row.id,
        offer,
        state,
        reason: LEFT_ALONE_SENTENCE,
        found,
      });
      continue;
    }

    // READ BEFORE THE ROW GOES. The ledger survives the deletion either way —
    // ticket_entries.task_id carries no foreign key — but reading it afterwards
    // would mean reporting a cost after paying it.
    const ticketsGone = await ticketsSpentOn(prisma, row.id);

    try {
      await prisma.task.delete({ where: { id: row.id } });
    } catch (err) {
      // NAMED, NEVER SWALLOWED, AND KEPT OUT OF THE "left alone" COUNT. "Left
      // alone because there is money against it" and "we tried and could not"
      // are different facts, and one summary number covering both would hide the
      // second behind the first.
      //
      // NO CHECK REACHES THIS BRANCH TODAY, and that is written down rather than
      // left to look like coverage. Every row that hangs off a task — its
      // history, its visibility checks, its screenshots, its order candidates —
      // is set to go with it, so nothing in the schema can refuse the deletion
      // and no check can honestly build a row that does. A mutation that folds
      // this list into the left-alone one therefore passes, and is reported as
      // passing. It stays because the day something DOES hold a row down, the
      // alternative is a command that says it deleted rows it did not.
      couldNotDelete.push({
        taskId: row.id,
        offer,
        said: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    deleted.push({ taskId: row.id, offer, state, ticketsGone });
  }

  const report: ResetAmazonClaimsReport = {
    account,
    databaseName,
    deleted,
    leftAlone,
    couldNotDelete,
    byOffer: groupByOffer(deleted),
    ticketsGone: deleted.reduce((sum, d) => sum + d.ticketsGone, 0),
    ticketsNow: await tickets.getBalance(user.id),
  };

  print(say, report);
  return report;
}

/** Everything printed, in one place, so the shape is easy to read and change. */
function print(
  say: (m: string) => void,
  report: ResetAmazonClaimsReport,
): void {
  say('');
  if (report.deleted.length === 0) {
    say('NOTHING WAS DELETED.');
  } else {
    say(`DELETED ${countOf(report.deleted.length, 'row', 'rows')}:`);
  }
  for (const group of report.byOffer) {
    say(`  ${group.offer}  (${countOf(group.howMany, 'row', 'rows')})`);
  }

  say('');
  if (report.leftAlone.length === 0) {
    say('NOTHING WAS LEFT ALONE. No Amazon row had money against it.');
  } else {
    say(
      `LEFT ALONE ${countOf(report.leftAlone.length, 'row', 'rows')}, `
        + 'because there is money against them:',
    );
  }
  for (const l of report.leftAlone) {
    say(`  ${l.offer}  ${l.taskId}`);
    say(`      ${l.reason}`);
    say(`      What was found: ${listOf(l.found)}.`);
  }

  if (report.couldNotDelete.length > 0) {
    say('');
    say(
      `COULD NOT BE DELETED, ${countOf(report.couldNotDelete.length, 'row', 'rows')}. `
        + 'These are still there and still hold their seats:',
    );
    for (const c of report.couldNotDelete) {
      say(`  ${c.offer}  ${c.taskId}`);
      say(`      The database said: ${c.said}`);
    }
  }

  say('');
  say(
    `${countOf(report.ticketsGone, 'ticket', 'tickets')} `
      + 'were taken for the rows that are gone, and they are not coming back.',
  );
  say(
    `The practice account now has ${countOf(report.ticketsNow, 'ticket', 'tickets')}.`,
  );
  say(
    '  ./free-claims is the command that gives tickets back. Run that one FIRST '
      + 'if you want them.',
  );
  say('No campaign was changed, and no other marketplace was touched.');
  say('');
}

/**
 * IS THERE MONEY AGAINST THIS ROW? Asked FOUR ways, and only ONE of them decides.
 *
 * ── ONE, THE CHARGED AMOUNT ITSELF — which decides nothing, and is kept ────
 *
 * The figure a refund would actually be based on. There is no chargedPaise
 * COLUMN on a task: it is worked out from the evidence by resolveChargedPaise,
 * which is the product's only definition of it and so the only honest thing to
 * ask for.
 *
 * SAID PLAINLY: THIS CANNOT REFUSE A ROW THAT TWO WOULD HAVE ALLOWED. Every
 * figure it can return is derived from one of the fields question two already
 * reads, so as a guard it is redundant and it is not pretended otherwise. It is
 * here for the SENTENCE — "a charged amount of ₹1,299.00" is the one line that
 * tells the owner why a row was kept in the terms the refund is paid in, and a
 * list of raw fields is not that. The check below asserts that wording.
 *
 * ── TWO, EVERY MONEY FIELD ON THE ORDER — this is the one that decides ─────
 *
 * Whatever resolveChargedPaise made of them. This is not belt-and-braces: that
 * function answers null ON PURPOSE in every case a human has to decide the
 * amount — an unknown quantity, an item figure above the total, a gap too wide
 * to be a coupon, or an order total with no item line at all, which is the
 * ordinary shape whenever the item row cannot be read. Those rows have real
 * amounts read off a real order, and asking only question one would delete every
 * single one of them.
 *
 * ── THREE, THE LEGACY COLUMN, and why reading a documented trap is safe here ─
 *
 * task.mapper.ts says DO NOT READ THE itemPaise COLUMN: it is a legacy
 * projection, null on essentially every task the current code produces, and a
 * report written against it would understate the money. That warning points at
 * queries that would report LESS money than there is. This asks the opposite
 * question — the column can only ever make this command refuse a row it might
 * have deleted, never delete one it should have kept — so the trap points the
 * safe way round here, and on an irreversible command that is worth one line.
 *
 * ── FOUR, THE WALLET AND THE LEDGER ────────────────────────────────────────
 *
 * Asked of the database rather than reasoned about — the same query shape as
 * scripts/free-practice-claims.ts, for the same reason recorded there. "A row
 * like this cannot have money moved against it" is exactly the sort of thing
 * that stays true until somebody adds a step.
 *
 * ── WHAT IS DELIBERATELY NOT COUNTED ───────────────────────────────────────
 *
 *   - mrpPaise, a shop's sticker price. Nobody was ever charged it and the
 *     product refuses to pay from it anywhere, so a row carrying only an MRP has
 *     no money against it and goes. There is a check that says so.
 *   - TICKETS. Every claim has tickets taken for it by definition, so counting
 *     them as money would refuse every row, always, and the command would do
 *     nothing on every run.
 */
async function moneyAgainst(
  prisma: PrismaService,
  row: Task,
): Promise<string[]> {
  const found: string[] = [];
  const order = toEngineTask(row, []).order;

  // ONE.
  const charged = resolveChargedPaise(order);
  if (charged.paise != null && charged.paise !== 0n) {
    found.push(`a charged amount of ${rupees(charged.paise)}`);
  }

  // TWO.
  const onTheOrder: [string, bigint | null | undefined][] = [
    ['what one unit was charged', order?.unitPricePaise],
    ['what the whole line was charged', order?.lineTotalPaise],
    ['an item figure', order?.itemPaise],
    ['an order total', order?.orderTotalPaise],
  ];
  for (const [what, paise] of onTheOrder) {
    if (paise != null && paise !== 0n) {
      found.push(`${what} of ${rupees(paise)}`);
    }
  }

  // THREE. The legacy column, which points the safe way round here.
  if (row.itemPaise != null && row.itemPaise !== 0n) {
    found.push(`a verified item price of ${rupees(row.itemPaise)}`);
  }

  // FOUR.
  const movements = await prisma.ledgerTransaction.findMany({
    where: { referenceType: 'task', referenceId: row.id },
    select: { id: true },
  });
  if (movements.length > 0) {
    const ids = movements.map((m) => m.id);
    found.push(
      `${countOf(movements.length, 'movement', 'movements')} of money in the wallet`,
    );
    const walletEntries = await prisma.walletEntry.count({
      where: { transactionId: { in: ids } },
    });
    if (walletEntries > 0) {
      found.push(
        `${countOf(walletEntries, 'entry', 'entries')} written down against it`,
      );
    }
    const withdrawals = await prisma.withdrawal.count({
      where: {
        OR: [{ reserveTxnId: { in: ids } }, { reversalTxnId: { in: ids } }],
      },
    });
    if (withdrawals > 0) {
      found.push(
        `${countOf(withdrawals, 'withdrawal', 'withdrawals')} that used it`,
      );
    }
  }

  return found;
}

/**
 * TICKETS TAKEN FOR THIS CLAIM THAT WILL NOT COME BACK, read off the ledger.
 *
 * NET, not "the claim cost". A claim that already expired had its tickets
 * returned through the same ledger, so its deduction and its return cancel and
 * nothing is lost by removing the row. Reporting the deduction alone would tell
 * the owner he had just lost tickets he got back a week ago.
 *
 * Never below zero. A row that somehow returned more than it took is a ledger
 * problem to look at, not a negative loss to add into a total.
 */
async function ticketsSpentOn(
  prisma: PrismaService,
  taskId: string,
): Promise<number> {
  const entries = await prisma.ticketEntry.findMany({
    where: { taskId },
    select: { delta: true },
  });
  const net = entries.reduce((sum, e) => sum + e.delta, 0);
  return net < 0 ? -net : 0;
}

/** How many rows went, per offer, in the order they were first seen. */
function groupByOffer(
  deleted: DeletedClaim[],
): { offer: string; howMany: number }[] {
  const counts = new Map<string, number>();
  for (const d of deleted) {
    counts.set(d.offer, (counts.get(d.offer) ?? 0) + 1);
  }
  return [...counts].map(([offer, howMany]) => ({ offer, howMany }));
}

/**
 * The same refusal practice-window.service.ts makes, made again here, from the
 * same one function so there is only ever ONE spelling of the rule.
 *
 * It asks the LIVE CONNECTION its own name, not DATABASE_URL, because those two
 * can disagree — a connection string edited to point somewhere else is exactly
 * the mistake this guard exists for, and a guard that read the setting the
 * connection was made from would agree with the mistake.
 *
 * AND IT FAILS CLOSED. A name that cannot be read at all is not a practice
 * database. This one DELETES rows, so the cost of being wrong the other way is
 * somebody's real records gone with no way to get them back.
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
      `Resetting the Amazon claims refused: "${name}" is not a practice or `
        + 'development database. This DELETES task rows, and on a real database '
        + 'those are the record of what people claimed and what they are owed.',
    );
  }
  return name;
}

/**
 * The practice account named in the settings, EXCEPT NEVER DURING A TEST RUN.
 *
 * The same rule the demo seed and ./free-claims follow, and for the reason
 * written down in both: a test whose result depends on a settings file git has
 * never seen is not a test. A run that wants a particular account hands it in.
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

/** Paise to something a person can read. The maths stays in whole paise. */
function rupees(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  return `${negative ? '-' : ''}₹${(abs / 100n).toString()}.${(abs % 100n)
    .toString()
    .padStart(2, '0')}`;
}

/** "one thing, another thing and a third", so a list reads as a sentence. */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "1 row", "5 rows", so no sentence has to say "row or rows". */
function countOf(howMany: number, one: string, many: string): string {
  return `${howMany} ${howMany === 1 ? one : many}`;
}
