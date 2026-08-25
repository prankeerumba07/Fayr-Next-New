import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ScreenshotKind } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WithdrawalService } from '../src/withdrawals/withdrawal.service';
import { SupportQuestionService } from '../src/support/support-question.service';
import { ScreenshotVerificationService } from '../src/ocr/screenshot.service';
import type { Env } from '../src/config/env.validation';
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

/** Standing in for a real handset. See DEMO_MOBILE env note in seedDemo. */
export const DEMO_MOBILE_DEFAULT = '+919000000001';
const REVIEW_CHECK_MOBILE = '+919000000002';
const UNIT_COUNT_MOBILE = '+919000000003';

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
  for (const campaign of [...DEMO_CAMPAIGNS, MEESHO_CAMPAIGN]) {
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

  if (refunded.created) {
    // A payout method, then a PARTIAL withdrawal. Partial on purpose: cashing out
    // the lot leaves a zero balance, and a wallet showing ₹0 with a Withdraw
    // button that has nothing to act on is the emptiness this seed exists to fix.
    const method = await withdrawals.addPayoutMethod(demo.id, {
      type: 'UPI',
      pan: 'ABCDE1234F',
      upiId: 'demo@okaxis',
    });
    const paid = await withdrawals.requestWithdrawal(demo.id, 10_000n, method.id);
    const financeStaff = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'finance@fayr.local' },
    });
    await withdrawals.approve(financeStaff.id, paid.id);
    await withdrawals.markPaid(financeStaff.id, paid.id, 'UTR2608DEMO0001');

    // And one left REQUESTED, so the FINANCE queue has real work in it.
    await withdrawals.requestWithdrawal(demo.id, 10_000n, method.id);
    report.journeys.push('withdrawal paid (+10 completion tickets) & one requested');
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

  // 4d. Claimed, not bought. Only ONE day old: backdate a live claim past its own
  //     purchase deadline and the maintenance sweep expires it, so the demo would
  //     open on a task that had evaporated overnight.
  const garmentRack = findCampaign('Lukzer Garment Rack');
  await journey({
    label: 'claimed, still to buy',
    user: demo,
    campaignId: garmentRack.id,
    claimedAt: now - 1 * DAY,
    advance: 'claim',
  });

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
    const found = DEMO_CAMPAIGNS.find((c) => c.title.includes(titleFragment));
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
      report.skipped.push(spec.label);
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
