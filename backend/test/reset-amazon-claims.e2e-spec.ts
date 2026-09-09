import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import {
  LEFT_ALONE_SENTENCE,
  resetAmazonClaims,
} from '../scripts/reset-amazon-claims';
import { PrismaService } from '../src/prisma/prisma.service';
import type { SubmitEvidenceDto } from '../src/tasks/dto/submit-evidence.dto';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { AppModule } from '../src/app.module';
import { resetDatabase } from './reset-db';

/**
 * REMOVING THE PRACTICE ACCOUNT'S AMAZON CLAIMS, WITHOUT LOSING ANYTHING REAL.
 *
 * WHY THE COMMAND EXISTS. ./free-claims lets a claim go but leaves the row, and a
 * row that is still there still holds its seat — a taken seat is ANY task on the
 * campaign whatever state it reached. So the Amazon offers end up reading "All
 * seats taken" and freeing claims will never open them again. This command
 * deletes the rows, which is the only thing that gives a seat back.
 *
 * WHY THAT IS THE DANGEROUS ONE OF THE PAIR. Freeing is reversible in the sense
 * that everything is still on record afterwards. Deleting is not. So the guards
 * are the whole subject of this file, and there are more of them than there look
 * to be: money against a row is asked about FOUR ways, and the second way is the
 * one that matters, because the product's own definition of "the charged amount"
 * answers NULL on purpose in every case a human has to decide the figure.
 *
 * WHAT IT PROVES, in the order it matters:
 *
 *   1. it refuses outright on any database that is not a practice one, and on a
 *      name it could not read at all, before it deletes a single row;
 *   2. a row with no money against it is really gone — deleted, not closed —
 *      and the seat really comes back;
 *   3. a row with a charged amount against it is left exactly where it is, and
 *      named with the owner's own sentence;
 *   4. a row whose order carries money that resolveChargedPaise REFUSES to turn
 *      into a figure is ALSO left alone — the case a one-field check deletes;
 *   5. so is a row with a movement of money in the wallet against it;
 *   5b. but a row whose only figure is a shop STICKER price is deleted, or
 *      the rule quietly becomes "anything with a number on it stays";
 *   6. nothing on another marketplace is touched, and nothing of another
 *      account's;
 *   7. no campaign is changed — not its name, picture, terms or seat count;
 *   8. the summary really groups the deleted rows by offer;
 *   9. the tickets that went are read off the ledger, and nobody is topped up;
 *  10. running it twice is safe;
 *  11. no telephone number appears in anything it produces.
 *
 * THE ACCOUNT IS ALWAYS HANDED IN HERE, never read from a settings file: a run
 * whose result depends on a file git has never seen is not a test. Every number
 * below is made up on the spot and belongs to nobody.
 */
