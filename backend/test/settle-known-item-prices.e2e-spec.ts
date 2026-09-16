import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import {
  ALREADY_HAS_ONE_SENTENCE,
  NOT_CERTAIN_SENTENCE,
  NO_LONGER_MATCHES_SENTENCE,
  settleKnownItemPrices,
} from '../scripts/settle-known-item-prices';
import { PrismaService } from '../src/prisma/prisma.service';
import type { SubmitEvidenceDto } from '../src/tasks/dto/submit-evidence.dto';
import { itemsToJson } from '../src/tasks/order-candidates';
import { toTaskResponse } from '../src/tasks/task.response';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { AppModule } from '../src/app.module';
import { resetDatabase } from './reset-db';

/**
 * GIVING AN ITEM PRICE TO THE TASKS THAT WERE CONFIRMED BEFORE WE COULD READ ONE.
 *
 * ── THE STATE THIS COMMAND EXISTS FOR, MEASURED ───────────────────────────
 *
 * The owner's own order, 16 September 2026. One order number, two products:
 *
 *     Lukzer | Heavy-Duty Metal Garment Rack ...     ₹938.00
 *     SR 2 PES ... Bathroom Corner Shelf ...         ₹388.00
 *     Grand Total:                                 ₹1,331.00
 *
 * The offer is the garment rack at ₹938.00. Until 16 September the only question
 * itemPriceIsCertain asked was "is the WHOLE BILL exactly this product's price?"
 * — true on a page that states no price per product, and false on every Amazon
 * page, which states one beside each. So the task was confirmed with no item
 * price, and nothing would ever give it one: the amount is written when the
 * order is chosen, and an order is chosen once.
 *
 * WHAT IT PROVES, in the order it matters:
 *
 *   1. it refuses outright on any database that is not a practice one, and on a
 *      name it could not read at all, before it writes a single figure;
 *   2. the owner's own shape is settled — the product's own line, not the bill —
 *      and the refund that was stuck behind it computes;
 *   3. a task that already has a price is left exactly where it is and named,
 *      including one a staff member typed by hand;
 *   4. a task whose page cannot settle the price is left alone, not guessed at;
 *   5. a task whose stored order is no longer the offer's product is left alone;
 *   6. nothing of another account's is touched;
 *   7. no state is moved and no money is paid;
 *   8. running it twice is safe, and the second run writes nothing new;
 *   9. --dry-run decides everything and writes nothing;
 *  10. no telephone number appears in anything it produces.
 *
 * THE ACCOUNT IS ALWAYS HANDED IN HERE, never read from a settings file: a run
 * whose result depends on a file git has never seen is not a test.
 */
