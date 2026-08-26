import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ScreenshotKind } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { WithdrawalService } from '../src/withdrawals/withdrawal.service';
import { SupportQuestionService } from '../src/support/support-question.service';
import { ScreenshotVerificationService } from '../src/ocr/screenshot.service';
import type { Env } from '../src/config/env.validation';
import { TICKETS } from '../src/tickets/ticket.constants';
import { DEMO_CAMPAIGNS, type SeededCampaign } from './demo-catalogue';

/**
 * THE DEMO DATABASE, BUILT BY THE PRODUCT ITSELF.
 *
 * The old seed created four Amazon campaigns and stopped. No users, no tasks, no
 * claims, no withdrawals — so every one of the nine staff-panel queues was empty
 * on a fresh database, and so were MyProducts, Earnings and the wallet. An empty
 * queue does not read as "no work today" to someone seeing the product for the
 * first time. It reads as "not finished".
 *
 * THE RULE THIS FILE FOLLOWS: every state here is reached by calling the same
 * services the app calls — claim, submit evidence, mark reviewed, start hold,
 * release, request, approve, mark paid. Nothing writes a `state` column. That is
 * not fastidiousness; it is the only way the demo shows the product rather than a
 * picture of it. A hand-written REFUNDED row has no ledger entries behind it, so
 * the wallet would disagree with the task, and the first person to add up two
 * screens would find it.
 *
 * TWO THINGS ARE WRITTEN DIRECTLY, both deliberate:
 *
 *   1. STAFF ACCOUNTS. A staff login is a credential, not a state machine.
 *   2. A TASK'S createdAt / claimExpiresAt, immediately after claiming. This
 *      moves the CLOCK, it does not skip a transition — every transition still
 *      runs, in order, against the moved clock. A demo has to show a journey
 *      older than the database it lives in, and the order-window rule reads
 *      exactly these two columns, so they have to be honest before the evidence
 *      arrives rather than adjusted after.
 *
 * Idempotent throughout: campaigns upsert on their real ids, users and staff on
 * their unique columns, and a journey is skipped outright if that user already
 * has a task on that campaign. Running it twice changes nothing — asserted in
 * test/seed.e2e-spec.ts.
 */

/**
 * THE OFFER THE DEMO CLAIMS LIVE — never seeded, on any account.
 *
 * One purchase per user per campaign is enforced at claim time, so a seeded seat
 * on this offer makes the live claim — the most-watched moment of the run-sheet —
 * fail in front of the audience with "you have already claimed this".
 *
 * This is not hypothetical. The real demo account already holds a task on every
 * other candidate offer, leaving exactly TWO it has never touched, and one of
 * those two is this one. The fall-back "claim the first spare offer this account
 * has never touched" would have walked straight into it.
 *
 * Matched on a title fragment because the candidate lists are titles too, and
 * enforced in ensureUnboughtClaim rather than trusted to whoever edits the list.
 */
export const RESERVED_FOR_LIVE_CLAIM = 'Spin Your Storage';

/** Standing in for a real handset. See DEMO_MOBILE env note in seedDemo. */
export const DEMO_MOBILE_DEFAULT = '+919000000001';
const REVIEW_CHECK_MOBILE = '+919000000002';
const UNIT_COUNT_MOBILE = '+919000000003';

/** ₹100 — the minimum a withdrawal may be (withdrawal.constants.ts). */
const WITHDRAWAL_AMOUNT_PAISE = 10_000n;

/**
 * The reference on the seed's own payout, and the only way to tell it apart from
 * a payout the account already had. See buildWithdrawals for why that distinction
 * turned out to matter.
 */
export const DEMO_PAYOUT_UTR = 'UTR2608DEMO0001';

/**
 * The three offers the scripted journeys are built on, in the order they run.
 * Named here as well as at each journey because the ticket check has to know what
 * is coming before the first claim is made.
 */
const JOURNEY_OFFERS = [
  'Carry Your Laptop',
  'Prestige 1600W induction cooktop',
  'Dollar Bigboss Men Vest',
] as const;

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * The one offer the catalogue was missing.
 *
 * fayr_dev already carried Amazon, Flipkart and all three quick-commerce
 * platforms — but no Meesho campaign at all, which meant the marketplace the demo
 * uses as its second beat could not be shown, and the staff review-check queue
 * had no way to demonstrate its whole reason for existing (Meesho keeps the
 * written review inside its own app, so no machine can ever settle visibility
 * there).
 *
 * createdAt is deliberately OLDER than every captured campaign. The feed is
 * ordered newest-first, so an offer dated today would take the top card and push
 * the Amazon offer the run-sheet walks through from 8th place to 9th. Dated
 * earliest, it lands last and nothing above it moves.
 */
