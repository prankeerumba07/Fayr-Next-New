import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { TicketService } from '../src/tickets/ticket.service';
import type { StaffRole } from '@prisma/client';

/**
 * THE APP PROMISED A PERSON WOULD LOOK. THIS IS THE PERSON LOOKING.
 *
 * The Task screen has told Meesho users, for as long as the copy has existed,
 * that "a Fayr reviewer confirms yours is live". No reviewer could. Meesho shows
 * the star on the order but never the words on the web, so:
 *
 *   - the device reader honestly emits published:false — it has not seen a review,
 *     only a rating;
 *   - START_HOLD refuses to start the holding period without published:true;
 *   - the OCR screenshot path deliberately never asserts published, because a
 *     screenshot cannot prove a page is public;
 *   - the scheduler's permalink re-check has no permalink to fetch.
 *
 * So a Meesho task reached its review stage and stopped there permanently. These
 * tests are for the third privileged staff action that closes it: a reviewer
 * states that they opened the public product page and saw the review, and says
 * WHICH page and WHEN.
 *
 * What they also pin, because this action asserts a PAYOUT SIGNAL:
 *   - it may not overrule a machine that actually checked the public page;
 *   - it may only be retracted by the tier that made it;
 *   - it moves no money by itself;
 *   - and the audit row names the URL, the date, the reason and the old value.
 */
