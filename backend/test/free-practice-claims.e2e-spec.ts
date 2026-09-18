import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import { freePracticeClaims } from '../scripts/free-practice-claims';
import { claimedFor, claimedSeatsByCampaign, isFull } from '../src/campaigns/seats';
import { PrismaService } from '../src/prisma/prisma.service';
import type { SubmitEvidenceDto } from '../src/tasks/dto/submit-evidence.dto';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { AppModule } from '../src/app.module';
import { resetDatabase } from './reset-db';

/**
 * GIVING THE PRACTICE ACCOUNT ITS OWN CLAIMS BACK, WITHOUT LYING TO IT.
 *
 * WHY THE COMMAND EXISTS. A claim is held for thirty minutes before Fayr lets it
 * go. Walking through the app claims nearly every practice offer, so the next
 * walk through cannot start until the half hour is up. The command gives the
 * claims back at once, on a practice database only.
 *
 * WHY THE EASY WAY OF DOING THAT WOULD HAVE BEEN WRONG. Deleting the claims
 * would have been three lines. It would also have left the ticket record holding
 * a deduction for a claim that no longer exists, and any money recorded against
 * one of those claims pointing at nothing. A ticket count is a running total of
 * things that really happened, and the moment it stops being that it stops being
 * worth reading. So the command runs the product's OWN way of letting a claim
 * go, which closes the claim rather than removing it and gives the tickets back
 * through the same ledger everything else uses. This file is here to prove that
 * is really what happens, and that it refuses everything it should refuse.
 *
 * WHAT IT PROVES, in the order it matters:
 *
 *   1. it refuses outright on any database that is not a practice one, before it
 *      touches a single row;
 *   2. a waiting claim really is let go, the claim is closed and not deleted,
 *      and the tickets really come back through the ticket ledger;
 *   3. an offer that was bought is left exactly as it is, and named, because
 *      Fayr never lets the same person claim an offer they have already bought;
 *   4. a claim with money recorded against it is left exactly as it is, and
 *      named, so the money and the claims cannot end up disagreeing;
 *   5. an offer it says was freed really can be claimed again;
 *   6. an offer whose seats are all taken is not claimed to be claimable;
 *   7. running it twice is safe, and the second run gives nothing back twice;
 *   8. no telephone number appears in anything it produces.
 *
 * THE ACCOUNT IS ALWAYS HANDED IN HERE, never read from a settings file. The
 * seed learned that the hard way and the rule is written down in its own tests:
 * a run whose result depends on a file git has never seen is not a test. Every
 * number below is made up on the spot and belongs to nobody.
 */
