/**
 * GIVE AN ITEM PRICE TO THE TASKS THAT WERE CONFIRMED BEFORE WE COULD READ ONE.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * A task's item price is written ONCE, when somebody says "yes, that order is
 * mine". Until 16 September 2026, itemPriceIsCertain asked only one question —
 * is the WHOLE BILL exactly this product's price? — which is a way of proving a
 * quantity of one on a page that states no price per product. On an Amazon page,
 * which states a price beside every product, it proves nothing and refuses
 * everything.
 *
 * So every task confirmed on a multi-product order carries no item price, and
 * NOTHING WOULD EVER GIVE IT ONE: the amount is written when the order is
 * chosen, and an order is chosen once. The owner's own task sat in the staff
 * queue reading "item price unknown" with ₹938.00 printed twice on the page it
 * had been read from. The only route out was to claim the offer again, which is
 * not a thing a real person can be asked to do.
 *
 * This is the command that fills those in.
 *
 * ── IT FILLS NULLS. IT NEVER REPLACES AN ANSWER ───────────────────────────
 *
 * A price already on a task may already have been acted on: a refund computed
 * from it, a person told what they are getting, a staff member's own figure
 * entered by hand after looking at the order themselves. Any of those and the
 * row is left exactly where it is and named in the output, with what was found
 * on it. That is the same treatment ./reset-amazon-campaigns gives a row with
 * money against it, and for the same reason.
 *
 * AND "ALREADY HAS ONE" IS ASKED WIDER THAN THE OBVIOUS FIELD. The tasks.itemPaise
 * COLUMN is a legacy projection that task.mapper.ts warns is null on essentially
 * every task the current code produces — a task settled through unitPricePaise
 * has a null column and a real price. So this asks the product's own definition
 * of the charged amount (resolveChargedPaise) AND every item-price field on the
 * order AND the column, and any one of them answering means hands off. The one
 * money field deliberately NOT counted is the order total: chooseMine puts the
 * bill on every task it touches, so counting it would mean this command refused
 * every row it exists to fix.
 *
 * ── IT DECIDES NOTHING ABOUT MONEY FOR ITSELF ─────────────────────────────
 *
 * Which price, and whether it is certain, are asked of matchOrderToCampaign and
 * itemPriceIsCertain — the same two functions the live path asks, with the same
 * campaign price. There is no second rule about somebody's refund in this file
 * and no second idea of what "certain" means. The evidence goes in through
 * TaskService.submitEvidence, so the order window rule, the plausibility gate,
 * the promoted columns and the refund gate all apply exactly as they do to a
 * person tapping "yes, that is mine".
 *
 * ── IT MOVES NO STATE AND PAYS NOBODY ─────────────────────────────────────
 *
 * The evidence carries an order and nothing else — no delivery, no review — so
 * the furthest transition() can take a task is PURCHASED, and every task this
 * command touches is already at least that (it has an orderId). Nothing here
 * releases a refund, posts a ledger entry or approves anything. It gives the
 * ordinary gates a figure they were missing and stands back.
 *
 * ── THE PRACTICE-DATABASE GUARD, AND WHY IT IS HERE TOO ───────────────────
 *
 * This WRITES rather than deletes, so it is the gentler of the pair. It is
 * guarded all the same, from the same one function, because it writes a figure
 * a refund is computed from — and a convenience script that can put a number on
 * somebody's real payout is not a convenience script.
 *
 *   npx ts-node scripts/settle-known-item-prices.ts
 *   npx ts-node scripts/settle-known-item-prices.ts <mobile>
 *   npx ts-node scripts/settle-known-item-prices.ts --dry-run
 *
 * NO NUMBER IS WRITTEN IN THE EXAMPLE, deliberately. A number in a command is a
 * number that ends up in a screenshot, a terminal history and a bug report.
 *
 * See ./settle-known-item-prices at the top of the project for the one people
 * type.
 *
 * ── ONE FILE, WHERE THE OTHER COMMANDS USE TWO, AND WHY ───────────────────
 *
 * ./reset-amazon-campaigns splits a thin entry (reset-amazon-campaigns.ts) from
 * its work (reset-amazon-claims.ts), and the split leaves a wrapper whose name
 * matches neither half of what it runs — which nothing in the repository
 * explains. The reason for the split is that the work must be importable by a
 * check without a main() running, and a `require.main` guard buys that in one
 * line. So the work is exported here exactly as resetAmazonClaims is exported
 * there, the check calls it the same way, and the command is at the bottom.
 */
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { DEMO_MOBILE_DEFAULT } from '../prisma/demo-seed';
import { maskMobile } from '../src/auth/sms/mask';
import type { Env } from '../src/config/env.validation';
import { matchOrderToCampaign } from '../src/ocr/order-comparison';
import { PrismaService } from '../src/prisma/prisma.service';
import { resolveChargedPaise } from '../src/tasks/engine/charged-amount';
import { isAPracticeDatabase } from '../src/tasks/engine/practice-window';
import { SOURCES } from '../src/tasks/engine/states';
import {
  itemPriceIsCertain,
  itemsFromJson,
  whatTheOrderAlreadySays,
} from '../src/tasks/order-candidates';
import type { EvidenceOrder } from '../src/tasks/engine/evidence.types';
import type { SubmitEvidenceDto } from '../src/tasks/dto/submit-evidence.dto';
import { toEngineTask } from '../src/tasks/task.mapper';
import { TaskService } from '../src/tasks/task.service';