const MEESHO_CAMPAIGN: SeededCampaign = {
  id: 'd0000000-0000-4000-8000-00000000e001',
  platform: 'MEESHO',
  status: 'ACTIVE',
  title: 'Rate a Cotton Kurta Set, Get 90% Back',
  productName: 'Women’s Cotton Blend Straight Kurta with Palazzo Set, Maroon',
  category: 'Apparel',
  productPricePaise: 64900n,
  payoutPercent: 90,
  payoutCapPaise: null,
  ticketCost: 5,
  returnWindowDays: null,
  minRating: null,
  totalSlots: 40,
  asin: null,
  productUrl: 'https://www.meesho.com/womens-cotton-kurta-palazzo-set/p/demo01',
  imageUrl: null,
  terms:
    'Your Meesho account must use the same mobile number that is registered on Fayr.\n'
    + 'Buy the exact product and listing shown in this offer — no other colour, no other seller.\n'
    + 'One entry per person. Slots are given on a first-come, first-served basis.\n'
    + 'Meesho keeps written reviews inside its own app, so a Fayr reviewer opens the '
    + 'product page and confirms your review is there before the refund is released.\n'
    + 'Your refund is released after the return window closes and your review is still live.',
  createdAt: new Date('2026-08-03T09:00:00.000Z'),
};

/**
 * Every campaign the seed upserts — the captured catalogue plus the one offer it
 * adds. ONE list, because the journeys look offers up by title and a second list
 * meant the added offer was writable but not findable.
 */
const ALL_SEEDED_CAMPAIGNS: SeededCampaign[] = [...DEMO_CAMPAIGNS, MEESHO_CAMPAIGN];

/**
 * THE GUARD, at module scope so it can be tested without a database.
 *
 * Refuses a candidate list that names the reserved offer, rather than trusting
 * whoever edits that list next. A list is edited by someone who needs one more
 * candidate; the cost of getting it wrong is paid live, once, in front of
 * everyone.
 *
 * Matches in BOTH directions on purpose — a full title contains the fragment, and
 * a shorthand someone actually types ("Spin Your") is contained BY it. Only
 * checking one direction catches the case nobody makes.
 */
export function assertCandidatesNotReserved(candidateTitles: string[]): void {
  const reserved = candidateTitles.filter(
    (t) =>
      t.includes(RESERVED_FOR_LIVE_CLAIM) || RESERVED_FOR_LIVE_CLAIM.includes(t),
  );
  if (reserved.length > 0) {
    throw new Error(
      `Demo seed: "${reserved.join('", "')}" names the offer the demo claims LIVE. `
        + 'Seeding a claim on it makes that claim fail with "already claimed" '
        + 'during the demo. Choose another offer.',
    );
  }
}

export interface SeedDemoOptions {
  /** Suppress the progress log (the e2e run does). */
  quiet?: boolean;
  /** Bypass the live lookup, for testing the safety guard itself. */
  databaseNameOverride?: string;
  /**
   * Whose account carries the finished journeys. Set DEMO_MOBILE to a real
   * handset and the presenter signs in with a real code and lands on an account
   * that already has products, earnings and a payout history — without the setup
   * questions being skipped, because that latch is separate.
   */
  demoMobile?: string;
}

export interface DemoSeedReport {
  campaigns: number;
  staff: number;
  users: number;
  journeys: string[];
  skipped: string[];
}

/** A local dev password. Real ones never live in a file — see .env.example. */
const STAFF_DEV_PASSWORD = process.env.DEMO_STAFF_PASSWORD ?? 'fayr-demo-only';

const STAFF: { email: string; name: string; role: 'SUPPORT' | 'FINANCE' | 'OPERATIONS' | 'ADMIN' }[] = [
  { email: 'support@fayr.local', name: 'Demo Support', role: 'SUPPORT' },
  { email: 'finance@fayr.local', name: 'Demo Finance', role: 'FINANCE' },
  { email: 'ops@fayr.local', name: 'Demo Operations', role: 'OPERATIONS' },
  { email: 'admin@fayr.local', name: 'Demo Admin', role: 'ADMIN' },
];