describe('Freeing the practice account claims (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tasks: TaskService;
  let tickets: TicketService;
  let wallet: WalletService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

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

  /** An account with the fifteen tickets everybody starts with. */
  async function newPracticeAccount(): Promise<Practice> {
    const mobile = newMobile();
    const user = await prisma.user.create({ data: { mobile } });
    await tickets.grantSignup(user.id);
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
        `freeing practice claims e2e aborted: non-test database "${db}"`,
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

  it('refuses on a database that is not a practice one, and changes nothing', async () => {
    // The same guard the practice data itself makes, in the same shape, for a
    // stronger reason: this one closes claims and moves tickets on an account.
    // On a real database those are the record of what a person is owed.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const claimed = await tasks.claim(userId, campaign.id, { terms: true });

    await expect(
      freePracticeClaims(app, {
        quiet: true,
        mobile,
        databaseNameOverride: 'fayr_live',
      }),
    ).rejects.toThrow(/practice|development/i);

    // AND IT STOPPED BEFORE IT READ ANYTHING. A refusal that has already freed
    // half the claims is not a refusal, so the claim has to be untouched.
    const row = await prisma.task.findUniqueOrThrow({
      where: { id: claimed.id },
    });
    expect(row.closedAt).toBeNull();
    expect(row.closeReason).toBeNull();
    expect(await tickets.getBalance(userId)).toBe(10);
  });

  it('names the database it refused, and does not name the person', async () => {
    // The refusal gets pasted into messages when somebody asks what went wrong.
    // It may name the database, because that is the thing that was wrong. It may
    // not name the account.
    const { mobile } = await newPracticeAccount();
    const said = await freePracticeClaims(app, {
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

  it('accepts a practice database whether its name ends in dev or test', async () => {
    // Both endings, because the demo seed accepts both and a rule that is stated
    // twice in two shapes is a rule that will drift.
    const { mobile } = await newPracticeAccount();
    for (const name of ['fayr_next_dev', 'fayr_next_test']) {
      const report = await freePracticeClaims(app, {
        quiet: true,
        mobile,
        databaseNameOverride: name,
      });
      expect(report.databaseName).toBe(name);
    }
  });

  // ── 2. what it frees, and what really comes back ───────────────────────────

  it('frees a waiting claim, closes it rather than deleting it, and gives the tickets back', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign({ title: 'Spin your storage' });
    const claimed = await tasks.claim(userId, campaign.id, { terms: true });
    expect(await tickets.getBalance(userId)).toBe(10);

    const report = await freePracticeClaims(app, { quiet: true, mobile });

    expect(report.freed).toHaveLength(1);
    expect(report.freed[0].taskId).toBe(claimed.id);
    expect(report.freed[0].offer).toBe('Spin your storage');
    expect(report.freed[0].ticketsReturned).toBe(5);
    expect(report.freed[0].canBeClaimedAgain).toBe(true);
    expect(report.leftAlone).toEqual([]);
    expect(report.ticketsReturned).toBe(5);

    // NOTHING WAS DELETED. The claim is still there, closed, with the product's
    // own reason on it, and still saying it never got past being claimed.
    const row = await prisma.task.findUniqueOrThrow({
      where: { id: claimed.id },
    });
    expect(row.closedAt).not.toBeNull();
    expect(row.closeReason).toBe('expired');
    expect(row.state).toBe('CLAIMED');

    // AND THE TICKETS CAME BACK THROUGH THE LEDGER, not by a number being set.
    // The exact figures are worked out by hand: fifteen to start with, five
    // taken for the claim, five given back, so fifteen again, and the entry that
    // gave them back is a real row carrying the balance it left behind.
    expect(await tickets.getBalance(userId)).toBe(15);
    expect(report.ticketsNow).toBe(15);
    const returns = await prisma.ticketEntry.findMany({
      where: { taskId: claimed.id, reason: 'EXPIRY_RETURN' },
    });
    expect(returns).toHaveLength(1);
    expect(returns[0].delta).toBe(5);
    expect(returns[0].balanceAfter).toBe(15);
    expect(returns[0].idempotencyKey).toBe(`ticket:expiry:${claimed.id}`);

    // The deduction it reverses is still on record too. Both halves stay.
    const taken = await prisma.ticketEntry.findMany({
      where: { taskId: claimed.id, reason: 'CLAIM' },
    });
    expect(taken).toHaveLength(1);
    expect(taken[0].delta).toBe(-5);

    // And it is written down that it happened, on the claim's own history.
    const events = await prisma.taskEvent.findMany({
      where: { taskId: claimed.id, type: 'EXPIRE' },
    });
    expect(events).toHaveLength(1);
  });

  // ── 3. the offer that was bought ───────────────────────────────────────────

  it('leaves an offer that was bought exactly as it is, and says why', async () => {
    // Fayr never lets the same person claim an offer they have already bought.
    // Freeing this one would put it back in front of him and then refuse him at
    // the till, so the honest thing is to leave it and say so.
    const { mobile, userId } = await newPracticeAccount();
    const bought = await makeCampaign({ title: 'Already bought this one' });
    const waiting = await makeCampaign({ title: 'Still only claimed' });

    const boughtTask = await tasks.claim(userId, bought.id, { terms: true });
    await tasks.submitEvidence(
      userId,
      boughtTask.id,
      ev({
        order: {
          id: 'o1',
          itemPaise: '129900',
          quantity: 1,
          source: 'order-details',
        },
        returned: false,
      }),
    );
    const boughtRow = await prisma.task.findUniqueOrThrow({
      where: { id: boughtTask.id },
    });
    expect(boughtRow.state).toBe('PURCHASED');
    const waitingTask = await tasks.claim(userId, waiting.id, { terms: true });

    const report = await freePracticeClaims(app, { quiet: true, mobile });

    // The one that was only claimed is freed. The one that was bought is not,
    // and it is named, with a reason a person can read.
    expect(report.freed.map((f) => f.taskId)).toEqual([waitingTask.id]);
    expect(report.leftAlone).toHaveLength(1);
    expect(report.leftAlone[0].taskId).toBe(boughtTask.id);
    expect(report.leftAlone[0].offer).toBe('Already bought this one');
    expect(report.leftAlone[0].state).toBe('PURCHASED');
    expect(report.leftAlone[0].reason).toMatch(/bought/i);

    const after = await prisma.task.findUniqueOrThrow({
      where: { id: boughtTask.id },
    });
    expect(after.closedAt).toBeNull();
    expect(after.state).toBe('PURCHASED');
  });

  // ── 4. the claim with money against it ─────────────────────────────────────

  it('leaves a claim with money recorded against it exactly as it is, and says why', async () => {
    // THIS IS THE GUARD THE OWNER ASKED FOR, AND IT REALLY RUNS. It is asked of
    // the database every time rather than reasoned about: "a waiting claim
    // cannot have money against it yet" is the kind of thing that is true until
    // somebody adds a step, and nobody comes back to check this file.
    const { mobile, userId } = await newPracticeAccount();
    const paid = await makeCampaign({ title: 'Money against this one' });
    const clean = await makeCampaign({ title: 'Nothing against this one' });

    const paidTask = await tasks.claim(userId, paid.id, { terms: true });
    const cleanTask = await tasks.claim(userId, clean.id, { terms: true });

    // A real movement of money, posted by the wallet itself, pointing at the
    // claim by name. Nothing here is written by hand into the ledger.
    await wallet.postRefund({
      userId,
      amountPaise: 129900n,
      idempotencyKey: `test-refund:${paidTask.id}`,
      referenceType: 'task',
      referenceId: paidTask.id,
    });

    const report = await freePracticeClaims(app, { quiet: true, mobile });

    expect(report.freed.map((f) => f.taskId)).toEqual([cleanTask.id]);
    expect(report.leftAlone).toHaveLength(1);
    expect(report.leftAlone[0].taskId).toBe(paidTask.id);
    expect(report.leftAlone[0].offer).toBe('Money against this one');
    expect(report.leftAlone[0].state).toBe('CLAIMED');
    expect(report.leftAlone[0].reason).toMatch(/money/i);

    // Untouched: still open, still claimed, and its ticket was not given back.
    const after = await prisma.task.findUniqueOrThrow({
      where: { id: paidTask.id },
    });
    expect(after.closedAt).toBeNull();
    expect(after.closeReason).toBeNull();
    expect(
      await prisma.ticketEntry.count({
        where: { taskId: paidTask.id, reason: 'EXPIRY_RETURN' },
      }),
    ).toBe(0);

    // Fifteen to start with, ten taken for two claims, five given back for the
    // one it freed. Ten.
    expect(await tickets.getBalance(userId)).toBe(10);
    expect(report.ticketsReturned).toBe(5);

    // AND THE MONEY IS ALL STILL THERE. Not one entry was removed to make the
    // claim easier to free.
    const movement = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { referenceType: 'task', referenceId: paidTask.id },
    });
    expect(
      await prisma.walletEntry.count({
        where: { transactionId: movement.id },
      }),
    ).toBe(2);
  });

  // ── 5. it really can be claimed again ──────────────────────────────────────

  it('means it: an offer it says was freed can be claimed again straight away', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const first = await tasks.claim(userId, campaign.id, { terms: true });

    // Before freeing, claiming again is not a new claim: Fayr hands back the one
    // that is already open, and takes no second ticket for it.
    const again = await tasks.claim(userId, campaign.id, { terms: true });
    expect(again.id).toBe(first.id);
    expect(await tickets.getBalance(userId)).toBe(10);

    const report = await freePracticeClaims(app, { quiet: true, mobile });
    expect(report.freed[0].canBeClaimedAgain).toBe(true);
    expect(await tickets.getBalance(userId)).toBe(15);

    const second = await tasks.claim(userId, campaign.id, { terms: true });
    expect(second.id).not.toBe(first.id);
    expect(second.state).toBe('CLAIMED');
    expect(second.closedAt).toBeNull();
    expect(await tickets.getBalance(userId)).toBe(10);
  });

  // ── A RELEASED CLAIM GIVES ITS SEAT BACK — 18 SEPTEMBER 2026 ─────────────
  //
  // This test used to be the OPPOSITE: "does not promise a second claim on an
  // offer whose seats are all taken", asserting canBeClaimedAgain === false and
  // a second claim rejected as full. That was the deliberate rule, and the owner
  // measured what it did to him: a one-slot campaign, claimed and released, and
  // "Every seat on this one is taken, so it is free and still shut." The
  // tickets came back and the seat did not, so the offer was dead for good.
  //
  // His rule replaces it: a claim RELEASED without ever buying holds no seat; a
  // claim that reached a purchase holds one for ever; a claim still running
  // holds one. seats.ts is the one place that says so, and these four tests
  // walk it against a real database.

  it('A RELEASED, NEVER-PURCHASED CLAIM FREES ITS SEAT, AND THE OFFER REOPENS', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign({ title: 'One seat only', totalSlots: 1 });
    await tasks.claim(userId, campaign.id, { terms: true });

    const report = await freePracticeClaims(app, { quiet: true, mobile });
    expect(report.freed).toHaveLength(1);
    expect(report.freed[0].canBeClaimedAgain).toBe(true);

    const counts = await claimedSeatsByCampaign(prisma, [campaign.id]);
    expect(claimedFor(counts, campaign.id)).toBe(0);
    expect(isFull(1, claimedFor(counts, campaign.id))).toBe(false);
  });

  it('A ONE-SLOT CAMPAIGN SURVIVES A CLAIM-AND-RELEASE AND CAN BE CLAIMED AGAIN', async () => {
    // The exact thing the owner did on his own account, followed by the thing
    // he could not then do.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign({ title: 'One seat only', totalSlots: 1 });
    const first = await tasks.claim(userId, campaign.id, { terms: true });
    await freePracticeClaims(app, { quiet: true, mobile });

    const second = await tasks.claim(userId, campaign.id, { terms: true });
    expect(second.id).not.toBe(first.id);
    expect(second.state).toBe('CLAIMED');
    expect(second.closedAt).toBeNull();

    // AND THE FIRST ROW IS STILL THERE, closed. Nothing was deleted to make room.
    const old = await prisma.task.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.closedAt).not.toBeNull();
    expect(old.closeReason).toBe('expired');
  });

  it('A CLAIM IN PROGRESS STILL HOLDS ITS SEAT', async () => {
    // Nothing released. The seat is spoken for and a second person is refused.
    const a = await newPracticeAccount();
    const b = await newPracticeAccount();
    const campaign = await makeCampaign({ title: 'One seat only', totalSlots: 1 });
    await tasks.claim(a.userId, campaign.id, { terms: true });

    const counts = await claimedSeatsByCampaign(prisma, [campaign.id]);
    expect(claimedFor(counts, campaign.id)).toBe(1);
    await expect(
      tasks.claim(b.userId, campaign.id, { terms: true }),
    ).rejects.toThrow(/full/i);
  });

  it('A PURCHASED CLAIM STILL HOLDS ITS SEAT FOR EVER', async () => {
    // "because that seat really was used". The row is put into the shape a
    // purchase leaves — PURCHASED, an order on it — and then CLOSED, which is
    // the strongest form of the claim: even a finished, closed purchase keeps
    // the seat, and a second person is still refused.
    const a = await newPracticeAccount();
    const b = await newPracticeAccount();
    const campaign = await makeCampaign({ title: 'One seat only', totalSlots: 1 });
    const claimed = await tasks.claim(a.userId, campaign.id, { terms: true });
    await prisma.task.update({
      where: { id: claimed.id },
      data: {
        state: 'PURCHASED',
        orderId: 'ORD-USED-THE-SEAT',
        closedAt: new Date(),
        closeReason: 'refunded',
      },
    });

    const counts = await claimedSeatsByCampaign(prisma, [campaign.id]);
    expect(claimedFor(counts, campaign.id)).toBe(1);
    await expect(
      tasks.claim(b.userId, campaign.id, { terms: true }),
    ).rejects.toThrow(/full/i);

    // AND ./free-claims LEAVES IT ALONE, exactly as before — a purchase cannot
    // be handed back.
    const report = await freePracticeClaims(app, { quiet: true, mobile: a.mobile });
    expect(report.freed).toEqual([]);
  });

  // ── 6. running it twice ────────────────────────────────────────────────────

  it('is safe to run twice, and the second run gives nothing back twice', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const claimed = await tasks.claim(userId, campaign.id, { terms: true });

    const first = await freePracticeClaims(app, { quiet: true, mobile });
    expect(first.freed).toHaveLength(1);
    expect(await tickets.getBalance(userId)).toBe(15);

    const second = await freePracticeClaims(app, { quiet: true, mobile });
    expect(second.freed).toEqual([]);
    expect(second.leftAlone).toEqual([]);
    expect(second.ticketsReturned).toBe(0);

    // The important part: the second run did not give five more tickets back.
    expect(await tickets.getBalance(userId)).toBe(15);
    expect(
      await prisma.ticketEntry.count({
        where: { taskId: claimed.id, reason: 'EXPIRY_RETURN' },
      }),
    ).toBe(1);
  });

  it('says so plainly when there is nothing to free', async () => {
    const { mobile } = await newPracticeAccount();
    const report = await freePracticeClaims(app, { quiet: true, mobile });
    expect(report.freed).toEqual([]);
    expect(report.leftAlone).toEqual([]);
    expect(report.ticketsReturned).toBe(0);
    expect(report.ticketsNow).toBe(15);
  });

  // ── 7. the number ─────────────────────────────────────────────────────────

  it('never lets a telephone number out, in what it returns or what it refuses', async () => {
    // The owner's rule. The practice account is a real handset, and everything
    // this command produces gets pasted into messages and reports.
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    await tasks.claim(userId, campaign.id, { terms: true });

    const report = await freePracticeClaims(app, { quiet: true, mobile });
    expect(report.account).not.toBe(mobile);
    expect(report.account).toContain('*');
    expect(JSON.stringify(report)).not.toContain(mobile.replace(/\D/g, ''));
    expect(JSON.stringify(report)).not.toContain(mobile.slice(-6));

    // And the same when it cannot find the account at all, which is the message
    // somebody is most likely to paste somewhere while asking what went wrong.
    const missing = newMobile();
    const said = await freePracticeClaims(app, {
      quiet: true,
      mobile: missing,
    }).then(
      () => 'it did not refuse',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    expect(said).toMatch(/no practice account/i);
    expect(said).not.toContain(missing.slice(-6));
  });

  // ── 7b. what came back is READ, never assumed ─────────────────────────────

  /**
   * A HOLE IN THIS SPEC, FOUND BY A MUTATION. Writing the number 5 into the
   * report instead of reading the ledger passed every check above, because a
   * claim costs 5 tickets and every world here was built by claiming.
   *
   * THE SCRIPT'S OWN COMMENT MAKES THE CLAIM THIS CHECKS: "the number of tickets
   * a claim cost is whatever was really taken for it, which is not always what
   * the offer costs today". So here is a claim that really cost something else.
   * It is hand built rather than claimed, and nothing already posted is rewritten,
   * because a posted entry is never edited anywhere in Fayr.
   */
  it('gives back what was really taken, not what an offer costs today', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign({ ticketCost: 5 });

    // A claim from before the cost was what it is now: three tickets, not five.
    const task = await prisma.task.create({
      data: {
        userId,
        campaignId: campaign.id,
        platform: campaign.platform,
        state: 'CLAIMED',
        category: campaign.category,
        claimExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    await prisma.ticketEntry.create({
      data: {
        userId,
        delta: -3,
        reason: 'CLAIM',
        taskId: task.id,
        balanceAfter: 12,
        idempotencyKey: `claim:${task.id}`,
      },
    });

    const report = await freePracticeClaims(app, { quiet: true, mobile });
    expect(report.freed).toHaveLength(1);
    expect(report.freed[0].ticketsReturned).toBe(3);
    expect(report.ticketsReturned).toBe(3);

    // And the ledger really says three, so the report is a reading of it.
    const back = await prisma.ticketEntry.findFirstOrThrow({
      where: { taskId: task.id, reason: 'EXPIRY_RETURN' },
    });
    expect(back.delta).toBe(3);
  });

  /**
   * AND A CLAIM FAYR ITSELF REFUSES TO LET GO IS LEFT ALONE AND NAMED.
   *
   * A task with no ticket deduction behind it cannot have tickets returned, and
   * the ticket service says so rather than guessing a number. That branch existed
   * in the script and nothing reached it. It is a real state on a practice
   * database, which has been edited by hand more than once.
   */
  it('leaves a claim Fayr itself refuses to let go, and repeats what Fayr said', async () => {
    const { mobile, userId } = await newPracticeAccount();
    const campaign = await makeCampaign();
    const task = await prisma.task.create({
      data: {
        userId,
        campaignId: campaign.id,
        platform: campaign.platform,
        state: 'CLAIMED',
        category: campaign.category,
        claimExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const report = await freePracticeClaims(app, { quiet: true, mobile });
    expect(report.freed).toEqual([]);
    expect(report.leftAlone).toHaveLength(1);
    expect(report.leftAlone[0].taskId).toBe(task.id);
    expect(report.leftAlone[0].reason).toMatch(/refused/i);
    expect(report.leftAlone[0].reason).toMatch(/no claim deduction/i);

    // And it really is still open, so nothing was half done to it.
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.closedAt).toBeNull();
    expect(after.state).toBe('CLAIMED');
  });

  // ── 8. the second gate, which the first cannot reach ──────────────────────

  /**
   * THE RULE TRAVELS WITH THE METHOD, NOT ONLY WITH THE COMMAND.
   *
   * The command refuses on a database that is not a practice one before it reads
   * a row, and the checks above prove that. But the method it calls is PUBLIC and
   * its name promises it is only for practice, and a method that promises that
   * and checks nothing is one somebody will one day call from somewhere else.
   * publishDraftsForPractice already made this choice and said out loud why: the
   * schema catches a bad setting at boot and the method catches every other route.
   *
   * IT CANNOT BE TESTED BY RUNNING IT, because the only database this suite can
   * reach is a practice one, so its own guard can never fire here. What CAN be
   * proved is that the guard is still written down, which is what stops it being
   * quietly deleted. The same technique as the check that proves the support
   * number lives in one file: go and look.
   */
  it('and the method the command calls refuses on its own account too', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/tasks/task.service.ts'),
      'utf8',
    );
    const method = source.slice(
      source.indexOf('async freeClaimForPractice('),
      source.indexOf('private expireClaim('),
    );
    expect(method.length).toBeGreaterThan(50);
    expect(method).toContain('await this.assertPracticeDatabase()');
    // And that guard really is the same rule, in the same shape as the other two.
    const guard = source.slice(
      source.indexOf('private async assertPracticeDatabase('),
      source.indexOf('private expireClaim('),
    );
    expect(guard).toContain('SELECT current_database()');
    expect(guard).toContain('/_dev$|_test$/');
    expect(guard).toContain('throw new Error(');
    // AND IT LETS A CLAIM GO THE PRODUCT'S OWN WAY AND NO OTHER. One description
    // of what freeing a claim means, not two.
    expect(method).toContain('return this.expireClaim(userId, taskId)');
    for (const handWritten of ['ticketEntry.create', 'walletEntry.create', 'delete(']) {
      expect({ handWritten, present: method.includes(handWritten) })
        .toEqual({ handWritten, present: false });
    }
  });
});