export interface SettleKnownItemPricesOptions {
  /** Suppress the printing. The end to end run does. */
  quiet?: boolean;
  /** Bypass the live lookup, for testing the refusal itself. */
  databaseNameOverride?: string;
  /** Whose tasks to settle. Defaults to the practice account. */
  mobile?: string;
  /** Read everything, decide everything, write nothing. */
  dryRun?: boolean;
}

/** One task that was given a price, and which price. */
export interface SettledTask {
  taskId: string;
  offer: string;
  state: string;
  orderId: string;
  /** What the shop's page said this product cost. Integer paise, as text. */
  itemPricePaise: string;
  /** The whole bill on that order, for the sentence. Null if none was read. */
  orderTotalPaise: string | null;
}

/** One task that was NOT given a price, and why not. */
export interface LeftAloneTask {
  taskId: string;
  offer: string;
  state: string;
  /** The sentence a person reads. */
  reason: string;
  /** Everything that was found, in words. Empty when the reason is not money. */
  found: string[];
}

/** One task whose evidence the ordinary gates refused, and what they said. */
export interface CouldNotSettle {
  taskId: string;
  offer: string;
  said: string;
}

export interface SettleKnownItemPricesReport {
  /** The account, with all but the last two digits covered over. */
  account: string;
  databaseName: string;
  dryRun: boolean;
  /** How many tasks were looked at at all. */
  considered: number;
  settled: SettledTask[];
  leftAlone: LeftAloneTask[];
  couldNotSettle: CouldNotSettle[];
  /** How many were settled, grouped by the offer they were claiming. */
  byOffer: { offer: string; howMany: number }[];
}

/** The one sentence for a task that already has an answer. */
export const ALREADY_HAS_ONE_SENTENCE =
  'left alone — it already has an item price.';

/**
 * The one sentence for a task whose page cannot settle the price.
 *
 * NOTHING REACHES THIS TODAY, and that is written down rather than left to look
 * like coverage. matchOrderToCampaign only ever answers `matches: true` for an
 * item whose price EQUALS the campaign's (order-comparison.ts:535), and
 * itemPriceIsCertain — handed that same campaign price — asks exactly the same
 * equality. So a price that differs is refused one step earlier, by the match,
 * and the certainty question is never reached with a "no".
 *
 * IT STAYS ANYWAY, for the same reason reset-amazon-claims.ts keeps a branch no
 * check reaches: it is the guard that holds on the day matchOrderToCampaign
 * stops requiring the price to be equal, and a command that wrote a figure on
 * that day would be writing a number nobody had checked. A mutation that deletes
 * it therefore passes, and is reported as passing.
 */
export const NOT_CERTAIN_SENTENCE =
  'left alone — the order page cannot settle the price on its own.';

/** The one sentence for a task whose stored order is no longer the offer's. */
export const NO_LONGER_MATCHES_SENTENCE =
  'left alone — the stored order is not this offer’s product any more.';