describe('Settling the item prices that were never read (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tasks: TaskService;
  let tickets: TicketService;

  let seq = 0;
  const newMobile = (): string =>
    `+9193${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  /** The garment rack the owner's offer is for. */
  const RACK = 'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf';
  /** The other thing on the same order, which the offer is not for. */
  const SHELF = 'SR 2 PES Bathroom Corner Shelf';
  const RACK_PAISE = 93800n;
  const SHELF_PAISE = 38800n;
  const BILL_PAISE = 133100n;

  const makeCampaign = (
    over: Partial<Prisma.CampaignCreateInput> = {},
  ): Promise<Campaign> =>
    prisma.campaign.create({
      data: {
        platform: 'AMAZON',
        status: 'ACTIVE',
        title: 'Review the Lukzer garment rack',
        productName: RACK,
        category: 'home',
        productPricePaise: RACK_PAISE,
        // The owner's own offer pays 85 per cent, which is what makes the
        // arithmetic below a real number and not a round one.
        payoutPercent: 85,
        ticketCost: 5,
        ...over,
      },
    });

  const ev = (e: Record<string, unknown>): SubmitEvidenceDto =>
    e as unknown as SubmitEvidenceDto;

  async function newPracticeAccount(): Promise<{ mobile: string; userId: string }> {
    const mobile = newMobile();
    const user = await prisma.user.create({ data: { mobile } });
    await tickets.grantSignup(user.id);
    return { mobile, userId: user.id };
  }

  /**
   * A TASK EXACTLY AS THE OLD RULE LEFT IT.
   *
   * Built through the real funnel, not written into the database: the order goes
   * in through TaskService.submitEvidence carrying what chooseMine used to send
   * when itemPriceIsCertain said no — an order number, the product's name, and
   * THE WHOLE BILL, with no per-unit figure at all. Then the candidate row the
   * person chose, which is what the command reads the real price back out of.
   */
  async function taskFromTheOldRule(
    userId: string,
    campaign: Campaign,
    over: {
      orderNumber?: string;
      items?: { name: string; pricePaise: bigint }[];
      totalPaise?: bigint | null;
      shipments?: number;
    } = {},
  ): Promise<{ taskId: string; candidateId: string }> {
    const orderNumber = over.orderNumber ?? '408-1509645-3524313';
    const claimed = await tasks.claim(userId, campaign.id, { terms: true });

    await tasks.submitEvidence(userId, claimed.id, ev({
      key: `old-rule:${claimed.id}`,
      order: {
        id: orderNumber,
        product: RACK,
        // The bill, and nothing else. This is the whole defect: the page states
        // ₹938.00 beside the rack and the task ended up with ₹1,331.00 and no
        // item price at all.
        orderTotalPaise: BILL_PAISE.toString(),
        source: 'order-history',
      },
    }));

    const candidate = await prisma.orderCandidate.create({
      data: {
        taskId: claimed.id,
        position: 0,
        source: 'ORDER_LIST',
        orderNumber,
        totalPaise: over.totalPaise === undefined ? BILL_PAISE : over.totalPaise,
        items: itemsToJson(over.items ?? [
          { name: RACK, pricePaise: RACK_PAISE },
          { name: SHELF, pricePaise: SHELF_PAISE },
        ]),
        shipments: over.shipments ?? 1,
        matches: true,
        reason: 'matched',
        chosenAt: new Date(),
      },
    });
    return { taskId: claimed.id, candidateId: candidate.id };
  }

  /**
   * What the task's own order carries now, as the app would be sent it.
   *
   * THROWS RATHER THAN ANSWERING NULL. Every task in this file is built with an
   * order on it, so a null here is the fixture being wrong, and a check that
   * quietly read fields off nothing would pass while proving nothing.
   */
  async function orderOn(taskId: string) {
    const row = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { campaign: true },
    });
    const order = toTaskResponse(row, row.campaign).order;
    if (order == null) throw new Error(`task ${taskId} has no order on it`);
    return order;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tasks = app.get(TaskService);
    tickets = app.get(TicketService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(
        `settling item prices e2e aborted: non-test database "${db}"`,
      );
    }
  });

  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDatabase(prisma); });

  // ── 1. the refusal ───────────────────────────────────────────────────────

  it('refuses on a database that is not a practice one, and writes nothing', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    await expect(
      settleKnownItemPrices(app, {
        quiet: true,
        mobile,
        databaseNameOverride: 'fayr_live',
      }),
    ).rejects.toThrow(/practice|development/i);

    // AND IT STOPPED BEFORE IT WROTE ANYTHING.
    expect((await orderOn(taskId)).unitPricePaise).toBeNull();
  });

  it('FAILS CLOSED: a name it could not read is not a practice database', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    await expect(
      settleKnownItemPrices(app, {
        quiet: true,
        mobile,
        databaseNameOverride: '',
      }),
    ).rejects.toThrow(/practice|development/i);
    expect((await orderOn(taskId)).unitPricePaise).toBeNull();
  });

  // ── 2. the owner's own shape ─────────────────────────────────────────────

  it('SETTLES THE OWNER’S OWN TASK, from the product’s line and never the bill', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    // BEFORE: the bill and nothing else, which is exactly what he was looking at.
    const before = await orderOn(taskId);
    expect(before.orderTotalPaise).toBe('133100');
    expect(before.unitPricePaise).toBeNull();
    expect(before.itemPaise).toBeNull();

    const report = await settleKnownItemPrices(app, { quiet: true, mobile });

    expect(report.settled).toHaveLength(1);
    expect(report.settled[0].taskId).toBe(taskId);
    expect(report.settled[0].itemPricePaise).toBe('93800');
    expect(report.settled[0].orderTotalPaise).toBe('133100');
    expect(report.leftAlone).toHaveLength(0);
    expect(report.couldNotSettle).toHaveLength(0);

    // AFTER: the product's own line, and the bill still beside it untouched.
    const after = await orderOn(taskId);
    expect(after.unitPricePaise).toBe('93800');
    expect(after.quantity).toBe(1);
    expect(after.orderTotalPaise).toBe('133100');

    // ── THE LINE THAT MUST NEVER CHANGE ────────────────────────────────
    //
    // A refund based on ₹1,331.00 would pay for somebody else's bathroom shelf.
    expect(after.unitPricePaise).not.toBe('133100');
  });

  it('AND THE REFUND THAT WAS STUCK BEHIND IT NOW COMPUTES', async () => {
    // ₹938.00 at 85 per cent is ₹797.30. The screen said "Available once the
    // item price is verified" because the amount was null, not because the
    // arithmetic was hard.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    const row = await prisma.task.findUniqueOrThrow({
      where: { id: taskId }, include: { campaign: true },
    });
    expect(toTaskResponse(row, row.campaign).refund.amountPaise).toBeNull();

    await settleKnownItemPrices(app, { quiet: true, mobile });

    const settled = await prisma.task.findUniqueOrThrow({
      where: { id: taskId }, include: { campaign: true },
    });
    const refund = toTaskResponse(settled, settled.campaign).refund;
    expect(refund.basedOnPaise).toBe('93800');
    expect(refund.amountPaise).toBe('79730');
    // AND THE BASIS IS NOT THE BILL. The same rule as above, said where the
    // money is actually worked out.
    expect(refund.basedOnPaise).not.toBe('133100');
  });

  it('and the screen can show the product’s price, not the basket', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    await settleKnownItemPrices(app, { quiet: true, mobile });

    const after = await orderOn(taskId);
    expect(after.matchedPricePaise).toBe('93800');
    expect(after.matchedPricePaise).not.toBe('133100');
  });

  // ── 3. it fills nulls and never replaces an answer ────────────────────────

  it('LEAVES A TASK THAT ALREADY HAS A PRICE, and names what was found', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    // A PRICE THAT ARRIVED SOME OTHER WAY. Whatever we think of it, it is an
    // answer, and somebody may already have been told it.
    //
    // ── AND IT IS SENT AT ORDER-DETAILS RANK, WHICH IS NOT COSMETIC ───────
    //
    // A first writing of this used `source: 'staff'`, and it did not stick:
    // SOURCE_RANK puts staff-visible at 3 and order history at 4, so
    // preferByAuthority kept the incumbent and the figure never landed. That is
    // the engine behaving exactly as designed — a lower-authority source may not
    // overwrite a higher one — and it meant the check was proving nothing. The
    // figure has to reach the task before this file can claim the command leaves
    // it alone.
    await tasks.submitEvidence(userId, taskId, ev({
      key: `another-read:${taskId}`,
      order: {
        id: '408-1509645-3524313',
        unitPricePaise: '90000',
        quantity: 1,
        amountSource: 'order-details',
        source: 'order-details',
      },
    }));

    const report = await settleKnownItemPrices(app, { quiet: true, mobile });

    expect(report.settled).toHaveLength(0);
    expect(report.leftAlone).toHaveLength(1);
    expect(report.leftAlone[0].taskId).toBe(taskId);
    expect(report.leftAlone[0].reason).toBe(ALREADY_HAS_ONE_SENTENCE);
    expect(report.leftAlone[0].found.join(' ')).toMatch(/₹900\.00/);

    // AND THE STAFF MEMBER'S FIGURE IS STILL THERE, UNCHANGED.
    expect((await orderOn(taskId)).unitPricePaise).toBe('90000');
  });

  it('and leaves one whose price the ordinary resolver refuses to compute from', async () => {
    // A LINE TOTAL WITH NO QUANTITY. resolveChargedPaise answers null for it ON
    // PURPOSE — a line of ₹1,876.00 could be one rack or two — so a command that
    // asked only "can a refund be computed?" would overwrite the very evidence a
    // staff member is looking at. This is the case a one-field check gets wrong.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    await tasks.submitEvidence(userId, taskId, ev({
      key: `line:${taskId}`,
      order: {
        id: '408-1509645-3524313',
        lineTotalPaise: '187600',
        source: 'order-history',
      },
    }));

    const report = await settleKnownItemPrices(app, { quiet: true, mobile });
    expect(report.settled).toHaveLength(0);
    expect(report.leftAlone[0].reason).toBe(ALREADY_HAS_ONE_SENTENCE);
    expect(report.leftAlone[0].found.join(' ')).toMatch(/₹1876\.00|₹1,876\.00/);
    expect((await orderOn(taskId)).lineTotalPaise).toBe('187600');
  });

  it('and the ORDER TOTAL alone is never mistaken for an answer', async () => {
    // The trap that would have made this command do nothing on every run.
    // chooseMine puts the whole bill on every task it touches, so if the bill
    // counted as "already has a price" then every row this exists to fix would
    // be refused. The task built above carries a bill and nothing else.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    await taskFromTheOldRule(userId, campaign);

    const report = await settleKnownItemPrices(app, { quiet: true, mobile });
    expect(report.settled).toHaveLength(1);
  });

  // ── 4. it never guesses ──────────────────────────────────────────────────

  it('leaves a task whose line is NOT what the offer says, rather than guessing', async () => {
    // The product is on the order, at twice what the offer says it costs. The
    // two readings disagree, and "the readings about somebody's money disagree"
    // is not a state to resolve by picking one.
    //
    // ── AND THE SENTENCE IT GETS IS THE MATCH ONE, NOT THE CERTAINTY ONE ──
    //
    // Worth saying plainly, because the first writing of this check asserted the
    // other sentence and was wrong. matchOrderToCampaign only ever returns
    // `matches: true` for an item whose price EQUALS the campaign's
    // (order-comparison.ts:535), and itemPriceIsCertain — given that same
    // campaign price — asks exactly the same equality. So a price that differs
    // is refused one step earlier, by the match, and never reaches the certainty
    // question at all. See the note on NOT_CERTAIN_SENTENCE for why that branch
    // is kept even though nothing can reach it today.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign, {
      items: [
        { name: RACK, pricePaise: 187600n },
        { name: SHELF, pricePaise: SHELF_PAISE },
      ],
      totalPaise: 226400n,
    });

    const report = await settleKnownItemPrices(app, { quiet: true, mobile });
    expect(report.settled).toHaveLength(0);
    expect(report.leftAlone[0].reason).toBe(NO_LONGER_MATCHES_SENTENCE);
    expect((await orderOn(taskId)).unitPricePaise).toBeNull();
  });

  it('and the certainty refusal is still spelled, for the day the match loosens', () => {
    // NOTHING REACHES IT TODAY, and that is written down rather than left to
    // look like coverage — the same way reset-amazon-claims.ts records that no
    // check reaches its couldNotDelete branch. It stays because it is the guard
    // that would hold if matchOrderToCampaign ever stopped requiring the price
    // to be equal, and a command that wrote a figure on that day would be
    // writing a number nobody checked.
    expect(NOT_CERTAIN_SENTENCE).toContain('cannot settle the price');
  });

  it('leaves a task whose stored order is no longer this offer’s product', async () => {
    // The campaign was edited after the order was confirmed. The question is
    // asked again rather than remembered, and the answer has to be true now.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { productName: 'Something else entirely', productPricePaise: 50000n },
    });

    const report = await settleKnownItemPrices(app, { quiet: true, mobile });
    expect(report.settled).toHaveLength(0);
    expect(report.leftAlone[0].reason).toBe(NO_LONGER_MATCHES_SENTENCE);
    expect((await orderOn(taskId)).unitPricePaise).toBeNull();
  });

  // ── 5. scope, state and money ────────────────────────────────────────────

  it('touches nothing of another account’s', async () => {
    const mine = await newPracticeAccount();
    const theirs = await newPracticeAccount();
    const campaign = await makeCampaign();
    const a = await taskFromTheOldRule(mine.userId, campaign);
    const b = await taskFromTheOldRule(theirs.userId, campaign, {
      orderNumber: '408-0000000-0000000',
    });

    const report = await settleKnownItemPrices(app, {
      quiet: true, mobile: mine.mobile,
    });
    expect(report.settled.map((s) => s.taskId)).toEqual([a.taskId]);
    expect((await orderOn(b.taskId)).unitPricePaise).toBeNull();
  });

  it('MOVES NO STATE AND PAYS NOBODY', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    const before = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const ledgerBefore = await prisma.ledgerTransaction.count();
    const walletBefore = await prisma.walletEntry.count();

    await settleKnownItemPrices(app, { quiet: true, mobile });

    const after = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after.state).toBe(before.state);
    // Not one leg of money moved. The evidence carries an order and nothing
    // else, so there is no delivery and no review for a gate to act on.
    expect(await prisma.ledgerTransaction.count()).toBe(ledgerBefore);
    expect(await prisma.walletEntry.count()).toBe(walletBefore);
  });

  // ── 5b. it adds a price and takes nothing away ───────────────────────────

  it('TAKES NOTHING AWAY: the order date and the rest survive the settling', async () => {
    // ── THE TRAP, AND IT IS NOT VISIBLE FROM THIS FILE ALONE ─────────────
    //
    // transition() applies order evidence with
    // `patch.order = preferByAuthority(task.order, e.order)`, and that returns
    // the INCOMING object whole. It does not merge. So a fragment that names
    // eight fields does not update eight fields — it replaces the order, and
    // everything it leaves out becomes null.
    //
    // Without the existing order being carried forward, this command settled a
    // price and blanked the order date, the product photo and the shop's status
    // line on every task it touched — erasing, in the same changeset, the very
    // date the rest of it was written to show.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    // Give the task the facts a real one carries, through the ordinary funnel.
    await tasks.submitEvidence(userId, taskId, ev({
      key: `facts:${taskId}`,
      order: {
        id: '408-1509645-3524313',
        dateRaw: '2026-06-02',
        matchedPricePaise: '93800',
        image: 'https://example.invalid/rack.jpg',
        statusText: 'Delivered 8 June',
        source: 'order-history',
      },
    }));
    const before = await orderOn(taskId);
    expect(before.dateRaw).toBe('2026-06-02');
    expect(before.matchedPricePaise).toBe('93800');

    await settleKnownItemPrices(app, { quiet: true, mobile });

    const after = await orderOn(taskId);
    // THE PRICE ARRIVED.
    expect(after.unitPricePaise).toBe('93800');
    // AND NOTHING ELSE LEFT.
    expect(after.dateRaw).toBe('2026-06-02');
    expect(after.matchedPricePaise).toBe('93800');
    expect(after.image).toBe('https://example.invalid/rack.jpg');
    expect(after.statusText).toBe('Delivered 8 June');
    expect(after.id).toBe('408-1509645-3524313');
  });

  // ── 6. running it again, and running it dry ──────────────────────────────

  it('is safe to run twice, and the second run writes nothing new', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    const first = await settleKnownItemPrices(app, { quiet: true, mobile });
    expect(first.settled).toHaveLength(1);

    const second = await settleKnownItemPrices(app, { quiet: true, mobile });
    // The task now HAS a price, so the second run leaves it alone by the same
    // rule that protects a staff member's own figure.
    expect(second.settled).toHaveLength(0);
    expect(second.leftAlone).toHaveLength(1);
    expect(second.leftAlone[0].reason).toBe(ALREADY_HAS_ONE_SENTENCE);
    expect((await orderOn(taskId)).unitPricePaise).toBe('93800');
  });

  it('--dry-run decides everything and writes nothing', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const { taskId } = await taskFromTheOldRule(userId, campaign);

    const report = await settleKnownItemPrices(app, {
      quiet: true, mobile, dryRun: true,
    });
    expect(report.dryRun).toBe(true);
    expect(report.settled).toHaveLength(1);
    expect(report.settled[0].itemPricePaise).toBe('93800');

    // AND THE TASK IS EXACTLY AS IT WAS.
    expect((await orderOn(taskId)).unitPricePaise).toBeNull();
  });

  // ── 7. it names every row, and it names nobody ───────────────────────────

  it('names every task and what it did with it', async () => {
    // THREE CAMPAIGNS FOR THREE TASKS. A person holds one claim per offer — a
    // second claim on the same offer returns the SAME task — so building two
    // tasks on one campaign put a different order number on a task that already
    // had one, and the plausibility gate refused it with 'order-id-changed'.
    // Two of the three share a TITLE, which is what byOffer groups on.
    const { mobile, userId } = await newPracticeAccount();
    const one = await makeCampaign();
    const alsoOne = await makeCampaign();
    const two = await makeCampaign({ title: 'Review it again' });
    const a = await taskFromTheOldRule(userId, one);
    const b = await taskFromTheOldRule(userId, alsoOne, {
      orderNumber: '408-1111111-1111111',
    });
    const c = await taskFromTheOldRule(userId, two, {
      orderNumber: '408-2222222-2222222',
    });

    const said: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((m: unknown) => {
      said.push(String(m));
    });
    let report;
    try {
      report = await settleKnownItemPrices(app, { mobile });
    } finally {
      spy.mockRestore();
    }

    // EVERY ROW IS NAMED, not just counted.
    for (const id of [a.taskId, b.taskId, c.taskId]) {
      expect(said.join('\n')).toContain(id);
    }
    // AND THE SUMMARY REALLY GROUPS THEM. An uneven fixture on purpose — two on
    // one offer and one on another — so a per-row listing would not pass this.
    expect(report.byOffer).toEqual([
      { offer: 'Review the Lukzer garment rack', howMany: 2 },
      { offer: 'Review it again', howMany: 1 },
    ]);
    expect(
      report.byOffer.reduce((sum, g) => sum + g.howMany, 0),
    ).toBe(report.settled.length);
  });

  it('NEVER PRINTS A TELEPHONE NUMBER, in the report or on the screen', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    await taskFromTheOldRule(userId, campaign);

    const said: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((m: unknown) => {
      said.push(String(m));
    });
    let report;
    try {
      report = await settleKnownItemPrices(app, { mobile });
    } finally {
      spy.mockRestore();
    }

    const everything = `${said.join('\n')}\n${JSON.stringify(report)}`;
    expect(everything).not.toContain(mobile);
    // The masked form is what may appear, and its last two digits are the most
    // that may be shown of anybody's number.
    expect(report.account).not.toBe(mobile);
    expect(everything).not.toMatch(/\+91\d{6,}/);
  });

  // ── 7b. a near miss on the one flag that matters ─────────────────────────

  it('A MISTYPED --dry-run IS REFUSED, not quietly ignored', () => {
    // The one typo a person is most likely to make is on the flag that means
    // "write nothing", and it used to be dropped silently — so --dryrun ran the
    // writing path against the practice account. Read out of the command's own
    // source, because main() boots a whole application and this is a question
    // about argument parsing.
    const src = readFileSync(
      resolve(__dirname, '..', 'scripts', 'settle-known-item-prices.ts'),
      'utf8',
    );
    expect(src).toContain("const known = ['--dry-run'];");
    expect(src).toMatch(/I do not know the option/);
    expect(src).toMatch(/Nothing has been changed/);
    // And the refusal happens before anything boots or writes.
    const flags = src.indexOf('I do not know the option');
    const boots = src.indexOf("await import('@nestjs/core')");
    expect(flags).toBeGreaterThan(-1);
    expect(boots).toBeGreaterThan(-1);
    expect(flags).toBeLessThan(boots);
  });

  // ── 8. the command people type ───────────────────────────────────────────

  it('the wrapper exists, refuses without a database, and names no number', () => {
    const wrapper = readFileSync(
      resolve(__dirname, '..', '..', 'settle-known-item-prices'),
      'utf8',
    );
    expect(wrapper.startsWith('#!/usr/bin/env bash')).toBe(true);
    // It runs the work through ts-node, exactly as ./reset-amazon-campaigns does.
    expect(wrapper).toContain('scripts/settle-known-item-prices.ts');
    // It checks the database is ANSWERING, not merely that a container is up.
    expect(wrapper).toContain('pg_isready');
    // And it says the two things a person needs to know before running it.
    expect(wrapper).toMatch(/already has one is left where it is/i);
    expect(wrapper).toMatch(/refuses on any database that is not a practice one/i);
    // No telephone number is written into the command itself.
    expect(wrapper).not.toMatch(/\+91\d{6,}/);
  });
});