describe('Staff eyes-on-page review confirmation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let staffTokens: StaffTokenService;
  let ticketsSvc: TicketService;

  let seq = 0;
  const newMobile = () =>
    `+9194${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  const PRODUCT_URL = 'https://www.meesho.com/kurta-set/p/abc123';

  async function newUser() {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
    return { id: user.id, token };
  }

  async function tokenFor(role: StaffRole) {
    const staff = await prisma.staffUser.create({
      data: {
        email: `rv-${role.toLowerCase()}-${seq++}@test.fayr`,
        passwordHash: 'x'.repeat(60),
        name: `${role} tester`,
        role,
        status: 'ACTIVE',
      },
    });
    const session = await staffTokens.issueSession(staff);
    return { token: session.accessToken, id: staff.id };
  }

  /**
   * The real Meesho shape: a rated order with a readable order id and date, and a
   * review the device could only see the STAR of. Delivery is deliberately
   * present here so the task can reach the hold — Meesho itself gives no delivery
   * date, which is a SECOND, separate dead end and not what this action closes.
   */
  async function meeshoTaskWithStarOnly(
    userToken: string,
    opts: { delivery?: boolean } = {},
  ) {
    const campaign = await prisma.campaign.create({
      data: {
        platform: 'MEESHO',
        status: 'ACTIVE',
        title: 'Review the kurta set',
        productName: 'Cotton Kurta Set',
        category: 'fashion',
        productPricePaise: 49900n,
        payoutPercent: 100,
        ticketCost: 5,
        productUrl: PRODUCT_URL,
      },
    });
    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ campaignId: campaign.id })
      .expect(201);
    const taskId = created.body.id as string;
    const applied = await request(app.getHttpServer())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        order: {
          id: 'MEESHO-ORD-1',
          date: Date.now(),
          unitPricePaise: '49900',
          quantity: 1,
          quantitySource: 'label-qty',
          source: 'order-history',
        },
        ...(opts.delivery === false
          ? {}
          : { delivery: { at: Date.now(), source: 'order-history' } }),
        review: {
          reviewId: 'SUB-1',
          product: 'Cotton Kurta Set',
          rating: 5,
          // The honest Meesho answer: the star is real, the words are invisible
          // to us, and NOTHING established whether a review is publicly readable.
          published: false,
        },
        returned: false,
      })
      .expect(200);
    return { taskId, campaign, applied };
  }

  /** An Amazon task where a machine DID fetch the public review and found it. */
  async function amazonTaskMachineChecked(userToken: string, published: boolean) {
    const campaign = await prisma.campaign.create({
      data: {
        platform: 'AMAZON',
        status: 'ACTIVE',
        title: 'Review the lamp',
        productName: 'Desk Lamp',
        category: 'electronics',
        productPricePaise: 129900n,
        payoutPercent: 100,
        ticketCost: 5,
      },
    });
    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ campaignId: campaign.id })
      .expect(201);
    const taskId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        order: {
          id: 'AMZN-ORD-1',
          date: Date.now(),
          unitPricePaise: '129900',
          quantity: 1,
          quantitySource: 'label-qty',
          source: 'order-details',
        },
        review: {
          reviewId: 'R-1',
          product: 'Desk Lamp',
          rating: 5,
          published,
          // A machine fetched the public permalink and reached this verdict.
          publishedSource: 'review-public',
        },
      })
      .expect(200);
    return { taskId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    staffTokens = app.get(StaffTokenService);
    ticketsSvc = app.get(TicketService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (!rows[0]?.current_database?.endsWith('_test')) {
      throw new Error('Staff review-visibility e2e aborted: non-test database');
    }
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "staff_users","admin_audit_log","users","campaigns","tasks","task_events","visibility_checks","ticket_entries","wallet_accounts","wallet_entries","ledger_transactions","payout_methods","withdrawals","refresh_tokens" RESTART IDENTITY CASCADE',
    );
  });

  const server = () => app.getHttpServer();

  const body = (over: Record<string, unknown> = {}) => ({
    visible: true,
    productUrl: PRODUCT_URL,
    reason: 'opened the product page, review from this buyer is second from top',
    ...over,
  });

  // ── the dead end, and the way out ──────────────────────────────────────────

  it('turns a task that could NEVER refund into one that can', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);

    // Before: the star is on file, the review is not public, and the hold cannot
    // even be started — so the refund is unreachable by any route.
    await request(server())
      .post(`/tasks/${taskId}/reviewed`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    const blocked = await request(server())
      .post(`/tasks/${taskId}/start-hold`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(blocked.body.state).toBe('REVIEWED');
    expect(blocked.body.blocker).toBe('review_not_public');

    const support = await tokenFor('SUPPORT');
    const res = await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(200);
    expect(res.body.review.published).toBe(true);

    // After: the hold starts. That is the whole point — nothing else changed.
    const held = await request(server())
      .post(`/tasks/${taskId}/start-hold`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(held.body.state).toBe('HOLDING');
    expect(held.body.blocker).toBeNull();
  });

  it('records WHAT was seen: the page opened and the day it was opened', async () => {
    // "I checked" with no URL is not evidence. A year later somebody has to be
    // able to go to the same address and see what the reviewer saw.
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(200);

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const stored = row.evidence as unknown as {
      review: {
        published: boolean;
        publishedSource: string;
        visibleUrl: string;
        visibleCheckedAt: number;
      };
    };
    expect(stored.review.published).toBe(true);
    expect(stored.review.publishedSource).toBe('staff-confirmed-visible');
    expect(stored.review.visibleUrl).toBe(PRODUCT_URL);
    expect(typeof stored.review.visibleCheckedAt).toBe('number');
    // The promoted column follows, so a query can find it without reading JSON.
    expect(row.reviewPublished).toBe(true);
  });

  it('keeps every other fact about the review exactly as it was', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId, applied } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    const res = await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(200);

    expect(res.body.review.rating).toBe(applied.body.review.rating);
    expect(res.body.review.product).toBe(applied.body.review.product);
    // And the order is untouched — this action is about one fact only. Checked
    // against the REFUND figure, not the response's order block: the per-unit
    // price is never exposed there, so comparing it would be two undefineds
    // agreeing with each other.
    expect(res.body.order.id).toBe(applied.body.order.id);
    expect(res.body.refund.amountPaise).toBe(applied.body.refund.amountPaise);
    expect(res.body.refund.amountPaise).toBe('49900');
  });

  // ── it must not overrule a machine that looked ─────────────────────────────

  it('REFUSES when a machine already fetched the public review and found it gone', async () => {
    // The dangerous case. A reviewer who "remembers seeing it" must not be able
    // to override a fetch of the public page — that would turn this action into a
    // way to disarm the deleted-review countermeasure by hand.
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await amazonTaskMachineChecked(user.token, false);
    const support = await tokenFor('SUPPORT');

    const res = await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(409);
    expect(String(res.body.message)).toMatch(/checked the public/i);

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.reviewPublished).toBe(false);
  });

  it('REFUSES when a machine already confirmed it — there is nothing to add', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await amazonTaskMachineChecked(user.token, true);
    const support = await tokenFor('SUPPORT');

    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(409);
  });

  it('REFUSES a task with no review at all — that is asserting the whole fact', async () => {
    // Confirming VISIBILITY of a review the marketplace never told us exists is a
    // different and much larger claim: it would let a staff member invent the
    // review itself. The star has to be on file first.
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const campaign = await prisma.campaign.create({
      data: {
        platform: 'MEESHO',
        status: 'ACTIVE',
        title: 'x',
        productName: 'x',
        category: 'fashion',
        productPricePaise: 49900n,
        payoutPercent: 100,
        ticketCost: 5,
      },
    });
    const created = await request(server())
      .post('/tasks')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ campaignId: campaign.id })
      .expect(201);
    const support = await tokenFor('SUPPORT');
    const res = await request(server())
      .post(`/admin/tasks/${created.body.id}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(409);
    expect(String(res.body.message)).toMatch(/no review/i);
  });

  // ── correcting yourself ───────────────────────────────────────────────────

  it('lets the reviewer take it back — and only the tier that said it may', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(200);

    const back = await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body({ visible: false, reason: 'looked again, it is not there' }))
      .expect(200);
    expect(back.body.review.published).toBe(false);

    // And with the confirmation withdrawn the refund is unreachable again.
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.reviewPublished).toBe(false);
  });

  it('refuses to withdraw a verdict a MACHINE made — that is a different decision', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await amazonTaskMachineChecked(user.token, true);
    const support = await tokenFor('SUPPORT');

    const res = await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body({ visible: false, reason: 'I think it is gone' }))
      .expect(409);
    expect(String(res.body.message)).toMatch(/checked the public/i);
  });

  it('can be confirmed again after a withdrawal — a cycle is not a duplicate', async () => {
    // A content-derived idempotency key would silently swallow this: the third
    // press repeats the first press's key, the server no-ops, and the panel says
    // "saved" over a record that did not change.
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    for (const visible of [true, false, true]) {
      const res = await request(server())
        .post(`/admin/tasks/${taskId}/review-visible`)
        .set('authorization', `Bearer ${support.token}`)
        .send(body({ visible, reason: 'checked again' }))
        .expect(200);
      expect(res.body.review.published).toBe(visible);
    }
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.reviewPublished).toBe(true);
  });

  it('is a no-op when nothing would change — a double click is one decision', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    for (let i = 0; i < 2; i++) {
      await request(server())
        .post(`/admin/tasks/${taskId}/review-visible`)
        .set('authorization', `Bearer ${support.token}`)
        .send(body())
        .expect(200);
    }
    const events = await prisma.taskEvent.findMany({ where: { taskId } });
    const visibleEvents = events.filter((e) =>
      (e.idempotencyKey ?? '').startsWith('staff-visible:'),
    );
    expect(visibleEvents).toHaveLength(1);
  });

  // ── the record ────────────────────────────────────────────────────────────

  it('writes an audit row naming the page, the day, the reason and the old value', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(200);
    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body({ visible: false, reason: 'wrong listing — my mistake' }))
      .expect(200);

    const rows = await prisma.adminAuditLog.findMany({
      where: { action: 'TASK_REVIEW_VISIBLE' },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    const first = rows[0].metadata as Record<string, unknown>;
    expect(first.taskId).toBe(taskId);
    expect(first.visible).toBe(true);
    expect(first.productUrl).toBe(PRODUCT_URL);
    expect(typeof first.seenAt).toBe('string');
    expect(String(first.reason)).toMatch(/second from top/);
    // A first confirmation has nothing before it, and says so rather than
    // implying a value.
    expect(first.previousVisible).toBeNull();

    // The correction reads as a correction: it carries what it replaced.
    const second = rows[1].metadata as Record<string, unknown>;
    expect(second.visible).toBe(false);
    expect(second.previousVisible).toBe(true);
    expect(second.previousSource).toBe('staff-confirmed-visible');
    expect(rows[1].staffUserId).toBe(support.id);
  });

  // ── the queue ─────────────────────────────────────────────────────────────

  it('lists the task for a reviewer, with the page to open and why no machine can', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    const res = await request(server())
      .get('/admin/tasks/awaiting-review-check')
      .set('authorization', `Bearer ${support.token}`)
      .expect(200);
    expect(res.body.total).toBe(1);
    const item = res.body.items[0];
    expect(item.taskId).toBe(taskId);
    expect(item.platform).toBe('MEESHO');
    expect(item.rating).toBe(5);
    expect(item.productUrl).toBe(PRODUCT_URL);
    expect(item.confirmedVisible).toBe(false);
    // Plain words, never an enum — a reviewer reads these out to users.
    expect(item.whyNoMachineCheck).toMatch(/[a-z]{4,}/);
    expect(item.whyNoMachineCheck).not.toMatch(/published|permalink|null/);
  });

  it('does NOT list a task a machine can check itself', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    await amazonTaskMachineChecked(user.token, false);
    const support = await tokenFor('SUPPORT');

    const res = await request(server())
      .get('/admin/tasks/awaiting-review-check')
      .set('authorization', `Bearer ${support.token}`)
      .expect(200);
    expect(res.body.total).toBe(0);
  });

  it('keeps a just-decided task listed, so a mistake can be undone', async () => {
    // The same reasoning as the amount card: the reviewer who confirmed it is the
    // one who realises a second later that it was the wrong listing.
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(200);

    const res = await request(server())
      .get('/admin/tasks/awaiting-review-check')
      .set('authorization', `Bearer ${support.token}`)
      .expect(200);
    const item = res.body.items.find(
      (i: { taskId: string }) => i.taskId === taskId,
    );
    expect(item).toBeDefined();
    expect(item.confirmedVisible).toBe(true);
    expect(item.confirmedUrl).toBe(PRODUCT_URL);
  });

  it('drops a task once a machine takes over the verdict', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');
    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(200);

    // A later device read that DID see the public review supersedes the person.
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        review: {
          reviewId: 'SUB-1',
          rating: 5,
          published: true,
          publishedSource: 'review-public',
        },
      })
      .expect(200);

    const res = await request(server())
      .get('/admin/tasks/awaiting-review-check')
      .set('authorization', `Bearer ${support.token}`)
      .expect(200);
    expect(
      res.body.items.some((i: { taskId: string }) => i.taskId === taskId),
    ).toBe(false);
  });

  // ── who may press it ──────────────────────────────────────────────────────

  it('is SUPPORT and ADMIN only', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);

    for (const role of ['SUPPORT', 'ADMIN'] as StaffRole[]) {
      const staff = await tokenFor(role);
      await request(server())
        .post(`/admin/tasks/${taskId}/review-visible`)
        .set('authorization', `Bearer ${staff.token}`)
        .send(body({ reason: `${role} looked at the page` }))
        .expect(200);
      // Put it back so the next role starts from the same place.
      await request(server())
        .post(`/admin/tasks/${taskId}/review-visible`)
        .set('authorization', `Bearer ${staff.token}`)
        .send(body({ visible: false, reason: 'resetting for the next check' }))
        .expect(200);
    }
    for (const role of ['FINANCE', 'OPERATIONS'] as StaffRole[]) {
      const staff = await tokenFor(role);
      await request(server())
        .post(`/admin/tasks/${taskId}/review-visible`)
        .set('authorization', `Bearer ${staff.token}`)
        .send(body())
        .expect(403);
      await request(server())
        .get('/admin/tasks/awaiting-review-check')
        .set('authorization', `Bearer ${staff.token}`)
        .expect(403);
    }
    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .send(body())
      .expect(401);
  });

  it('will not accept a confirmation with nothing on it', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    const bad = [
      { visible: true, reason: 'no url at all' },
      { visible: true, productUrl: 'not-a-url', reason: 'junk url' },
      { visible: true, productUrl: 'javascript:alert(1)', reason: 'not a page' },
      { visible: true, productUrl: PRODUCT_URL }, // no reason — an empty record
      { visible: true, productUrl: PRODUCT_URL, reason: 'x' }, // too short
      { productUrl: PRODUCT_URL, reason: 'no verdict either way' },
      // A future date cannot be when somebody looked at something.
      {
        visible: true,
        productUrl: PRODUCT_URL,
        reason: 'tomorrow',
        seenAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      },
    ];
    for (const b of bad) {
      const res = await request(server())
        .post(`/admin/tasks/${taskId}/review-visible`)
        .set('authorization', `Bearer ${support.token}`)
        .send(b);
      expect([400, 422]).toContain(res.status);
    }
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.reviewPublished).toBe(false);
  });

  // ── it moves no money ─────────────────────────────────────────────────────

  it('pays nothing by itself — the window and the release still stand between', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    // Delivered TODAY, so the return window is nowhere near elapsed.
    const { taskId } = await meeshoTaskWithStarOnly(user.token);
    const support = await tokenFor('SUPPORT');

    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(200);
    await request(server())
      .post(`/tasks/${taskId}/reviewed`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    await request(server())
      .post(`/tasks/${taskId}/start-hold`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    const refused = await request(server())
      .post(`/tasks/${taskId}/release-refund`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(refused.status).toBeGreaterThanOrEqual(400);

    const entries = await prisma.walletEntry.count();
    expect(entries).toBe(0);
  });

  it('does not by itself rescue a Meesho task with no delivery date', async () => {
    // Honest scope. Meesho publishes no delivery date either, and the return
    // window is anchored to one — so confirming the review is necessary and NOT
    // sufficient. Pinned so nobody reads this action as "Meesho now works".
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await meeshoTaskWithStarOnly(user.token, {
      delivery: false,
    });
    const support = await tokenFor('SUPPORT');

    await request(server())
      .post(`/admin/tasks/${taskId}/review-visible`)
      .set('authorization', `Bearer ${support.token}`)
      .send(body())
      .expect(200);

    const after = await request(server())
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(after.body.review.published).toBe(true);
    expect(after.body.state).toBe('PURCHASED'); // never reached DELIVERED
    expect(after.body.refund.reasons.join(' ')).toMatch(/delivery date/i);
  });
});