export async function settleKnownItemPrices(
  app: INestApplicationContext,
  opts: SettleKnownItemPricesOptions = {},
): Promise<SettleKnownItemPricesReport> {
  const prisma = app.get(PrismaService);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const tasks = app.get(TaskService);

  const say = (m: string): void => {
    if (!opts.quiet) console.log(m);
  };

  // FIRST, BEFORE A SINGLE ROW IS READ. A refusal that has already written half
  // the figures is not a refusal.
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
        + 'is nothing to settle. Put the practice data in first, with ./start, '
        + 'or name the account you meant.',
    );
  }

  say('');
  say(`Settling item prices for the practice account ${account}.`);
  say(`The database is ${databaseName}.`);
  if (opts.dryRun) {
    say('DRY RUN. Everything is read and decided, and nothing is written.');
  }
  say(
    'ONLY TASKS WITH NO PRICE AT ALL ARE TOUCHED. Anything that already has one '
      + 'is left where it is and named.',
  );

  // THE ROWS THIS COMMAND IS ABOUT: this account's, with an order on them, and
  // an order candidate somebody said was theirs.
  //
  // NO STATE IS CONSULTED. Whatever a task got to, an item price it should have
  // had is an item price it should have had — and naming states here would put
  // a state added next month silently outside the list.
  //
  // ── AND WHAT IT DOES NOT REACH, SAID PLAINLY ──────────────────────────
  //
  // `orderId: { not: null }` is the owner's own wording for which tasks to fix,
  // and it is kept. It does mean two shapes are outside this command, and
  // neither is a silent omission:
  //
  //   A CHOSEN CANDIDATE WHOSE PAGE PRINTED NO ORDER NUMBER. The column is
  //     nullable and `matches` is decided on the products alone, so this is
  //     possible; the task then has no orderId and is not found here. It is also
  //     the shape where the least is known about which purchase it was, which is
  //     not a shape to be writing refund figures onto from a script.
  //   A TASK SETTLED BY OCR OR BY A STAFF MEMBER. Those have an amount already
  //     and would be left alone by the guard below in any case.
  //
  // Both are reachable by hand through the ordinary staff route, which is where
  // an order nobody can name belongs.
  const where: Prisma.TaskWhereInput = {
    userId: user.id,
    orderId: { not: null },
    orderCandidates: { some: { chosenAt: { not: null } } },
  };
  const rows = await prisma.task.findMany({
    where,
    include: {
      campaign: true,
      orderCandidates: { where: { chosenAt: { not: null } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const settled: SettledTask[] = [];
  const leftAlone: LeftAloneTask[] = [];
  const couldNotSettle: CouldNotSettle[] = [];

  for (const row of rows) {
    const offer = row.campaign.title;
    const state = row.state;

    // READ ONCE. The guard below asks it, and the evidence carries it forward.
    const existing = toEngineTask(row, []).order;

    // ── ONE. HAS IT ALREADY GOT AN ANSWER? ──────────────────────────────
    const has = itemPriceAlreadyOn(row, existing);
    if (has.length > 0) {
      leftAlone.push({
        taskId: row.id,
        offer,
        state,
        reason: ALREADY_HAS_ONE_SENTENCE,
        found: has,
      });
      continue;
    }

    const chosen = row.orderCandidates[0];
    if (chosen == null) continue;

    // ── TWO. IS THE STORED ORDER STILL THIS OFFER'S PRODUCT? ────────────
    //
    // Asked again rather than remembered. A campaign can be edited between the
    // day somebody confirmed their order and today, and the answer has to be
    // true NOW — the same reason chooseMine re-asks it at the moment of the tap.
    const items = itemsFromJson(chosen.items);
    const answer = matchOrderToCampaign(
      { items },
      {
        productName: row.campaign.productName,
        expectedPricePaise: row.campaign.productPricePaise,
      },
    );
    if (!answer.matches || answer.item == null) {
      leftAlone.push({
        taskId: row.id,
        offer,
        state,
        reason: NO_LONGER_MATCHES_SENTENCE,
        found: [],
      });
      continue;
    }

    // ── THREE. IS THE PRICE CERTAIN? THE SAME FUNCTION, THE SAME ANSWER ──
    const certain = itemPriceIsCertain(
      { totalPaise: chosen.totalPaise, shipments: chosen.shipments, items },
      answer.item,
      row.campaign.productPricePaise,
    );
    if (!certain) {
      leftAlone.push({
        taskId: row.id,
        offer,
        state,
        reason: NOT_CERTAIN_SENTENCE,
        found: [],
      });
      continue;
    }

    const price = typeof answer.item.pricePaise === 'bigint'
      ? answer.item.pricePaise
      : BigInt(Math.trunc(answer.item.pricePaise));

    const record: SettledTask = {
      taskId: row.id,
      offer,
      state,
      orderId: row.orderId ?? chosen.orderNumber ?? '',
      itemPricePaise: price.toString(),
      orderTotalPaise:
        chosen.totalPaise == null ? null : chosen.totalPaise.toString(),
    };

    if (opts.dryRun) {
      settled.push(record);
      continue;
    }

    // ── FOUR. IN THROUGH THE ONE FUNNEL, EXACTLY AS chooseMine DOES ──────
    //
    // Same fields, same sources, same road. The key carries the FIGURE, so a
    // second run that finds the same price is one event and not two, while a
    // price that has genuinely changed is a different fact and applies — where
    // the ordinary gates then judge it, as they judge everything else.
    const dto: SubmitEvidenceDto = {
      key: `settle-item-price:${chosen.id}:${price.toString()}`,
      order: {
        // ── WHAT THE TASK ALREADY SAYS, CARRIED FIRST ───────────────────
        //
        // transition() REPLACES the order with the incoming one; it does not
        // merge field by field. So a fragment naming eight fields does not
        // update eight fields — it deletes everything else. Without this line
        // this command settled a price and blanked the order date, the product
        // photo, the shop's status line, the line id and the match warnings, on
        // every task it touched. It would have erased the very date the rest of
        // this changeset was written to show. See whatTheOrderAlreadySays.
        ...whatTheOrderAlreadySays(existing),
        id: chosen.orderNumber ?? existing?.id ?? undefined,
        product: answer.item.name,
        orderTotalPaise:
          chosen.totalPaise == null ? undefined : String(chosen.totalPaise),
        unitPricePaise: String(price),
        quantity: 1,
        matchedPricePaise: String(price),
        amountSource: SOURCES.ORDER_HISTORY,
        source: SOURCES.ORDER_HISTORY,
      },
    };

    try {
      await tasks.submitEvidence(row.userId, row.id, dto);
      settled.push(record);
    } catch (err) {
      // NAMED, NEVER SWALLOWED, AND KEPT OUT OF THE "left alone" COUNT.
      // "It already had a price" and "the gates refused the one we offered" are
      // different facts, and one number covering both would hide the second
      // behind the first. A refusal here is the ordinary gates doing their job —
      // an order window, a plausibility rule — and is reported as their words.
      couldNotSettle.push({
        taskId: row.id,
        offer,
        said: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const report: SettleKnownItemPricesReport = {
    account,
    databaseName,
    dryRun: opts.dryRun === true,
    considered: rows.length,
    settled,
    leftAlone,
    couldNotSettle,
    byOffer: groupByOffer(settled),
  };

  print(say, report);
  return report;
}

/** Everything printed, in one place, so the shape is easy to read and change. */
function print(
  say: (m: string) => void,
  report: SettleKnownItemPricesReport,
): void {
  say('');
  say(
    `${countOf(report.considered, 'task', 'tasks')} had an order and an order `
      + 'somebody said was theirs.',
  );

  say('');
  if (report.settled.length === 0) {
    say('NOTHING WAS SETTLED.');
  } else {
    say(
      `${report.dryRun ? 'WOULD SETTLE' : 'SETTLED'} `
        + `${countOf(report.settled.length, 'task', 'tasks')}:`,
    );
  }
  for (const s of report.settled) {
    say(`  ${s.offer}  ${s.taskId}`);
    say(
      `      item price ${rupees(BigInt(s.itemPricePaise))}`
        + (s.orderTotalPaise == null
          ? ''
          : `, on an order billed ${rupees(BigInt(s.orderTotalPaise))}`),
    );
  }
  for (const group of report.byOffer) {
    say(`  ${group.offer}  (${countOf(group.howMany, 'task', 'tasks')})`);
  }

  say('');
  if (report.leftAlone.length === 0) {
    say('NOTHING WAS LEFT ALONE.');
  } else {
    say(`LEFT ALONE ${countOf(report.leftAlone.length, 'task', 'tasks')}:`);
  }
  for (const l of report.leftAlone) {
    say(`  ${l.offer}  ${l.taskId}`);
    say(`      ${l.reason}`);
    if (l.found.length > 0) {
      say(`      What was found: ${listOf(l.found)}.`);
    }
  }

  if (report.couldNotSettle.length > 0) {
    say('');
    say(
      `COULD NOT BE SETTLED, ${countOf(report.couldNotSettle.length, 'task', 'tasks')}. `
        + 'The ordinary gates refused the price, in their own words:',
    );
    for (const c of report.couldNotSettle) {
      say(`  ${c.offer}  ${c.taskId}`);
      say(`      It said: ${c.said}`);
    }
  }

  say('');
  say('No state was moved and no money was paid. The usual gates decide what');
  say('happens next, exactly as they do for anybody tapping "yes, that is mine".');
  say('');
}

/**
 * HAS THIS TASK ALREADY GOT AN ITEM PRICE? Asked three ways, and any one of them
 * answering means hands off.
 *
 * ── ONE, THE PRODUCT'S OWN DEFINITION OF THE CHARGED AMOUNT ───────────────
 *
 * resolveChargedPaise is the only thing in Fayr that decides what a refund is
 * worked out from, so it is the only honest thing to ask. A figure here means a
 * refund could already have been computed.
 *
 * ── TWO, EVERY ITEM-PRICE FIELD ON THE ORDER ──────────────────────────────
 *
 * Because question one answers NULL ON PURPOSE in every case a human has to
 * decide — an unknown quantity, an item figure above the total, a gap too wide
 * to be a coupon. Those orders carry real amounts read off real pages, and a
 * command that overwrote them because the resolver would not compute from them
 * would be writing over the very evidence the staff member is looking at.
 *
 * ── THREE, THE LEGACY COLUMN ──────────────────────────────────────────────
 *
 * task.mapper.ts says DO NOT READ THE itemPaise COLUMN: it is a projection that
 * is null on essentially every task the current code produces, so a report
 * written against it understates the money. That warning is about queries that
 * would find LESS money than there is. This asks the opposite question — the
 * column can only ever make this command refuse a row it might have written to,
 * never write to one it should have left — so the trap points the safe way round
 * here, exactly as it does in ./reset-amazon-campaigns.
 *
 * ── WHAT IS DELIBERATELY NOT COUNTED ──────────────────────────────────────
 *
 *   - THE ORDER TOTAL. chooseMine puts the whole bill on every task it touches,
 *     so counting it would mean this command refused every single row it exists
 *     to fix. It is also not an item price by definition: on the owner's own
 *     order the bill was ₹1,331.00 and the product was ₹938.00.
 *   - mrpPaise, a shop's sticker price. Nobody was ever charged it and the
 *     product refuses to pay from it anywhere.
 *   - matchedPricePaise, which is a display fact and never a refund basis.
 */
function itemPriceAlreadyOn(
  row: { itemPaise: bigint | null },
  order: EvidenceOrder | null,
): string[] {
  const found: string[] = [];

  // ONE.
  const charged = resolveChargedPaise(order);
  if (charged.paise != null && charged.paise !== 0n) {
    found.push(`a charged amount of ${rupees(charged.paise)}`);
  }

  // TWO. The item-price fields only. The order total is not one of them.
  const onTheOrder: [string, bigint | null | undefined][] = [
    ['what one unit was charged', order?.unitPricePaise],
    ['what the whole line was charged', order?.lineTotalPaise],
    ['an item figure', order?.itemPaise],
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

  return found;
}

/** How many were settled, per offer, in the order they were first seen. */
function groupByOffer(
  settled: SettledTask[],
): { offer: string; howMany: number }[] {
  const counts = new Map<string, number>();
  for (const s of settled) {
    counts.set(s.offer, (counts.get(s.offer) ?? 0) + 1);
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
 * database. This one writes a figure a refund is computed from, so the cost of
 * being wrong the other way is a number nobody chose landing on somebody's real
 * payout.
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
      `Settling item prices refused: "${name}" is not a practice or `
        + 'development database. This WRITES the figure a refund is computed '
        + 'from, and on a real database that is somebody’s money.',
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

/** "1 task" / "3 tasks", so no sentence ever reads "1 tasks". */
function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * THE COMMAND ITSELF, at the bottom rather than in a file of its own.
 *
 * It starts Fayr's own backend, runs the settling, prints what it did and stops
 * again. The `require.main` guard is what lets the work above be imported by a
 * check without any of this running — which is the only thing the two-file split
 * used elsewhere buys, bought here in one line.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // ── AN UNKNOWN FLAG IS A REFUSAL, NOT A SHRUG ───────────────────────────
  //
  // `--dry-run` is the flag that means "write nothing", so a near miss —
  // --dryrun, --dry_run, --dry-run=1 — used to be dropped silently and the
  // command did the writing run against the practice account instead. The one
  // typo a person is most likely to make is the one that must not be ignored.
  const known = ['--dry-run'];
  const unknown = args.filter((a) => a.startsWith('--') && !known.includes(a));
  if (unknown.length > 0) {
    throw new Error(
      `I do not know the option ${unknown.join(' ')}. `
        + `The only one is --dry-run, which decides everything and writes `
        + 'nothing. Nothing has been changed.',
    );
  }
  const dryRun = args.includes('--dry-run');
  const mobile = args.find((a) => !a.startsWith('--'));

  // Imported here rather than at the top so that importing this file for a check
  // does not drag the whole application module in behind it.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    await settleKnownItemPrices(app, {
      ...(mobile == null ? {} : { mobile }),
      dryRun,
    });
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // The message, not the stack. Every way this stops on purpose stops with a
    // sentence written to be read, and a page of internals underneath it would
    // only make that sentence harder to find.
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
