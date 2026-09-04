import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, type StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

/**
 * THE PAGE THAT MEASURES FAYR ITSELF, END TO END.
 *
 * ── WHY EVERY NUMBER BELOW IS EXACT ──────────────────────────────────────────
 *
 * "more than nought" would pass against a page that counted the wrong rows, and
 * that is the only kind of wrongness this page can have. So a known world of ten
 * places is written in, every figure it must show is worked out BY HAND in the
 * comments, and the checks require those figures and nothing else.
 *
 * THE WORLD, and it is designed so each row proves one thing:
 *
 *   T1  claimed, deadline ahead                       an ordinary open place
 *   T2  claimed, deadline PASSED, already given up    must NOT count as overdue
 *   T3  claimed, deadline PASSED, still open          the one overdue place
 *   T4  delivered, order read off the shop, payable   automatic, not held
 *   T5  delivered, order from a picture, no price     HELD on amount unknown
 *   T6  waiting, order typed by hand, no unit count   HELD on count, past its window
 *   T7  waiting, order source NOBODY GROUPED, payable the unmapped-name net
 *   T8  refunded, order from a signed email           the far end of the journey
 *   T10 delivered, price above the total and unclear  a hold nobody can clear
 *   T11 waiting, return time finished, payable        the second one past its window
 *   T13 review found, return time NOT finished        reviewed without being in the wait
 *   T12 claimed 20 DAYS AGO, given up                 inside 30 days, outside a shorter window
 *   T9  claimed 60 DAYS AGO                           outside the thirty-day column
 *
 * T5 carries a live review with no review event against it, which is the real
 * database's own disagreement reproduced on purpose.
 */
