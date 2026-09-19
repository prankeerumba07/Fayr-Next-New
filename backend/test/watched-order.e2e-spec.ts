import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { TicketService } from '../src/tickets/ticket.service';
import { resetDatabase } from './reset-db';

/**
 * THE ORDER FAYR WATCHED BEING PLACED, RECORDED OVER REAL HTTP. Phase 8A, Task 2.
 *
 * MEASURED ON THE OWNER'S OWN ZEPTO PURCHASE, 18 SEPTEMBER 2026: one second
 * after he paid, the shop's page inside Fayr moved to
 * /order/status/01a0b4d7-870c-7dca-b701-e038477c5106. That uuid is the phone's
 * one handle on THAT order, and it travels to our side through the same
 * untrusted device-evidence route as everything else the phone reports.
 *
 * The pure rules are walked in engine/watched-order.spec.ts. What can only be
 * checked HERE is the row: that the key is written once, that a second one does
 * not move it, that a body which is only the key writes NO engine event and
 * wipes nothing, and that the key never lands in the column the refund gate
 * compares.
 *
 * NO MOBILE NUMBER IN THIS FILE IS A REAL ONE.
 */
describe('the order Fayr watched being placed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let tickets: TicketService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;
  const bearer = (t: string): string => `Bearer ${t}`;
  const server = () => app.getHttpServer();

  /** The key off the owner's own confirmation address, 18 September 2026. */
  const THE_KEY = '01a0b4d7-870c-7dca-b701-e038477c5106';
  const ANOTHER_KEY = '11111111-2222-7333-8444-555555555555';

  async function newUser(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
    return { id: user.id, token };
  }

  const makeCampaign = (
    over: Partial<Prisma.CampaignCreateInput> = {},
  ): Promise<Campaign> =>
    prisma.campaign.create({
      data: {
        platform: 'ZEPTO',
        status: 'ACTIVE',
        title: 'Review the Boldfit headband',
        productName: 'Boldfit Strapless Sports Headband',
        category: 'electronics',
        productPricePaise: 14900n,
        payoutPercent: 100,
        ticketCost: 5,
        ...over,
      },
    });

  async function claim(token: string, campaignId: string): Promise<string> {
    const res = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId, acceptedTerms: true })
      .expect(201);
    return res.body.id as string;
  }

  /** A user with tickets, a campaign and a claimed task. */
  async function ready() {
    const { id: userId, token } = await newUser();
    await tickets.grantSignup(userId);
    const campaign = await makeCampaign();
    const taskId = await claim(token, campaign.id);
    return { userId, token, campaign, taskId };
  }

  /** The body the phone sends: the key, and nothing the engine reads. */
  const keyOnly = (key: string) => ({ key: `watched-order:${key}`, watchedOrderKey: key });

  const tell = (token: string, taskId: string, body: Record<string, unknown>) =>
    request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    tickets = app.get(TicketService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Aborted: connected to non-test database "${db}"`);
    }
  });

  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDatabase(prisma); });

  it('WRITES THE KEY, HANDS THE TASK BACK, AND RUNS NO ENGINE EVENT FOR IT', async () => {
    const { token, taskId } = await ready();
    // The claim writes its own event row; what must not change is the count
    // and the evidence AFTER the key arrives.
    const eventsBefore = await prisma.taskEvent.count({ where: { taskId } });
    const before = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    const res = await tell(token, taskId, keyOnly(THE_KEY)).expect(200);

    expect(res.body.watchedOrderKey).toBe(THE_KEY);
    expect(res.body.state).toBe('CLAIMED');
    // A PLACE TO LOOK IS NOT EVIDENCE. No event row, no state, no blocker.
    expect(await prisma.taskEvent.count({ where: { taskId } })).toBe(eventsBefore);
    expect(await prisma.taskEvent.count({ where: { taskId, type: 'EVIDENCE' } })).toBe(0);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.watchedOrderKey).toBe(THE_KEY);
    expect(row.blocker).toBeNull();
    expect(row.state).toBe('CLAIMED');
    expect(row.evidence).toEqual(before.evidence);
  });

  it('THE SAME KEY TWICE IS ONE FACT', async () => {
    const { token, taskId } = await ready();
    await tell(token, taskId, keyOnly(THE_KEY)).expect(200);
    const eventsAfterFirst = await prisma.taskEvent.count({ where: { taskId } });
    const again = await tell(token, taskId, keyOnly(THE_KEY)).expect(200);
    expect(again.body.watchedOrderKey).toBe(THE_KEY);
    expect(await prisma.taskEvent.count({ where: { taskId } })).toBe(eventsAfterFirst);
    expect(await prisma.taskEvent.count({ where: { taskId, type: 'EVIDENCE' } })).toBe(0);
  });

  it('THE FIRST KEY STAYS: a second, different key is neither written nor refused', async () => {
    const { token, taskId } = await ready();
    await tell(token, taskId, keyOnly(THE_KEY)).expect(200);
    // NOT A 409. The phone's outbox parks any refusal and replays it on every
    // foreground, so refusing a fact that changes nothing would be a request
    // retried for ever.
    const second = await tell(token, taskId, keyOnly(ANOTHER_KEY)).expect(200);
    expect(second.body.watchedOrderKey).toBe(THE_KEY);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.watchedOrderKey).toBe(THE_KEY);
  });

  it('REFUSES A KEY THAT COULD STEER AN ADDRESS, at the door', async () => {
    const { token, taskId } = await ready();
    for (const bad of ['../account/orders', 'a/b', 'a?b=1', 'a b', 'x'.repeat(121)]) {
      await tell(token, taskId, keyOnly(bad)).expect(400);
    }
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.watchedOrderKey).toBeNull();
  });

  it('A KEY-ONLY BODY WIPES NO BLOCKER THE TASK ALREADY CARRIES', async () => {
    // THE REASON THE KEY IS NOT AN ENGINE EVENT. onEvidence patches blocker,
    // blockerReason and probe to null on every fragment that carries no
    // blocker of its own. A key run through it would have erased this.
    const { token, taskId } = await ready();
    await tell(token, taskId, {
      key: 'evidence:blocker:order_unreadable',
      blocker: 'order_unreadable',
      reason: 'Could not read the orders page.',
    }).expect(200);
    const before = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(before.blocker).toBe('order_unreadable');

    await tell(token, taskId, keyOnly(THE_KEY)).expect(200);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after.blocker).toBe('order_unreadable');
    expect(after.blockerReason).toBe('Could not read the orders page.');
    expect(after.watchedOrderKey).toBe(THE_KEY);
  });

  it('A BODY CARRYING THE KEY AND REAL EVIDENCE RECORDS BOTH, IN THEIR OWN COLUMNS', async () => {
    const { token, taskId } = await ready();
    const res = await tell(token, taskId, {
      key: 'evidence:SOSIJGGRL26770:o',
      watchedOrderKey: THE_KEY,
      order: {
        id: 'SOSIJGGRL26770', unitPricePaise: '14900', quantity: 1, source: 'order-history',
      },
      returned: false,
    }).expect(200);
    expect(res.body.state).toBe('PURCHASED');
    expect(res.body.watchedOrderKey).toBe(THE_KEY);
    expect(res.body.order.id).toBe('SOSIJGGRL26770');

    // TWO IDENTIFIERS, NEVER CONFUSED. The address key and the page's number
    // sit in two columns, and the one the duplicate-order gate compares holds
    // the number the page printed and never the uuid from the address.
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.orderId).toBe('SOSIJGGRL26770');
    expect(row.watchedOrderKey).toBe(THE_KEY);
    expect(row.orderId).not.toBe(row.watchedOrderKey);
    expect(await prisma.taskEvent.count({ where: { taskId, type: 'EVIDENCE' } })).toBe(1);
  });

  it('on somebody else’s task it reads as not there at all', async () => {
    const { taskId } = await ready();
    const stranger = await newUser();
    await tell(stranger.token, taskId, keyOnly(THE_KEY)).expect(404);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.watchedOrderKey).toBeNull();
  });

  it('the list a phone rebuilds itself from carries the key, so a reinstall keeps it', async () => {
    const { token, taskId } = await ready();
    await tell(token, taskId, keyOnly(THE_KEY)).expect(200);
    const list = await request(server())
      .get('/tasks')
      .set('Authorization', bearer(token))
      .expect(200);
    const mine = (list.body as { id: string; watchedOrderKey: string | null }[])
      .find((t) => t.id === taskId);
    expect(mine?.watchedOrderKey).toBe(THE_KEY);
  });

  it('THE COLUMN IS ADDITIVE AND NULLABLE, so no existing row was rewritten', () => {
    const whole = readFileSync(
      resolve(__dirname, '../prisma/migrations/20260919090000_watched_order_key/migration.sql'),
      'utf8',
    );
    // COMMENTS STRIPPED FIRST: the migration's own comment explains that it uses
    // no default and no not-null, and a check over the whole text would read
    // the explanation as the thing it forbids.
    const sql = whole.replace(/--.*$/gm, '');
    expect(sql).toContain('ADD COLUMN "watchedOrderKey"');
    expect(sql).not.toMatch(/NOT NULL/i);
    expect(sql).not.toMatch(/DEFAULT/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    // AND IT IS ITS OWN COLUMN, NOT A WRITE INTO orderId.
    expect(sql).not.toMatch(/"orderId"/);
  });
});