/**
 * Two tiny PNGs. The first is uploaded by TWO different users so the staff queue
 * shows a real duplicate-image count — the forgery signal the screenshot tier
 * exists to catch, which is worth far more on screen than three unrelated files.
 */
const PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mNkYPjPgAaYGBgYGBgAABkwAgHi7fkAAAAASUVORK5CYII=',
  'base64',
);
const PNG_B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mP8z8DwnwEJMDIwMDAwMAAAGjACAeAMOQ8AAAAASUVORK5CYII=',
  'base64',
);

export async function seedDemo(
  app: INestApplicationContext,
  opts: SeedDemoOptions = {},
): Promise<DemoSeedReport> {
  const prisma = app.get(PrismaService);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const tasks = app.get(TaskService);
  const tickets = app.get(TicketService);
  const wallet = app.get(WalletService);
  const withdrawals = app.get(WithdrawalService);
  const questions = app.get(SupportQuestionService);
  const screenshots = app.get(ScreenshotVerificationService);

  const say = (m: string): void => {
    if (!opts.quiet) console.log(m);
  };

  await assertSafeDatabase(prisma, opts.databaseNameOverride);

  const claimTtlDays: number = config.get('CLAIM_TTL_DAYS', { infer: true });
  const now = Date.now();
  const report: DemoSeedReport = {
    campaigns: 0,
    staff: 0,
    users: 0,
    journeys: [],
    skipped: [],
  };

  // ── 1. the catalogue ──────────────────────────────────────────────────────
  for (const campaign of ALL_SEEDED_CAMPAIGNS) {
    const { id, ...data } = campaign;
    await prisma.campaign.upsert({
      where: { id },
      update: data,
      create: campaign,
    });
    report.campaigns += 1;
  }
  say(`  campaigns  ${report.campaigns}`);

  // ── 2. staff, one per role ────────────────────────────────────────────────
  // One account per role so every tab can be shown signed in as the person who
  // really owns it, instead of leaning on ADMIN's super-role for all nine.
  const passwordHash = await argon2.hash(STAFF_DEV_PASSWORD);
  for (const s of STAFF) {
    await prisma.staffUser.upsert({
      where: { email: s.email },
      // The hash is NOT rewritten on re-run: re-hashing on every seed would
      // invalidate nothing but wastes a second, and leaving it alone means a
      // password changed by hand survives.
      update: { name: s.name, role: s.role, status: 'ACTIVE' },
      create: { email: s.email, name: s.name, role: s.role, passwordHash },
    });
    report.staff += 1;
  }
  say(`  staff      ${report.staff} (one per role)`);

  // ── 3. users ──────────────────────────────────────────────────────────────
  const demoMobile = opts.demoMobile ?? process.env.DEMO_MOBILE ?? DEMO_MOBILE_DEFAULT;
  const demo = await upsertUser(demoMobile);
  const reviewCheckUser = await upsertUser(REVIEW_CHECK_MOBILE);
  const unitCountUser = await upsertUser(UNIT_COUNT_MOBILE);
  report.users = 3;
  say(`  users      3 (demo account: ${demoMobile})`);

  async function upsertUser(mobile: string): Promise<{ id: string }> {
    const user = await prisma.user.upsert({
      where: { mobile },
      update: {},
      create: { mobile },
    });
    // Idempotent by its own key, so re-running never re-grants.
    await tickets.grantSignup(user.id);
    return { id: user.id };
  }

  // ── 4. the demo account's four journeys ───────────────────────────────────
  //
  // ORDER MATTERS, and the constraint is tickets, not tidiness. A signup grant is
  // 15 and a claim costs 5, so three claims empty the account. The completion
  // grant (+10, on a withdrawal actually being PAID) is what pays for the rest —
  // so the finished journey has to run FIRST, and the account ends on 5: exactly
  // one claim, which is what the live demo needs. Nothing is topped up by hand;
  // if it were, the ticket economy the demo explains would not be the one running.

  // 4a. Finished and partly cashed out. 'Accessories' is not in the return-window
  //     table, so it takes the 7-day default — the only way a claim inside the
  //     order-window rule's era (17 Aug onwards) can also have a window that has
  //     already closed.
  await ensureTicketsForJourneys(demo.id);

  const laptopBag = findCampaign('Carry Your Laptop');
  const refunded = await journey({
    label: 'refunded + paid out',
    user: demo,
    campaignId: laptopBag.id,
    claimedAt: now - 8 * DAY,
    order: {
      id: 'AMZ-406-8871234-5540118',
      unitPricePaise: laptopBag.productPricePaise.toString(),
      quantity: 1,
      product: laptopBag.productName,
    },
    deliveredAfter: 2 * HOUR,
    review: { rating: 5, published: true, publishedSource: 'review-public' },
    advance: 'refund',
  });

  if (refunded.taskId) {
    await buildWithdrawals(demo.id, demoMobile);
  }

  /**
   * A payout method, then a PARTIAL withdrawal, then one left waiting.
   *
   * Partial on purpose: cashing out the lot leaves a zero balance, and a wallet
   * showing ₹0 with a Withdraw button that has nothing to act on is exactly the
   * emptiness this seed exists to remove.
   *
   * Guarded on the END STATE rather than on "did this run create the journey".
   * The first version asked the latter and it was wrong twice over: a re-run skips
   * the already-built journey, so the withdrawals would never have been created at
   * all — and when this step failed part-way through a real database, the retry
   * silently did nothing instead of finishing the job.
   */
  async function buildWithdrawals(userId: string, mobile: string): Promise<void> {
    const balance = await wallet.getUserBalance(userId);
    if (balance < 2n * WITHDRAWAL_AMOUNT_PAISE) {
      // Not a crash: the demo mobile can be pointed at a real account that has no
      // refund behind it, and that is a legitimate state, not a broken seed.
      say(
        '  note       skipped withdrawals — the demo account has no refunded '
          + 'balance to cash out',
      );
      return;
    }

    const method = await ensurePayoutMethod(userId, mobile);
    const finance = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'finance@fayr.local' },
    });

    // SCOPED TO THE SEED'S OWN PAYOUT, by its reference.
    //
    // Asking "has this account ever been paid?" was wrong the moment the demo was
    // pointed at a real account: that one already carried a PAID withdrawal from
    // an unrelated payout weeks earlier, so the seed skipped its own — and with it
    // the +10 completion grant that funds the last three journeys. The run then
    // died three claims later, a long way from the cause.
    const alreadyPaid = await prisma.withdrawal.findFirst({
      where: { userId, status: 'PAID', utr: DEMO_PAYOUT_UTR },
    });
    if (!alreadyPaid) {
      const w = await withdrawals.requestWithdrawal(
        userId,
        WITHDRAWAL_AMOUNT_PAISE,
        method.id,
      );
      await withdrawals.approve(finance.id, w.id);
      await withdrawals.markPaid(finance.id, w.id, DEMO_PAYOUT_UTR);
      report.journeys.push('withdrawal paid out (+10 completion tickets)');
    }

    const alreadyWaiting = await prisma.withdrawal.findFirst({
      where: { userId, status: 'REQUESTED' },
    });
    if (!alreadyWaiting) {
      await withdrawals.requestWithdrawal(
        userId,
        WITHDRAWAL_AMOUNT_PAISE,
        method.id,
      );
      report.journeys.push('one withdrawal waiting for FINANCE');
    }
  }

  /**
   * The demo account's payout instrument, reused if it has one.
   *
   * A FIXED pan/UPI here is what broke the first run against a database that
   * already had people in it: PAN anchoring gives one PAN to exactly one account
   * for life, and the obvious placeholder was already anchored to an earlier test
   * user, so the seed died on a 409 that was the fraud rule working correctly.
   * Both identifiers are therefore derived from the demo mobile — stable across
   * re-runs, and distinct for whatever account the demo is pointed at.
   */
  async function ensurePayoutMethod(
    userId: string,
    mobile: string,
  ): Promise<{ id: string }> {
    const existing = await prisma.payoutMethod.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    if (existing) return existing;

    const digits = mobile.replace(/\D/g, '').slice(-4).padStart(4, '0');
    try {
      return await withdrawals.addPayoutMethod(userId, {
        type: 'UPI',
        pan: `FAYRD${digits}F`,
        upiId: `fayr.demo.${digits}@okaxis`,
      });
    } catch (err) {
      // Say what to do about it. A bare 409 here reads as a broken seed when it
      // is actually a real account already carrying a different PAN.
      throw new Error(
        `Demo seed: could not add a payout method for ${mobile} — `
          + `${(err as Error).message}. That account is already anchored to a `
          + 'different PAN, which cannot be changed. Point DEMO_MOBILE at another '
          + 'number, or clear that account.',
      );
    }
  }

  // 4b. In the holding period, with a live countdown. Electronics is a 10-day
  //     window, so a claim two days old still has eight days to run — the state
  //     the whole deleted-review countermeasure exists for.
  const cooktop = findCampaign('Prestige 1600W induction cooktop');
  await journey({
    label: 'reviewed, in the holding period',
    user: demo,
    campaignId: cooktop.id,
    claimedAt: now - 2 * DAY,
    order: {
      id: 'FK-OD433918274655',
      unitPricePaise: cooktop.productPricePaise.toString(),
      quantity: 1,
      product: cooktop.productName,
    },
    deliveredAfter: 6 * HOUR,
    review: { rating: 4, published: true, publishedSource: 'review-public' },
    advance: 'hold',
  });

  // 4c. Bought and delivered, no review yet — the state that asks the user to do
  //     something, and the one a demo most needs on screen.
  const vest = findCampaign('Dollar Bigboss Men Vest');
  await journey({
    label: 'delivered, review not written yet',
    user: demo,
    campaignId: vest.id,
    claimedAt: now - 3 * DAY,
    order: {
      id: 'FK-OD433901882314',
      unitPricePaise: vest.productPricePaise.toString(),
      quantity: 1,
      product: vest.productName,
    },
    deliveredAfter: 26 * HOUR,
    advance: 'evidence',
  });

  // 4d. Claimed, not bought — the one state with an expiry date on it, and so the
  //     one that needs a guarantee rather than a row.
  //     The list is ordered, and the order matters on an account with history:
  //     the first three are the synthetic account's, and the Meesho offer is the
  //     last resort — the only ACTIVE offer the real demo account has never
  //     touched apart from the one reserved for the live claim. Claiming it also
  //     puts Meesho on that account's products, which the demo's second beat can
  //     use.
  await ensureUnboughtClaim(demo.id, [
    'Lukzer Garment Rack',
    'Train in Comfort',
    'bedside lamp',
    'Rate a Cotton Kurta Set',
  ]);

  // ── 5. the two staff-decision queues ──────────────────────────────────────

  // 5a. Review checks. A star on file and NOTHING that outranks a person having
  //     checked the page: no publishedSource, so no machine has spoken. This is
  //     the honest Meesho shape, not a contrivance.
  await journey({
    label: 'awaiting a Fayr reviewer’s eyes on the product page',
    user: reviewCheckUser,
    campaignId: MEESHO_CAMPAIGN.id,
    claimedAt: now - 3 * DAY,
    order: {
      id: 'MEE-1290448817',
      unitPricePaise: MEESHO_CAMPAIGN.productPricePaise.toString(),
      quantity: 1,
      product: MEESHO_CAMPAIGN.productName,
    },
    deliveredAfter: 30 * HOUR,
    review: {
      rating: 5,
      published: false,
      title: 'Lovely fabric',
      text: 'Cotton is soft and the fit is true to size. Washed once, no colour bleed.',
    },
    advance: 'evidence',
  });

  // 5b. Unit counts. A LINE total with no unit count — a real quick-commerce
  //     read, where the order page states a basket total and never says how many
  //     of the item it covers. The refund is held because it cannot be computed,
  //     not because anything is wrong.
  const flowerPot = findCampaign('Chrysanthemum Flower Pot');
  const heldOnCount = await journey({
    label: 'refund held on a unit count nobody has confirmed',
    user: unitCountUser,
    campaignId: flowerPot.id,
    claimedAt: now - 2 * DAY,
    order: {
      id: 'BLK-88213004',
      lineTotalPaise: '119800', // two pots in one basket, and the page never says so
      orderTotalPaise: '145700',
      product: flowerPot.productName,
      // Blinkit states the rating on the order itself, so visibility is settled
      // and this task belongs in ONE queue, not two.
      quantityReason: 'not-stated',
    },
    deliveredAfter: 1 * HOUR,
    review: { rating: 5, published: true, publishedSource: 'order-history' },
    advance: 'evidence',
  });

  // ── 6. screenshots, including a duplicate ─────────────────────────────────
  const reviewCheckTask = await firstTaskFor(reviewCheckUser.id);
  if (heldOnCount.taskId && reviewCheckTask) {
    await addScreenshot(unitCountUser.id, heldOnCount.taskId, 'PURCHASE', PNG_A);
    // The SAME bytes on a different user's task. The queue shows a duplicate
    // count against both, which is the forgery signal the tier-3 path is for.
    await addScreenshot(reviewCheckUser.id, reviewCheckTask, 'PURCHASE', PNG_A);
    await addScreenshot(unitCountUser.id, heldOnCount.taskId, 'REVIEW', PNG_B);
  }

  async function addScreenshot(
    userId: string,
    taskId: string,
    kind: ScreenshotKind,
    buffer: Buffer,
  ): Promise<void> {
    const already = await prisma.screenshotUpload.count({
      where: { taskId, userId, kind },
    });
    if (already > 0) return; // idempotent
    await screenshots.uploadForUser(userId, taskId, kind, {
      originalname: `${kind.toLowerCase()}.png`,
      mimetype: 'image/png',
      size: buffer.length,
      buffer,
    });
  }

  // ── 7. a question waiting for SUPPORT ─────────────────────────────────────
  const openQuestions = await prisma.supportQuestion.count({
    where: { userId: reviewCheckUser.id },
  });
  if (openQuestions === 0) {
    await questions.create(
      reviewCheckUser.id,
      'When will my refund arrive?',
      'I posted my review four days ago and the app still says it is being '
        + 'checked. The kurta arrived on time and I have not returned it. Can you '
        + 'tell me how much longer this takes?',
    );
    report.journeys.push('one open support question');
  }

  say(`  journeys   ${report.journeys.length} built, ${report.skipped.length} already present`);
  return report;

  // ── helpers ───────────────────────────────────────────────────────────────

  function findCampaign(titleFragment: string): SeededCampaign {
    // Searches everything the seed upserts, not just the captured catalogue. It
    // used to search DEMO_CAMPAIGNS alone, so the one offer the seed ADDS was
    // invisible to its own journeys — findable in the database it had just
    // written and not in the list it wrote from.
    const found = ALL_SEEDED_CAMPAIGNS.find((c) => c.title.includes(titleFragment));
    if (!found) {
      // A renamed offer must break the seed loudly. Silently skipping a journey
      // would leave a queue empty and nothing to say why.
      throw new Error(
        `Demo seed: no campaign whose title contains "${titleFragment}". `
          + 'The catalogue was re-captured — update the journey that names it.',
      );
    }
    return found;
  }

  async function firstTaskFor(userId: string): Promise<string | null> {
    const t = await prisma.task.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return t?.id ?? null;
  }

  /**
   * GUARANTEE: the demo account always has a claim it has not bought yet, with a
   * full purchase window ahead of it.
   *
   * Stated as a guarantee about the STATE, not as one more journey, because this
   * is the only state with a deadline attached and therefore the only one that can
   * disappear on its own. Two failures, both found by reading a real database
   * rather than by reasoning about one:
   *
   *   1. A claim backdated by a day had a deadline seven days after SEEDING, and a
   *      demo is not run on the day the database is built. Seeded on 25 August it
   *      lapsed on the 31st, so a demo on 1 September would have found the sweep
   *      had expired it overnight.
   *   2. Once it HAS expired, re-running the seed could not put it back: the
   *      one-purchase-per-campaign rule refuses a second claim on that campaign,
   *      and the skip-if-a-task-exists check would find the dead one and move on.
   *      So the fix needs a spare offer to fall back to, not a retry.
   *
   * Topping the deadline up is a FIXTURE refresh and nothing in the app does it —
   * no product path moves a purchase deadline, and none should. It only ever
   * pushes the date out, and only on a task still awaiting its purchase.
   *
   * The ticket arithmetic takes care of itself: an expired claim returns its 5
   * tickets, and the replacement claim spends 5, so the account still lands on
   * exactly one claim's worth for the live demo.
   */
  /**
   * ENOUGH TICKETS TO BUILD THE JOURNEYS, AND ONE CLAIM LEFT OVER FOR THE DEMO.
   *
   * Why this exists at all: the signup grant is idempotent per user for life. The
   * real demo account had spent all 15 of its own on claims whose tasks a database
   * reset later removed, so it sat on a balance of zero with nothing able to put
   * tickets back — and the seed's very first claim failed. Every test until then
   * had started from a fresh user, so nothing could see it.
   *
   * WHAT IT WORKS OUT, rather than assumes:
   *
   *     needed = 5 per claim the seed still has to make
   *            + 5 for the live claim the demo makes on the day
   *            − 10 if the seed's own payout is still to happen (that pays the
   *              completion grant back mid-run)
   *
   * On a fresh account that arithmetic comes to exactly 15 — the signup grant —
   * so nothing is added and the ticket economy the demo explains is the one
   * actually running. It only ever tops up to what is needed, never past it, and
   * it is one append-only correction keyed per account, so it cannot become a tap.
   *
   * If the estimate is ever short, a claim fails loudly with the balance in the
   * message. That is the right failure: a seed that silently under-funds itself
   * leaves a state missing, which is the one thing this file exists to prevent.
   */
  async function ensureTicketsForJourneys(userId: string): Promise<void> {
    const offerIds = JOURNEY_OFFERS.map((t) => findCampaign(t).id);
    const builtByOffer = await prisma.task.groupBy({
      by: ['campaignId'],
      where: { userId, campaignId: { in: offerIds } },
    });
    const liveClaim = await prisma.task.count({
      where: { userId, state: 'CLAIMED', closedAt: null },
    });
    const claimsToMake =
      offerIds.length - builtByOffer.length + (liveClaim > 0 ? 0 : 1);

    // The completion grant only arrives if the refunded journey is built AND the
    // seed's payout has not already happened. Both are checkable, so neither is
    // assumed.
    const refundedOffer = findCampaign(JOURNEY_OFFERS[0]).id;
    const refundedWillRun = !builtByOffer.some(
      (g) => g.campaignId === refundedOffer,
    );
    const payoutDone = await prisma.withdrawal.findFirst({
      where: { userId, status: 'PAID', utr: DEMO_PAYOUT_UTR },
    });
    const grantBack =
      refundedWillRun && !payoutDone ? TICKETS.COMPLETION_GRANT : 0;

    const needed =
      TICKETS.DEFAULT_CLAIM_COST * (claimsToMake + 1) - grantBack;
    const balance = await tickets.getBalance(userId);
    if (balance >= needed) return;

    const short = needed - balance;
    await tickets.adjust(
      userId,
      short,
      `demo-seed:ticket-baseline:${userId}`,
    );
    say(
      `  tickets    +${short} correction — the account had ${balance} and needs `
        + `${needed} for ${claimsToMake} claim(s) plus one live one`,
    );
    report.journeys.push(`restored the ticket baseline (+${short})`);
  }

  async function ensureUnboughtClaim(
    userId: string,
    candidateTitles: string[],
  ): Promise<void> {
    assertCandidatesNotReserved(candidateTitles);
    const candidates = candidateTitles
      .map((t) => findCampaign(t))
      .filter((c) => !c.title.includes(RESERVED_FOR_LIVE_CLAIM));

    const live = await prisma.task.findFirst({
      where: {
        userId,
        state: 'CLAIMED',
        closedAt: null,
        campaignId: { in: candidates.map((c) => c.id) },
      },
    });
    if (live) {
      const fullWindow = new Date(now + claimTtlDays * DAY);
      if ((live.claimExpiresAt?.getTime() ?? 0) < fullWindow.getTime()) {
        await prisma.task.update({
          where: { id: live.id },
          data: { createdAt: new Date(now), claimExpiresAt: fullWindow },
        });
        report.journeys.push('topped up the unbought claim’s purchase deadline');
      } else {
        report.skipped.push('claimed, still to buy');
      }
      return;
    }

    // Nothing live. Claim the first spare offer this account has never touched.
    for (const candidate of candidates) {
      const used = await prisma.task.findFirst({
        where: { userId, campaignId: candidate.id },
      });
      if (used) continue;
      await journey({
        label: 'claimed, still to buy',
        user: { id: userId },
        campaignId: candidate.id,
        claimedAt: now,
        advance: 'claim',
      });
      return;
    }

    // Out of spares. Say so loudly — a silently missing state is the whole thing
    // this seed exists to prevent.
    say(
      '  WARNING    no unbought claim could be created: every spare offer has '
        + 'already been claimed by this account. Add a title to the candidate list '
        + 'or use a fresh demo account.',
    );
  }

  interface JourneySpec {
    label: string;
    user: { id: string };
    campaignId: string;
    claimedAt: number;
    order?: Record<string, unknown>;
    deliveredAfter?: number;
    review?: Record<string, unknown>;
    /** How far to drive it: claim only, evidence only, into the hold, or paid. */
    advance: 'claim' | 'evidence' | 'hold' | 'refund';
  }

  async function journey(
    spec: JourneySpec,
  ): Promise<{ created: boolean; taskId: string | null }> {
    // Idempotency, and the reason it is checked HERE rather than caught as an
    // error: claiming twice is refused by the one-per-campaign rule, so a re-run
    // would throw where nothing is actually wrong.
    const existing = await prisma.task.findFirst({
      where: { userId: spec.user.id, campaignId: spec.campaignId },
    });
    if (existing) {
      // SAY WHAT WAS FOUND, not what it implies. The skip is keyed on (user,
      // campaign), NOT on state — so on an account with history it fires for a
      // campaign that merely has a task on it. Reporting the journey's label alone
      // read as "this state is already present", which on the real demo account
      // was wrong for three of them: what was actually there were CLAIMED tasks
      // that had expired and closed months of demo-time ago. A seed that
      // misdescribes what it skipped is worse than one that skips silently,
      // because the person reading the output stops checking.
      const state = existing.closedAt ? `${existing.state}, closed` : existing.state;
      report.skipped.push(`${spec.label} — offer already has a task (${state})`);
      return { created: false, taskId: existing.id };
    }

    const claimed = await tasks.claim(spec.user.id, spec.campaignId);

    // MOVE THE CLOCK BEFORE ANY EVIDENCE ARRIVES. The order-window rule reads
    // tasks.createdAt and tasks.claimExpiresAt to decide whether a purchase could
    // have been caused by this claim, so backdating afterwards would judge the
    // evidence against a window that no longer applies.
    await prisma.task.update({
      where: { id: claimed.id },
      data: {
        createdAt: new Date(spec.claimedAt),
        claimExpiresAt: new Date(spec.claimedAt + claimTtlDays * DAY),
      },
    });

    if (spec.advance !== 'claim') {
      const orderAt = spec.claimedAt + 1 * HOUR;
      if (spec.order) {
        await tasks.submitEvidence(spec.user.id, claimed.id, {
          key: `seed:order:${claimed.id}`,
          order: {
            ...spec.order,
            date: orderAt,
            source: 'order-details',
            match: { score: 0.97, amountOk: true, ambiguous: false, candidateCount: 1 },
          } as never,
          returned: false,
        });
      }
      if (spec.deliveredAfter != null || spec.review) {
        await tasks.submitEvidence(spec.user.id, claimed.id, {
          key: `seed:delivery:${claimed.id}`,
          ...(spec.deliveredAfter != null
            ? {
                delivery: {
                  at: orderAt + spec.deliveredAfter,
                  source: 'order-details',
                },
              }
            : {}),
          ...(spec.review ? { review: spec.review } : {}),
        } as never);
      }
    }

    if (spec.advance === 'hold' || spec.advance === 'refund') {
      await tasks.markReviewed(spec.user.id, claimed.id);
      await tasks.startHold(spec.user.id, claimed.id);
    }
    if (spec.advance === 'refund') {
      await tasks.releaseRefund(spec.user.id, claimed.id);
    }

    report.journeys.push(spec.label);
    return { created: true, taskId: claimed.id };
  }
}

/**
 * The guard the old seed did not need and this one does.
 *
 * It used to write four campaigns. It now writes users, tasks, ledger entries and
 * withdrawals, so pointing it at anything real would be unrecoverable. Mirrors
 * the check the e2e suite already makes before it truncates tables.
 */
async function assertSafeDatabase(
  prisma: PrismaService,
  override?: string,
): Promise<void> {
  let name = override;
  if (name == null) {
    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    name = rows[0]?.current_database ?? '';
  }
  if (!/_dev$|_test$/.test(name)) {
    throw new Error(
      `Demo seed refused: "${name}" is not a dev or test database. `
        + 'This seed writes users, tasks, ledger entries and withdrawals.',
    );
  }
}