describe('Removing the practice account Amazon claims (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tasks: TaskService;
  let tickets: TicketService;
  let wallet: WalletService;

  let seq = 0;
  const newMobile = (): string =>
    `+9194${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  const makeCampaign = (
    over: Partial<Prisma.CampaignCreateInput> = {},
  ): Promise<Campaign> =>
    prisma.campaign.create({
      data: {
        platform: 'AMAZON',
        status: 'ACTIVE',
        title: 'Review the boAt Rockerz',
        productName: 'boAt Rockerz 255 Pro+',
        category: 'electronics',
        productPricePaise: 129900n,
        payoutPercent: 100,
        ticketCost: 5,
        ...over,
      },
    });

  const ev = (e: Record<string, unknown>): SubmitEvidenceDto =>
    e as unknown as SubmitEvidenceDto;

  interface Practice {
    mobile: string;
    userId: string;
  }

  /**
   * An account with the fifteen tickets everybody starts with, plus however many
   * more this test needs. Fifteen is exactly three claims, and several of the
   * checks below want more rows than that — so the extra goes through the real
   * ticket ledger with its own key rather than a number being written anywhere.
   */
  async function newPracticeAccount(extraTickets = 0): Promise<Practice> {
    const mobile = newMobile();
    const user = await prisma.user.create({ data: { mobile } });
    await tickets.grantSignup(user.id);
    if (extraTickets > 0) {
      await tickets.adjust(user.id, extraTickets, `test-topup:${user.id}`);
    }
    return { mobile, userId: user.id };
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
    wallet = app.get(WalletService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(
        `resetting amazon claims e2e aborted: non-test database "${db}"`,
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ── 1. the refusal ─────────────────────────────────────────────────────────

  it('refuses on a database that is not a practice one, and deletes nothing', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const claimed = await tasks.claim(userId, campaign.id, { terms: true });

    await expect(
      resetAmazonClaims(app, {
        quiet: true,
        mobile,
        databaseNameOverride: 'fayr_live',
      }),
    ).rejects.toThrow(/practice|development/i);

    // AND IT STOPPED BEFORE IT DELETED ANYTHING. A refusal that has already
    // removed half the rows is not a refusal.
    const row = await prisma.task.findUnique({ where: { id: claimed.id } });
    expect(row).not.toBeNull();
  });

  it('FAILS CLOSED: a name it could not read is not a practice database', async () => {
    // The whole point of the guard. If the name cannot be read the answer is
    // refuse, not "probably fine" — being wrong this way costs the owner a
    // sentence he has to read, and being wrong the other way costs somebody
    // their records with no way to get them back.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const claimed = await tasks.claim(userId, campaign.id, { terms: true });

    await expect(
      resetAmazonClaims(app, {
        quiet: true,
        mobile,
        databaseNameOverride: '',
      }),
    ).rejects.toThrow(/practice|development/i);

    expect(
      await prisma.task.findUnique({ where: { id: claimed.id } }),
    ).not.toBeNull();
  });

  it('names the database it refused, and does not name the person', async () => {
    const { mobile } = await newPracticeAccount();
    const said = await resetAmazonClaims(app, {
      quiet: true,
      mobile,
      databaseNameOverride: 'fayr_live',
    }).then(
      () => 'it did not refuse',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    expect(said).toMatch(/fayr_live/);
    expect(said).not.toContain(mobile.slice(-6));
  });

  it('asks the LIVE connection its own name, never the connection string', () => {
    // The two can disagree, and a connection string edited to point somewhere
    // else is exactly the mistake this guard exists for — a guard that read the
    // setting the connection was made FROM would agree with the mistake. Stated
    // here as well as in the code because no run against a test database can
    // ever tell the two apart: both names end in _test.
    const src = readFileSync(
      resolve(__dirname, '../scripts/reset-amazon-claims.ts'),
      'utf8',
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).toContain('SELECT current_database()');
    expect(code).not.toContain('DATABASE_URL');
    // AND ONE SPELLING OF THE RULE. The test comes from the shared function, not
    // from a copy of its regular expression: two spellings of one rule is how
    // one of them ends up wrong.
    expect(code).toContain('isAPracticeDatabase(name)');
    expect(code).not.toContain('_dev$|_test$');
  });

  it('accepts a practice database whether its name ends in dev or test', async () => {
    // Both endings, because every other guard in the product accepts both and a
    // rule stated twice in two shapes is a rule that will drift.
    const { mobile } = await newPracticeAccount();
    for (const name of ['fayr_next_dev', 'fayr_next_test']) {
      const report = await resetAmazonClaims(app, {
        quiet: true,
        mobile,
        databaseNameOverride: name,
      });
      expect(report.databaseName).toBe(name);
    }
  });

  // ── 2. the row really goes, and the seat really comes back ─────────────────

  it('DELETES the row rather than closing it, whatever state it reached', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const waiting = await makeCampaign({ title: 'Still only claimed' });
    const bought = await makeCampaign({ title: 'Bought, but nothing paid' });

    const waitingTask = await tasks.claim(userId, waiting.id, { terms: true });
    const boughtTask = await tasks.claim(userId, bought.id, { terms: true });
    // Far enough along to be PURCHASED, with no money figure on the order at
    // all — so this proves the state is not consulted, and only money is.
    await tasks.submitEvidence(
      userId,
      boughtTask.id,
      ev({ order: { id: 'ord-1', source: 'order-details' }, returned: false }),
    );

    const report = await resetAmazonClaims(app, { quiet: true, mobile });

    expect(report.deleted.map((d) => d.taskId).sort()).toEqual(
      [waitingTask.id, boughtTask.id].sort(),
    );
    expect(report.leftAlone).toEqual([]);
    expect(report.couldNotDelete).toEqual([]);

    // GONE. Not closed, not blanked — gone.
    expect(
      await prisma.task.findUnique({ where: { id: waitingTask.id } }),
    ).toBeNull();
    expect(
      await prisma.task.findUnique({ where: { id: boughtTask.id } }),
    ).toBeNull();
    expect(await prisma.task.count({ where: { userId } })).toBe(0);
  });

  it('gives the seat back, which closing the row would not have done', async () => {
    // THE REASON THE COMMAND EXISTS. A seat is taken by ANY task on the campaign
    // whatever state it reached, so on a one seat offer a freed claim leaves the
    // offer shut for ever. Only removing the row opens it.
    const { mobile, userId } = await newPracticeAccount();
    const other = await newPracticeAccount();
    const campaign = await makeCampaign({
      title: 'One seat only',
      totalSlots: 1,
    });
    const first = await tasks.claim(userId, campaign.id, { terms: true });

    // Shut, proved by the product's own gate refusing somebody else.
    await expect(
      tasks.claim(other.userId, campaign.id, { terms: true }),
    ).rejects.toThrow(/full/i);

    const report = await resetAmazonClaims(app, { quiet: true, mobile });
    expect(report.deleted).toHaveLength(1);

    // Open again, and it is a NEW claim rather than the old one handed back.
    const second = await tasks.claim(userId, campaign.id, { terms: true });
    expect(second.id).not.toBe(first.id);
    expect(second.state).toBe('CLAIMED');
  });

  // ── 3. money against the row, the obvious way ──────────────────────────────

  it("leaves a row with a charged amount against it, in the owner's own words", async () => {
    const { mobile, userId } = await newPracticeAccount();
    const paid = await makeCampaign({ title: 'Money against this one' });
    const clean = await makeCampaign({ title: 'Nothing against this one' });

    const paidTask = await tasks.claim(userId, paid.id, { terms: true });
    const cleanTask = await tasks.claim(userId, clean.id, { terms: true });
    await tasks.submitEvidence(
      userId,
      paidTask.id,
      ev({
        order: {
          id: 'ord-money',
          itemPaise: '129900',
          quantity: 1,
          source: 'order-details',
        },
        returned: false,
      }),
    );

    const report = await resetAmazonClaims(app, { quiet: true, mobile });

    expect(report.deleted.map((d) => d.taskId)).toEqual([cleanTask.id]);
    expect(report.leftAlone).toHaveLength(1);
    expect(report.leftAlone[0].taskId).toBe(paidTask.id);
    expect(report.leftAlone[0].offer).toBe('Money against this one');
    // The sentence the owner asked for, and the figure that caused it.
    expect(report.leftAlone[0].reason).toBe(LEFT_ALONE_SENTENCE);
    expect(report.leftAlone[0].reason).toContain('has money against it');
    // THE EXACT WORDING, not merely "a figure appears somewhere". The charged
    // amount is the one line that says why the row was kept in the terms a
    // refund is actually paid in, and it decides nothing on its own — so its own
    // sentence is the only thing that can prove it is still being asked for.
    expect(report.leftAlone[0].found).toContain('a charged amount of ₹1299.00');
    // And the raw field it came from, which is the half that DOES decide.
    expect(report.leftAlone[0].found).toContain('an item figure of ₹1299.00');

    // STILL THERE, and every figure on it untouched.
    const after = await prisma.task.findUniqueOrThrow({
      where: { id: paidTask.id },
    });
    expect(after.itemPaise).toBe(129900n);
    expect(after.closedAt).toBeNull();
    // The legacy column really is set on this row, so the third question is
    // being asked of something rather than of a column that is always null.
    expect(report.leftAlone[0].found).toContain(
      'a verified item price of ₹1299.00',
    );
  });

  it('DELETES a row whose only figure is a shop sticker price', async () => {
    // THE OTHER HALF OF THE MONEY RULE, and it has to be checked or the guard
    // quietly becomes "anything with a number on it stays". Nobody was ever
    // charged an MRP, the product refuses to pay from one anywhere, and a row
    // kept for one would sit there holding a seat for ever with no money behind
    // it. So it goes.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign({ title: 'Only a sticker price' });
    const task = await tasks.claim(userId, campaign.id, { terms: true });
    await tasks.submitEvidence(
      userId,
      task.id,
      ev({
        order: { id: 'ord-mrp', mrpPaise: '199900', source: 'order-details' },
        returned: false,
      }),
    );

    // The MRP really did survive into the stored evidence, so this is not a
    // check that passes because the figure was dropped on the way in.
    const before = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(JSON.stringify(before.evidence)).toContain('199900');

    const report = await resetAmazonClaims(app, { quiet: true, mobile });

    expect(report.leftAlone).toEqual([]);
    expect(report.deleted.map((d) => d.taskId)).toEqual([task.id]);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  // ── 4. money the charged-amount rule refuses to turn into a figure ─────────

  it('leaves a row whose ONLY money figure the product refuses to pay from', async () => {
    // THE CHECK A ONE-FIELD ANSWER WOULD FAIL, and it is not a hypothetical: an
    // order total with no item line is the ordinary quick-commerce shape and it
    // happens on Amazon whenever the item row cannot be read. resolveChargedPaise
    // answers null there ON PURPOSE, because a basket total may cover several
    // products. Null does NOT mean "no money on this row", and reading it that
    // way would delete every row a human still has to decide.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign({ title: 'Only a basket total' });
    const task = await tasks.claim(userId, campaign.id, { terms: true });
    await tasks.submitEvidence(
      userId,
      task.id,
      ev({
        order: {
          id: 'ord-total-only',
          orderTotalPaise: '250000',
          source: 'order-details',
        },
        returned: false,
      }),
    );

    // The row really is in the shape this check is about: an amount on the
    // order, no verified item price, and nothing the refund rule will pay from.
    const before = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(before.itemPaise).toBeNull();

    const report = await resetAmazonClaims(app, { quiet: true, mobile });

    expect(report.deleted).toEqual([]);
    expect(report.leftAlone).toHaveLength(1);
    expect(report.leftAlone[0].taskId).toBe(task.id);
    expect(report.leftAlone[0].found.join(' ')).toContain('2500.00');
    expect(
      await prisma.task.findUnique({ where: { id: task.id } }),
    ).not.toBeNull();
  });

  // ── 5. money in the wallet ─────────────────────────────────────────────────

  it('leaves a row with a movement of money in the wallet against it', async () => {
    // Asked of the database every time rather than reasoned about: "a row like
    // this cannot have money moved against it" is exactly the kind of thing that
    // is true until somebody adds a step, and nobody comes back to this file.
    const { mobile, userId } = await newPracticeAccount();
    const paid = await makeCampaign({ title: 'Refunded already' });
    const clean = await makeCampaign({ title: 'Never paid' });

    const paidTask = await tasks.claim(userId, paid.id, { terms: true });
    const cleanTask = await tasks.claim(userId, clean.id, { terms: true });

    // A real movement, posted by the wallet itself, pointing at the row by name.
    await wallet.postRefund({
      userId,
      amountPaise: 129900n,
      idempotencyKey: `test-refund:${paidTask.id}`,
      referenceType: 'task',
      referenceId: paidTask.id,
    });

    const report = await resetAmazonClaims(app, { quiet: true, mobile });

    expect(report.deleted.map((d) => d.taskId)).toEqual([cleanTask.id]);
    expect(report.leftAlone).toHaveLength(1);
    expect(report.leftAlone[0].taskId).toBe(paidTask.id);
    expect(report.leftAlone[0].found.join(' ')).toMatch(/wallet/i);

    // And the money is all still there. Nothing was removed to make a row
    // easier to delete.
    const movement = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { referenceType: 'task', referenceId: paidTask.id },
    });
    expect(
      await prisma.walletEntry.count({ where: { transactionId: movement.id } }),
    ).toBe(2);
    expect(
      await prisma.task.findUnique({ where: { id: paidTask.id } }),
    ).not.toBeNull();
  });

  // ── 6. Amazon only, this account only ──────────────────────────────────────

  it('touches no other marketplace, and no other account', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const somebodyElse = await newPracticeAccount();

    const amazon = await makeCampaign({ title: 'An Amazon offer' });
    const flipkart = await makeCampaign({
      title: 'A Flipkart offer',
      platform: 'FLIPKART',
    });
    const zepto = await makeCampaign({
      title: 'A Zepto offer',
      platform: 'ZEPTO',
    });

    const mine = await tasks.claim(userId, amazon.id, { terms: true });
    const myFlipkart = await tasks.claim(userId, flipkart.id, { terms: true });
    const myZepto = await tasks.claim(userId, zepto.id, { terms: true });
    const theirs = await tasks.claim(somebodyElse.userId, amazon.id, {
      terms: true,
    });

    const report = await resetAmazonClaims(app, { quiet: true, mobile });

    expect(report.deleted.map((d) => d.taskId)).toEqual([mine.id]);
    expect(
      await prisma.task.findUnique({ where: { id: myFlipkart.id } }),
    ).not.toBeNull();
    expect(
      await prisma.task.findUnique({ where: { id: myZepto.id } }),
    ).not.toBeNull();
    expect(
      await prisma.task.findUnique({ where: { id: theirs.id } }),
    ).not.toBeNull();
  });

  it('changes no campaign — not its name, picture, terms or seats', async () => {
    // The owner's boundary, stated as a check. Only the rows claiming an offer
    // are this command's business; the offer itself is somebody's work.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign({
      title: 'Leave my offer alone',
      terms: 'One review per person.',
      imageUrl: 'https://example.invalid/picture.jpg',
      totalSlots: 4,
    });
    await tasks.claim(userId, campaign.id, { terms: true });

    await resetAmazonClaims(app, { quiet: true, mobile });

    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.title).toBe('Leave my offer alone');
    expect(after.terms).toBe('One review per person.');
    expect(after.imageUrl).toBe('https://example.invalid/picture.jpg');
    expect(after.totalSlots).toBe(4);
    expect(after.status).toBe('ACTIVE');
    expect(after.productPricePaise).toBe(129900n);
    expect(await prisma.campaign.count()).toBe(1);
  });

  // ── 7. the summary ─────────────────────────────────────────────────────────

  it('groups what it deleted by the offer, and counts them', async () => {
    // Two rows on ONE offer and one on another, so a summary that simply listed
    // the rows would look right and this would not.
    const { mobile, userId } = await newPracticeAccount(20);
    const twice = await makeCampaign({ title: 'Claimed twice' });
    const once = await makeCampaign({ title: 'Claimed once' });

    const firstOnTwice = await tasks.claim(userId, twice.id, { terms: true });
    // A second row on the same offer, which is what happens after a claim has
    // been let go: the old one is closed and the next claim is a new row.
    await prisma.task.update({
      where: { id: firstOnTwice.id },
      data: { closedAt: new Date(), closeReason: 'expired' },
    });
    await tasks.claim(userId, twice.id, { terms: true });
    await tasks.claim(userId, once.id, { terms: true });

    const report = await resetAmazonClaims(app, { quiet: true, mobile });

    expect(report.deleted).toHaveLength(3);
    expect(report.byOffer).toEqual([
      { offer: 'Claimed twice', howMany: 2 },
      { offer: 'Claimed once', howMany: 1 },
    ]);
    expect(
      report.byOffer.reduce((sum, g) => sum + g.howMany, 0),
    ).toBe(report.deleted.length);
  });

  it('says so plainly when there is nothing to delete', async () => {
    const { mobile } = await newPracticeAccount();
    const report = await resetAmazonClaims(app, { quiet: true, mobile });
    expect(report.deleted).toEqual([]);
    expect(report.leftAlone).toEqual([]);
    expect(report.byOffer).toEqual([]);
    expect(report.ticketsGone).toBe(0);
    expect(report.ticketsNow).toBe(15);
  });

  // ── 8. the tickets ─────────────────────────────────────────────────────────

  it('reports the tickets that went, read off the ledger, and tops nobody up', async () => {
    // This command COSTS tickets where ./free-claims returns them, because the
    // ticket record is append-only and a removed row leaves its deduction
    // standing. The honest thing is to say how many and not to quietly mint any.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const claimed = await tasks.claim(userId, campaign.id, { terms: true });
    expect(await tickets.getBalance(userId)).toBe(10);

    const report = await resetAmazonClaims(app, { quiet: true, mobile });

    expect(report.deleted).toHaveLength(1);
    expect(report.deleted[0].ticketsGone).toBe(5);
    expect(report.ticketsGone).toBe(5);
    // NOBODY WAS TOPPED UP. Ten before, ten after.
    expect(report.ticketsNow).toBe(10);
    expect(await tickets.getBalance(userId)).toBe(10);
    // And the deduction is still on record, pointing at a row that has gone.
    const taken = await prisma.ticketEntry.findMany({
      where: { taskId: claimed.id, reason: 'CLAIM' },
    });
    expect(taken).toHaveLength(1);
    expect(taken[0].delta).toBe(-5);
  });

  it('counts nothing lost on a claim whose tickets already came back', async () => {
    // NET, not "what a claim costs". A claim that already expired had its
    // tickets returned through the same ledger, so removing the row loses
    // nothing. Reporting the deduction alone would tell the owner he had just
    // lost tickets he got back a week ago.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const claimed = await tasks.claim(userId, campaign.id, { terms: true });
    await tickets.returnOnExpiry(userId, claimed.id);
    expect(await tickets.getBalance(userId)).toBe(15);

    const report = await resetAmazonClaims(app, { quiet: true, mobile });

    expect(report.deleted).toHaveLength(1);
    expect(report.deleted[0].ticketsGone).toBe(0);
    expect(report.ticketsGone).toBe(0);
    expect(report.ticketsNow).toBe(15);
  });

  // ── 9. running it twice ────────────────────────────────────────────────────

  it('is safe to run twice, and the second run has nothing to do', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    await tasks.claim(userId, campaign.id, { terms: true });

    const first = await resetAmazonClaims(app, { quiet: true, mobile });
    expect(first.deleted).toHaveLength(1);

    const second = await resetAmazonClaims(app, { quiet: true, mobile });
    expect(second.deleted).toEqual([]);
    expect(second.leftAlone).toEqual([]);
    expect(second.couldNotDelete).toEqual([]);
    expect(second.ticketsGone).toBe(0);
    expect(await tickets.getBalance(userId)).toBe(10);
  });

  // ── 10. the number ─────────────────────────────────────────────────────────

  it('never lets a telephone number out, in what it returns or what it refuses', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    await tasks.claim(userId, campaign.id, { terms: true });

    const report = await resetAmazonClaims(app, { quiet: true, mobile });
    expect(report.account).not.toBe(mobile);
    expect(report.account).toContain('*');
    expect(JSON.stringify(report)).not.toContain(mobile.replace(/\D/g, ''));
    expect(JSON.stringify(report)).not.toContain(mobile.slice(-6));

    // And the same when it cannot find the account at all, which is the message
    // somebody is most likely to paste somewhere while asking what went wrong.
    const missing = newMobile();
    const said = await resetAmazonClaims(app, {
      quiet: true,
      mobile: missing,
    }).then(
      () => 'it did not refuse',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    expect(said).toMatch(/no practice account/i);
    expect(said).not.toContain(missing.slice(-6));
  });
});