describe('How Fayr is running (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffTokens: StaffTokenService;
  let seq = 0;

  const server = () => app.getHttpServer();
  const ROUTE = '/admin/how-it-is-running';
  const ALL_ROLES: StaffRole[] = ['SUPPORT', 'FINANCE', 'OPERATIONS', 'ADMIN'];

  async function tokenFor(role: StaffRole): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `${role.toLowerCase()}${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name: `Test ${role}`,
        role,
      },
    });
    const session = await staffTokens.issueSession(staff);
    return session.accessToken;
  }

  async function readPage(role: StaffRole = 'ADMIN') {
    const token = await tokenFor(role);
    const res = await request(server())
      .get(ROUTE)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    return res.body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    staffTokens = app.get(StaffTokenService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`how-it-is-running e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const DAY = 86_400_000;
  const HOUR = 3_600_000;

  /** The whole world, written in through Prisma. Returns nothing on purpose. */
  async function buildTheWorld(): Promise<void> {
    const now = Date.now();
    const user = await prisma.user.create({
      data: { mobile: `+9199${String(now).slice(-8)}` },
    });

    // Ninety per cent, no ceiling.
    const offerA = await prisma.campaign.create({
      data: {
        platform: 'AMAZON',
        status: 'ACTIVE',
        title: 'Offer A',
        productName: 'Product A',
        productPricePaise: 100_000n,
        payoutPercent: 90,
      },
    });
    // Eighty five per cent with a ₹500 ceiling, so the ceiling is what bites.
    const offerB = await prisma.campaign.create({
      data: {
        platform: 'FLIPKART',
        status: 'ACTIVE',
        title: 'Offer B',
        productName: 'Product B',
        productPricePaise: 200_000n,
        payoutPercent: 85,
        payoutCapPaise: 50_000n,
      },
    });

    const place = async (over: {
      campaignId: string;
      state: 'CLAIMED' | 'DELIVERED' | 'REVIEWED' | 'HOLDING' | 'REFUNDED';
      createdAt?: Date;
      closeReason?: string | null;
      claimExpiresAt?: Date | null;
      orderId?: string | null;
      deliveredAt?: Date | null;
      reviewPublished?: boolean | null;
      windowEndsAt?: Date | null;
      orderConfirmed?: boolean;
      order?: Prisma.InputJsonObject | null;
      markReviewed?: boolean;
    }): Promise<string> => {
      const row = await prisma.task.create({
        data: {
          userId: user.id,
          campaignId: over.campaignId,
          platform: 'AMAZON',
          state: over.state,
          createdAt: over.createdAt ?? new Date(now),
          closeReason: over.closeReason ?? null,
          claimExpiresAt: over.claimExpiresAt ?? null,
          orderId: over.orderId ?? null,
          deliveredAt: over.deliveredAt ?? null,
          reviewPublished: over.reviewPublished ?? null,
          windowEndsAt: over.windowEndsAt ?? null,
          evidence: {
            order: over.order ?? null,
            delivery: null,
            review: null,
            orderConfirmed: over.orderConfirmed ?? false,
            probe: null,
          },
        },
      });
      if (over.markReviewed) {
        await prisma.taskEvent.create({
          data: {
            taskId: row.id,
            type: 'MARK_REVIEWED',
            fromState: 'DELIVERED',
            toState: 'REVIEWED',
          },
        });
      }
      return row.id;
    };

    // T1: an ordinary open place, deadline a day away.
    await place({
      campaignId: offerA.id,
      state: 'CLAIMED',
      claimExpiresAt: new Date(now + DAY),
    });
    // T2: deadline passed AND already given up. Not overdue: it is finished.
    await place({
      campaignId: offerA.id,
      state: 'CLAIMED',
      closeReason: 'expired',
      claimExpiresAt: new Date(now - DAY),
    });
    // T3: deadline passed and still open. THE one overdue place.
    await place({
      campaignId: offerA.id,
      state: 'CLAIMED',
      claimExpiresAt: new Date(now - HOUR),
    });
    // T4: read off the shop, one unit at ₹1,000. Payable, not held.
    await place({
      campaignId: offerA.id,
      state: 'DELIVERED',
      orderId: 'ORD-4',
      deliveredAt: new Date(now - 3 * DAY),
      order: {
        id: 'ORD-4',
        source: 'order-details',
        unitPricePaise: '100000',
        quantity: 1,
      },
    });
    // T5: read from a picture, and NO money field at all. Held: amount unknown.
    // Its review is live but it was never moved on to the review step, which is
    // the disagreement the real database has today.
    await place({
      campaignId: offerA.id,
      state: 'DELIVERED',
      orderId: 'ORD-5',
      deliveredAt: new Date(now - 3 * DAY),
      reviewPublished: true,
      order: { id: 'ORD-5', source: 'ocr' },
    });
    // T6: typed in by hand, a line total with no unit count. Held on the count,
    // and its return time finished two days ago.
    await place({
      campaignId: offerA.id,
      state: 'HOLDING',
      orderId: 'ORD-6',
      deliveredAt: new Date(now - 9 * DAY),
      reviewPublished: true,
      markReviewed: true,
      windowEndsAt: new Date(now - 2 * DAY),
      order: {
        id: 'ORD-6',
        source: 'manual',
        lineTotalPaise: '119800',
        orderTotalPaise: '145700',
      },
    });
    // T7: A SOURCE NAME NOBODY HAS GROUPED, and payable. Offer B, so the
    // ceiling decides the figure.
    await place({
      campaignId: offerB.id,
      state: 'HOLDING',
      orderId: 'ORD-7',
      deliveredAt: new Date(now - 2 * DAY),
      reviewPublished: true,
      markReviewed: true,
      windowEndsAt: new Date(now + 5 * DAY),
      order: {
        id: 'ORD-7',
        source: 'shiny-new-reader',
        unitPricePaise: '200000',
        quantity: 1,
      },
    });
    // T8: the far end. A signed email, confirmed by the person, already paid.
    await place({
      campaignId: offerA.id,
      state: 'REFUNDED',
      orderId: 'ORD-8',
      deliveredAt: new Date(now - 12 * DAY),
      reviewPublished: true,
      markReviewed: true,
      windowEndsAt: new Date(now - 3 * DAY),
      orderConfirmed: true,
      order: {
        id: 'ORD-8',
        source: 'dkim',
        unitPricePaise: '100000',
        quantity: 1,
      },
    });
    // T10: the item price sits above the total and the row was unclear. Held for
    // a reason NOBODY has a control to clear.
    await place({
      campaignId: offerA.id,
      state: 'DELIVERED',
      orderId: 'ORD-10',
      deliveredAt: new Date(now - DAY),
      order: {
        id: 'ORD-10',
        source: 'invoice',
        lineTotalPaise: '100000',
        orderTotalPaise: '30000',
        itemAmountAmbiguous: true,
      },
    });
    // T11: a SECOND wait whose return time has finished, and payable.
    //
    // It exists because a boundary with exactly one row on each side of it cannot
    // tell "finished" from "not finished": flipping the comparison gave the same
    // count of one, and the check passed. Two on one side and one on the other is
    // what makes that mutation fail.
    await place({
      campaignId: offerA.id,
      state: 'HOLDING',
      orderId: 'ORD-11',
      deliveredAt: new Date(now - 8 * DAY),
      reviewPublished: true,
      markReviewed: true,
      windowEndsAt: new Date(now - 5 * DAY),
      order: {
        id: 'ORD-11',
        source: 'order-history',
        unitPricePaise: '100000',
        quantity: 1,
      },
    });
    // T13: a review found and the task moved on to the review step, but the
    // return time has NOT finished, so it is not in the wait yet.
    //
    // It exists so the report's "reviewed" count is bigger than its "holding"
    // count. With the two equal, a funnel that counted holding a step too early
    // gave the same answer and no check noticed.
    await place({
      campaignId: offerA.id,
      state: 'REVIEWED',
      orderId: 'ORD-13',
      deliveredAt: new Date(now - 4 * DAY),
      reviewPublished: true,
      markReviewed: true,
      windowEndsAt: new Date(now + 3 * DAY),
      order: {
        id: 'ORD-13',
        source: 'order-details',
        unitPricePaise: '100000',
        quantity: 1,
      },
    });
    // T12: taken TWENTY days ago, and given up. Inside the thirty-day column and
    // outside any shorter one.
    //
    // It exists because every other place here was taken today, so a window of
    // seven days and a window of thirty days covered exactly the same rows: the
    // cohort boundary could be worked out any way at all and no check noticed.
    await place({
      campaignId: offerA.id,
      state: 'CLAIMED',
      createdAt: new Date(now - 20 * DAY),
      closeReason: 'expired',
      claimExpiresAt: new Date(now - 19 * DAY),
    });
    // T9: taken sixty days ago, so it is outside the thirty-day column.
    await place({
      campaignId: offerA.id,
      state: 'CLAIMED',
      createdAt: new Date(now - 60 * DAY),
      claimExpiresAt: new Date(now - 59 * DAY + DAY),
    });

    // ── the money book ──────────────────────────────────────────────────────
    // One refund of ₹900 into the wallet, then ₹100 asked for and marked paid.
    const userAcct = await prisma.walletAccount.create({
      data: { kind: 'USER', userId: user.id },
    });
    const houseAcct = await prisma.walletAccount.create({ data: { kind: 'HOUSE' } });
    const payoutAcct = await prisma.walletAccount.create({ data: { kind: 'PAYOUT' } });
    const refund = await prisma.ledgerTransaction.create({
      data: { kind: 'REFUND', idempotencyKey: `refund-${now}` },
    });
    await prisma.walletEntry.createMany({
      data: [
        { transactionId: refund.id, accountId: userAcct.id, amountPaise: 90_000n },
        { transactionId: refund.id, accountId: houseAcct.id, amountPaise: -90_000n },
      ],
    });
    const reserve = await prisma.ledgerTransaction.create({
      data: { kind: 'WITHDRAWAL', idempotencyKey: `reserve-${now}` },
    });
    await prisma.walletEntry.createMany({
      data: [
        { transactionId: reserve.id, accountId: userAcct.id, amountPaise: -10_000n },
        { transactionId: reserve.id, accountId: payoutAcct.id, amountPaise: 10_000n },
      ],
    });
    const method = await prisma.payoutMethod.create({
      data: { userId: user.id, type: 'UPI', upiId: `someone${seq++}@bank` },
    });
    await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: method.id,
        amountPaise: 10_000n,
        status: 'PAID',
        utr: 'REFERENCE-0001',
        decidedAt: new Date(now),
      },
    });
    await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: method.id,
        amountPaise: 10_000n,
        status: 'FAILED',
        failureReason: 'the bank sent it back',
        decidedAt: new Date(now),
      },
    });

    // ── conversations ───────────────────────────────────────────────────────
    // One handed over ten minutes ago, which is past what Fayr promises. One
    // handed over thirty seconds ago, which is not.
    //
    // BOTH started an hour ago, on purpose: a wait counted from startedAt would
    // read as two long waits and both would be wrong.
    await prisma.chat.create({
      data: {
        userId: user.id,
        state: 'WAITING_FOR_PERSON',
        startedAt: new Date(now - 60 * 60_000),
        handedOverAt: new Date(now - 10 * 60_000),
      },
    });
    await prisma.chat.create({
      data: {
        userId: user.id,
        state: 'WAITING_FOR_PERSON',
        startedAt: new Date(now - 60 * 60_000),
        handedOverAt: new Date(now - 30_000),
      },
    });

    // ── the nightly offer check, run by hand eight days ago ─────────────────
    await prisma.campaignCheckRun.create({
      data: {
        ranAt: new Date(now - 8 * DAY),
        trigger: 'MANUAL',
        checked: 13,
        blocking: 1,
        attention: 13,
        unchecked: 21,
        findings: [],
      },
    });
    // The real shop page check is deliberately left with NO runs.
  }

  // ── who can open it ───────────────────────────────────────────────────────

  describe('who can open it', () => {
    it('every staff role can, and nobody signed out can', async () => {
      for (const role of ALL_ROLES) {
        const token = await tokenFor(role);
        await request(server())
          .get(ROUTE)
          .set('authorization', `Bearer ${token}`)
          .expect(200);
      }
      await request(server()).get(ROUTE).expect(401);
    });

    it('takes no query at all, which is the point of it', async () => {
      // A report is a thing you ask a question of. This is the answer to "is it
      // working", and a director does not fill in a form. A stray query must not
      // change the answer either.
      const token = await tokenFor('ADMIN');
      const plain = await request(server())
        .get(ROUTE)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      const withRubbish = await request(server())
        .get(`${ROUTE}?from=2020-01-01&granularity=week&format=xlsx`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(withRubbish.body.journey).toEqual(plain.body.journey);
      expect(withRubbish.body.money.lines).toEqual(plain.body.money.lines);
    });
  });

  // ── an empty database ─────────────────────────────────────────────────────

  describe('on an empty database', () => {
    it('says nothing yet and never-looked, and never a bare nought', async () => {
      const page = await readPage();

      // A place nobody has taken is a real nought: we counted, and there were
      // none. This is the distinction the whole page turns on.
      const took = page.journey.steps[0];
      expect(took.everythingSoFar).toEqual({ kind: 'counted', count: 0 });

      // THE STEP NOTHING RECORDS says so in BOTH columns, and never nought.
      // There used to be two of these. Signing in at the shop became a real count
      // on 5 September 2026, so going to the shop is the only one left.
      expect(page.journey.steps[1].everythingSoFar.kind).toBe('not-watching');
      expect(page.journey.steps[1].lastThirtyDays.kind).toBe('not-watching');
      expect(page.journey.steps[1].whatItWouldTake).toBeTruthy();

      // And signing in is a REAL NOUGHT on an empty database: we counted rows and
      // there were none. That is a different sentence from nobody watching, and
      // the whole page turns on the difference.
      expect(page.journey.steps[2].everythingSoFar).toEqual({ kind: 'counted', count: 0 });
      expect(page.journey.steps[2].lastThirtyDays).toEqual({ kind: 'counted', count: 0 });
      expect(page.journey.steps[2].whatItWouldTake).toBeNull();

      // Money that has never moved has nothing to read, not a nought.
      expect(page.money.lines[0].amount).toEqual({ kind: 'nothing-yet' });
      // And an account with no entries really does hold nothing.
      expect(page.money.lines[1].amount).toEqual({ kind: 'counted', paise: '0' });

      // Neither offer check has ever run.
      for (const run of page.offers.runs) {
        expect(run.lastLooked).toBeNull();
        expect(run.neverRun).toContain('No offer page has ever been checked');
        for (const count of run.counts) {
          expect(count.reading).toEqual({ kind: 'nothing-yet' });
        }
      }

      // Nothing has failed, and that is a real nought: the column exists and is
      // filled on every payout decision.
      const failed = page.machine.rows.find((r: { label: string }) =>
        r.label.includes('failed'),
      );
      expect(failed.reading).toEqual({ kind: 'counted', count: 0 });

      // All six hold reasons are shown even with nothing held.
      expect(page.money.held.reasons).toHaveLength(6);
      expect(page.money.held.total).toEqual({ kind: 'counted', count: 0 });
      // Nothing is waiting, so there is no figure to show for what would pay.
      expect(page.money.waiting.wouldPay).toEqual({ kind: 'nothing-yet' });
    });

    it('stamps the moment it was read, in words and as a moment', async () => {
      const before = Date.now();
      const page = await readPage();
      const after = Date.now();
      expect(page.readAt).toMatch(
        /^Read at \d{1,2}:\d\d in the (morning|afternoon|evening) on \d{1,2} \w+\.$/,
      );
      const stamped = new Date(page.readAtIso).getTime();
      expect(stamped).toBeGreaterThanOrEqual(before - 1000);
      expect(stamped).toBeLessThanOrEqual(after + 1000);
    });
  });

  // ── the known world ───────────────────────────────────────────────────────

  describe('the known world, ten places', () => {
    beforeEach(buildTheWorld);

    it('counts the journey, both columns, to the exact number', async () => {
      const page = await readPage();
      const soFar = page.journey.steps.map(
        (s: { everythingSoFar: unknown }) => s.everythingSoFar,
      );
      const thirty = page.journey.steps.map(
        (s: { lastThirtyDays: unknown }) => s.lastThirtyDays,
      );
      const NOT_WATCHED = 'not-watching';

      // Worked out by hand from the world above:
      //   took a place        T1..T8, T10..T13, T9          = 13
      //   went to the shop    nothing records it
      //   signed in           no shop sign in row was written = 0
      //   gave us their order T8 alone                      = 1
      //   order established   T4 T5 T6 T7 T8 T10 T11 T13    = 8
      //   product arrived     the same eight                = 8
      //   review found live   T5 T6 T7 T8 T11 T13           = 6
      //   return time done    T6 (-2d) T8 (-3d) T11 (-5d)   = 3
      //   refund released     T8                            = 1
      //   money taken out     one payout marked paid        = 1
      expect(soFar[0]).toEqual({ kind: 'counted', count: 13 });
      expect(soFar[1].kind).toBe(NOT_WATCHED);
      // A real nought, not an excuse: this world records no shop sign in at all.
      expect(soFar[2]).toEqual({ kind: 'counted', count: 0 });
      expect(soFar[3]).toEqual({ kind: 'counted', count: 1 });
      expect(soFar[4]).toEqual({ kind: 'counted', count: 8 });
      expect(soFar[5]).toEqual({ kind: 'counted', count: 8 });
      expect(soFar[6]).toEqual({ kind: 'counted', count: 6 });
      expect(soFar[7]).toEqual({ kind: 'counted', count: 3 });
      expect(soFar[8]).toEqual({ kind: 'counted', count: 1 });
      expect(soFar[9]).toEqual({ kind: 'counted', count: 1 });

      // The thirty-day column drops T9 and NOTHING ELSE, because T9 is the only
      // place taken outside the window. So the top row is one lower and every
      // other row is untouched.
      // T12 is inside this window and T9 is not, so the thirty-day column is one
      // lower than everything so far, and NOT the same as a seven-day window.
      expect(thirty[0]).toEqual({ kind: 'counted', count: 12 });
      // No shop sign in in this world, in either column.
      expect(thirty[2]).toEqual({ kind: 'counted', count: 0 });
      expect(thirty[3]).toEqual({ kind: 'counted', count: 1 });
      expect(thirty[4]).toEqual({ kind: 'counted', count: 8 });
      expect(thirty[6]).toEqual({ kind: 'counted', count: 6 });
      expect(thirty[8]).toEqual({ kind: 'counted', count: 1 });

      // The two columns really are different here, so the page must NOT claim
      // they match.
      expect(page.journey.bothMatchToday).toBeNull();

      // Given up for running out of time: T2 and T12, and both are inside the top
      // row above.
      expect(page.journey.expired.everythingSoFar).toEqual({
        kind: 'counted',
        count: 2,
      });
      expect(page.journey.expired.lastThirtyDays).toEqual({
        kind: 'counted',
        count: 2,
      });
      expect(page.journey.expired.meaning).toContain('inside the top row');
    });

    it('shows the drop, and refuses to invent one across an unwatched step', async () => {
      const page = await readPage();
      const drops = page.journey.steps.map(
        (s: { dropSoFar: unknown }) => s.dropSoFar,
      );

      expect(drops[0]).toBeNull(); // nothing above the first step
      expect(drops[1].kind).toBe('cannot-tell');
      // Signing in is counted now, but the step ABOVE it is not, so the drop into
      // it still cannot be told. That is the rule and it has not changed.
      expect(drops[2].kind).toBe('cannot-tell');
      // Confirming an order is not a step on the way, so no drop is shown.
      expect(drops[3].kind).toBe('not-a-step');
      // AND HERE IS THE ONE THE NEW COUNT CHANGES, on purpose.
      //
      // Eight places established an order and NOT ONE has a sign in recorded,
      // because this world writes no sign in row at all. So the funnel really
      // does go backwards here, by eight, and the page says exactly that instead
      // of hiding it or clamping it to nought. It is the honest answer for every
      // place taken before the phone started telling our side, and the page's own
      // list of what is not real yet says so in words.
      expect(drops[4].kind).toBe('does-not-line-up');
      expect(drops[4].by).toBe(8);
      expect(drops[4].why).toContain('8 more places than the step above it');
      // 8 arrived out of 8 established, so nobody dropped out. A nought drop is
      // still shown, because "nobody dropped out" is worth reading.
      expect(drops[5]).toEqual({ kind: 'dropped', count: 0 });
      expect(drops[6]).toEqual({ kind: 'dropped', count: 2 }); // 8 -> 6
      expect(drops[7]).toEqual({ kind: 'dropped', count: 3 }); // 6 -> 3
      expect(drops[8]).toEqual({ kind: 'dropped', count: 2 }); // 3 -> 1
      expect(drops[9]).toEqual({ kind: 'dropped', count: 0 }); // 1 -> 1
    });

    it('owns up to the two columns that disagree about the review', async () => {
      const page = await readPage();
      // Six places carry a live review; five were moved on to the review step.
      // T5 is the odd one out, on purpose.
      const review = page.journey.steps[6];
      expect(review.disagreement).toContain('1 fewer place than this');
      expect(review.disagreement).toContain('The two do not agree');
      // And where they DO agree, nothing is said at all.
      expect(page.journey.steps[4].disagreement).toBeNull();
      expect(page.journey.steps[5].disagreement).toBeNull();
    });

    it('says the journey counts where people are now', async () => {
      const page = await readPage();
      expect(page.journey.whereTheyAreNow).toContain('where people are now');
      expect(page.journey.canGoBackwards).toContain('back a step');
    });

    it("pins every number in the report's own funnel, not just the ones on the page", async () => {
      // WHY THIS EXISTS. The page and the report both call funnelOf now, so if
      // that function counts the wrong rows they agree with each other and the
      // agreement check passes. Making its `reviewed` count a step too early was
      // noticed by nothing at all. So every member is worked out by hand here:
      //
      //   claimed    everything taken in the last thirty days: T1..T8, T10..T13 = 12
      //   purchased  T4 T5 T6 T7 T8 T10 T11 T13                                  = 8
      //   delivered  the same eight, none still only purchased                   = 8
      //   reviewed   the ones moved on: T6 T7 T8 T11 T13                         = 5
      //   holding    T6 T7 T11, plus T8 which went past it. NOT T13.             = 4
      //   refunded   T8                                                          = 1
      //   expired    T2 T12                                                      = 2
      const token = await tokenFor('ADMIN');
      const report = await request(server())
        .get('/admin/reports/activity')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(report.body.funnel).toEqual({
        claimed: 12,
        purchased: 8,
        delivered: 8,
        reviewed: 5,
        holding: 4,
        refunded: 1,
        expired: 2,
      });
      // The two that used to be equal, kept apart on purpose: with reviewed === holding
      // a funnel that counted holding a step early gave the same answer.
      expect(report.body.funnel.reviewed).toBeGreaterThan(report.body.funnel.holding);
    });

    it('agrees with the existing activity report, and shows that it checked', async () => {
      const page = await readPage();
      expect(page.journey.agreesWithActivityReport).toBe(true);

      // And prove it against the report itself rather than trusting the flag.
      const token = await tokenFor('ADMIN');
      const report = await request(server())
        .get('/admin/reports/activity')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      // The report's cohort is the same thirty days. Its claimed count is the
      // page's thirty-day top row, and its refunded count the page's refund row.
      expect(report.body.funnel.claimed).toBe(12);
      expect(page.journey.steps[0].lastThirtyDays.count).toBe(
        report.body.funnel.claimed,
      );
      expect(page.journey.steps[8].lastThirtyDays.count).toBe(
        report.body.funnel.refunded,
      );
      expect(page.journey.expired.lastThirtyDays.count).toBe(
        report.body.funnel.expired,
      );
    });

    it('counts how each order was established, and they ADD UP', async () => {
      const page = await readPage();
      const byHeading = new Map<string, number>(
        [...page.howOrders.groups, page.howOrders.doNotKnow].map(
          (g: { heading: string; count: { count: number } }) => [
            g.heading,
            g.count.count,
          ],
        ),
      );

      // Worked out by hand: T4 and T13 order-details, T8 dkim and T11
      // order-history are automatic; T5 ocr and T10 invoice came from a picture;
      // T6 manual was typed in; T7 carries a name nobody has grouped.
      expect(byHeading.get('Read automatically off the shop')).toBe(4);
      expect(byHeading.get('Read from a picture')).toBe(2);
      expect(byHeading.get('Typed in by hand')).toBe(1);
      expect(byHeading.get('We do not know')).toBe(1);

      // 4 + 2 + 1 + 1 = 8, which is the number of orders established in the
      // journey above, reached down a different path. The page must not be able
      // to disagree with itself.
      const total = [...byHeading.values()].reduce((a, b) => a + b, 0);
      expect(total).toBe(8);
      expect(page.howOrders.established).toEqual({ kind: 'counted', count: 8 });
      expect(page.journey.steps[4].everythingSoFar.count).toBe(total);
      expect(page.howOrders.addsUp).toBe(true);
      expect(page.howOrders.addsUpProblem).toBeNull();
    });

    it('NAMES a source nobody grouped instead of counting it as automatic', async () => {
      const page = await readPage();
      expect(page.howOrders.unmappedNames).toEqual(['shiny-new-reader']);
      // The safety net: it must NOT have landed in the automatic row.
      const automatic = page.howOrders.groups.find(
        (g: { heading: string }) => g.heading === 'Read automatically off the shop',
      );
      expect(automatic.count.count).toBe(4);
      // And the grouping table is on the screen, so nobody has to trust it.
      expect(automatic.names).toEqual(['dkim', 'order-details', 'order-history']);
    });

    it('shows the money, from the record, in whole paise', async () => {
      const page = await readPage();
      const amount = (label: string) =>
        page.money.lines.find((l: { label: string }) => l.label.includes(label))
          ?.amount;

      // ₹900 went in; ₹100 was asked for and left the wallet at once.
      expect(amount('Refunds released')).toEqual({
        kind: 'counted',
        paise: '90000',
      });
      expect(amount('sitting in wallets')).toEqual({
        kind: 'counted',
        paise: '80000',
      });
      expect(amount('payout holding account')).toEqual({
        kind: 'counted',
        paise: '10000',
      });
    });

    it('agrees with the existing payouts report about refunds released', async () => {
      // The check that stops the page and the spreadsheet drifting apart.
      const page = await readPage();
      const token = await tokenFor('ADMIN');
      const report = await request(server())
        .get('/admin/reports/payouts')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      const released = page.money.lines.find((l: { label: string }) =>
        l.label.includes('Refunds released'),
      );
      expect(released.amount.paise).toBe(report.body.refundsCreditedPaise);
    });

    it('says NO MONEY HAS LEFT FAYR, and says why', async () => {
      const page = await readPage();
      // The money book is RIGHT. Fayr cannot send money, so nothing has left.
      expect(page.money.hasLeftFayr.amount).toEqual({
        kind: 'counted',
        paise: '0',
      });
      const words = page.money.hasLeftFayr.words;
      expect(words).toContain('One payout is marked paid');
      expect(words).toContain('because Fayr cannot send money yet');
      expect(words).toContain('a person moved the money by hand, outside Fayr');
      expect(words).toContain('₹100 is sitting in the payout holding account');
    });

    it('keeps WAITING and HELD apart, and counts each exactly', async () => {
      const page = await readPage();

      // Waiting is normal: T6, T7 and T11 are the three places in the wait.
      expect(page.money.waiting.count).toEqual({ kind: 'counted', count: 3 });
      // Two of the three are payable, and each one goes through the same code a
      // real release does:
      //   T7  offer B pays 85 per cent of ₹2,000, which is ₹1,700, and the
      //       ceiling of ₹500 cuts it to ₹500 →  50000
      //   T11 offer A pays 90 per cent of ₹1,000, with no ceiling →  90000
      //   total                                                    → 140000
      expect(page.money.waiting.wouldPay).toEqual({
        kind: 'counted',
        paise: '140000',
      });
      // T6 cannot be worked out at all, so it is NOT in that figure.
      expect(page.money.waiting.cannotWorkOut).toEqual({
        kind: 'counted',
        count: 1,
      });
      expect(page.money.waiting.workedOutBy).toContain('computeRefundPaise');

      // Held is a decision: T5 amount unknown, T6 count unknown, T10 unclear.
      const held = new Map<string, number>(
        page.money.held.reasons.map(
          (r: { reason: string; count: { count: number } }) => [
            r.reason,
            r.count.count,
          ],
        ),
      );
      expect(held.get('amount-unknown')).toBe(1);
      expect(held.get('quantity-unknown')).toBe(1);
      expect(held.get('item-price-above-total-and-ambiguous')).toBe(1);
      expect(held.get('quantity-not-divisible')).toBe(0);
      expect(held.get('quantity-implausible')).toBe(0);
      expect(held.get('amount-gap-implausible')).toBe(0);
      expect(page.money.held.total).toEqual({ kind: 'counted', count: 3 });
      expect(page.money.held.reasons).toHaveLength(6);

      // T6 is in both lists, and the page says so rather than letting somebody
      // add two numbers that overlap.
      expect(page.money.held.alsoWaiting).toContain(
        'One of these is in the waiting list above as well',
      );
    });

    it('shows no rupee figure against a held refund, because there is none', async () => {
      const page = await readPage();
      // The reason a refund is held IS that the amount cannot be worked out. A
      // figure here would be invented and a nought would be a lie.
      expect(page.money.held.leadTwo).toContain('No amount is shown against these');
      for (const reason of page.money.held.reasons) {
        expect(reason).not.toHaveProperty('paise');
        expect(reason).not.toHaveProperty('amount');
      }
      expect(page.money.held.theRule).toBe(
        'Money is held when Fayr is not sure. '
        + 'Fayr would rather make somebody wait for a person than send the wrong amount.',
      );
    });

    it('warns when a hold has no control anybody can use', async () => {
      const page = await readPage();
      // T10 is held for a reason the staff list leaves out on purpose, so
      // nothing is being done about it. That has to be said.
      expect(page.money.held.nobodyCanClearWarning).toContain(
        'no control anybody can use',
      );
      const stuck = page.money.held.reasons.filter(
        (r: { nobodyCanClearIt: boolean }) => r.nobodyCanClearIt,
      );
      expect(stuck).toHaveLength(2);
      expect(stuck.filter((r: { count: { count: number } }) => r.count.count > 0))
        .toHaveLength(1);
    });

    it('counts the machine rows off the deadlines Fayr set itself', async () => {
      const page = await readPage();
      const row = (fragment: string) =>
        page.machine.rows.find((r: { label: string }) => r.label.includes(fragment));

      // T3 AND T9. T2's deadline has passed too, but it was given up already, so
      // it is finished rather than overdue.
      //
      // T9 is the interesting one, and it was missed the first time this was
      // worked out by hand: it was taken sixty days ago and its deadline passed
      // fifty eight days ago, so it is overdue AND outside the thirty-day
      // column. This row counts every place, not a cohort, which is right: a
      // place stuck since July is still stuck today.
      expect(row('past their own deadline').reading).toEqual({
        kind: 'counted',
        count: 2,
      });
      // T6 AND T11. T7's return time has not finished yet.
      //
      // Two on one side of the line and one on the other, on purpose: with one
      // each way, flipping the comparison gives the same count and the check
      // cannot tell "finished" from "not finished". It could not, and did not.
      expect(row("past the shop's return time").reading).toEqual({
        kind: 'counted',
        count: 2,
      });
      // One conversation has waited ten minutes; the other thirty seconds.
      expect(row('Conversations waiting').reading).toEqual({
        kind: 'counted',
        count: 1,
      });
      // One payout really did fail.
      expect(row('Payouts that failed').reading).toEqual({
        kind: 'counted',
        count: 1,
      });
    });

    it('says WE ARE NOT WATCHING for the three nothing records, never nought', async () => {
      const page = await readPage();
      const unwatched = page.machine.rows.filter(
        (r: { reading: { kind: string } }) => r.reading.kind === 'not-watching',
      );
      expect(unwatched).toHaveLength(3);
      for (const r of unwatched) {
        expect(r.reading.whatItWouldTake.length).toBeGreaterThan(20);
        expect(r.reading).not.toHaveProperty('count');
      }
      const labels = unwatched.map((r: { label: string }) => r.label);
      expect(labels).toEqual([
        'Offer pages that could not be read',
        'Shops whose order list has stopped working',
        'Messages we tried to send and could not',
      ]);
    });

    it('shows the last run of each offer check, and how old it is', async () => {
      const page = await readPage();
      const [nightly, livePages] = page.offers.runs;

      expect(nightly.lastLooked).toMatch(/^Last looked on \d{1,2} \w+, which was 8 days ago\.$/);
      expect(nightly.howItStarted).toBe('Somebody ran this by hand.');
      expect(nightly.neverRun).toBeNull();
      const counts = new Map<string, number>(
        nightly.counts.map((c: { label: string; reading: { count: number } }) => [
          c.label,
          c.reading.count,
        ]),
      );
      expect(counts.get('Offers looked at')).toBe(13);
      expect(counts.get('Wrong enough to stop a shopper')).toBe(1);
      expect(counts.get('Worth somebody looking')).toBe(13);
      expect(counts.get('Could not be checked at all')).toBe(21);

      // No offer page has EVER been checked, and an old date beats a fresh nought.
      expect(livePages.lastLooked).toBeNull();
      expect(livePages.neverRun).toContain('No offer page has ever been checked');
      for (const count of livePages.counts) {
        expect(count.reading).toEqual({ kind: 'nothing-yet' });
      }
    });

    it('lists what is not real yet, and does not soften it', async () => {
      const page = await readPage();
      expect(page.notRealYet.items.length).toBeGreaterThanOrEqual(8);
      const all = page.notRealYet.items.join(' ');
      expect(all).toContain('cannot send money to a bank');
      expect(all).toContain('Nobody is ever told anything');
      expect(all).toContain('practice data');
      expect(all).toContain('has ever been checked against the real shop');
      expect(all).toContain('is not recorded at all');
      // AND THE CATCH ON THE NEW NUMBER IS ADMITTED, in the list of gaps rather
      // than hidden beside the number.
      expect(all).toContain('counted only from the day the phone started');
      expect(all).toContain('can read lower than the row under it');
    });

    it('changes nothing at all. Reading it twice reads the same', async () => {
      const before = await prisma.$transaction([
        prisma.task.count(),
        prisma.taskEvent.count(),
        prisma.walletEntry.count(),
        prisma.ledgerTransaction.count(),
        prisma.withdrawal.count(),
        prisma.chat.count(),
        prisma.campaignCheckRun.count(),
        prisma.livePageCheckRun.count(),
        prisma.adminAuditLog.count(),
      ]);
      const first = await readPage();
      const second = await readPage();
      const after = await prisma.$transaction([
        prisma.task.count(),
        prisma.taskEvent.count(),
        prisma.walletEntry.count(),
        prisma.ledgerTransaction.count(),
        prisma.withdrawal.count(),
        prisma.chat.count(),
        prisma.campaignCheckRun.count(),
        prisma.livePageCheckRun.count(),
        prisma.adminAuditLog.count(),
      ]);
      expect(after).toEqual(before);
      // Everything but the stamp at the top is identical.
      expect({ ...second, readAt: null, readAtIso: null }).toEqual({
        ...first,
        readAt: null,
        readAtIso: null,
      });
    });
  });
});
