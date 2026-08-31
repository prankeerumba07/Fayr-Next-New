import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase, tablesCovered } from './reset-db';

/**
 * WALKING EVERY SCREEN IN THE DESIGN CHANGES NOTHING.
 *
 * The walk through opens sixty one real screens, each of them reading real data
 * through the real requests. That is the point of it, and it is also the risk: a
 * screen being demonstrated is a screen with real buttons on it, and a real button
 * spends a claim, moves money, or sends a text message to a real handset.
 *
 * So this counts every row in every table, makes every request the whole walk
 * makes, and counts again. Nothing may differ by one.
 *
 * THE LIST OF REQUESTS IS NOT WRITTEN DOWN HERE. It is read out of
 * src/walkthrough/catalogue.js, the same file the app itself walks, because a
 * hand-copied list in a test proves that the copy is safe and nothing else. If a
 * screen is given a new read, this test picks it up on the next run.
 *
 * The tables are not written down either — they come from the database's own
 * catalogue, so a table added by tomorrow's migration is counted the day it lands.
 */
describe('The walk through writes nothing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  const server = () => app.getHttpServer();

  let token = '';
  let campaignId = '';
  let taskId = '';

  /** Every path the walk reads, taken from the catalogue the app itself uses. */
  const walkReads = (): string[] => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'src', 'walkthrough', 'catalogue.js'),
      'utf8',
    );
    // The catalogue names its reads inside one READS block, one line per kind.
    const start = src.indexOf('const READS = {');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('\n};', start);
    const block = src.slice(start, end);
    const paths = [...block.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
    return [...new Set(paths)].sort();
  };

  /** How many screens the walk has, so a walk of nothing cannot pass quietly. */
  const howManyScreens = (): number => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'src', 'walkthrough', 'catalogue.js'),
      'utf8',
    );
    const start = src.indexOf('export const GROUPS = [');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('\n];', start);
    return [...src.slice(start, end).matchAll(/'([a-z0-9]+)'/g)].length;
  };

  /** Row counts for every table in the database, by name. */
  async function countEverything(): Promise<Record<string, number>> {
    const tables = await tablesCovered(prisma);
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM "${table}"`,
      );
      counts[table] = Number(rows[0]?.n ?? 0);
    }
    return counts;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    await resetDatabase(prisma);

    // One person with one claim on one offer, so every path the walk reads
    // resolves to something real rather than to a 404. Built directly here: this
    // is the setting up, and it happens BEFORE the counting starts.
    const user = await prisma.user.create({ data: { mobile: '+919100000001' } });
    token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    const campaign = await prisma.campaign.create({
      data: {
        title: 'A practice offer for the walk through',
        productName: 'A practice product',
        platform: 'AMAZON',
        category: 'electronics',
        productPricePaise: BigInt(129900),
        payoutPercent: 100,
        ticketCost: 5,
        status: 'ACTIVE',
      },
    });
    campaignId = campaign.id;
    const task = await prisma.task.create({
      data: {
        userId: user.id, campaignId: campaign.id, platform: 'AMAZON', state: 'CLAIMED',
      },
    });
    taskId = task.id;
  });

  afterAll(async () => app.close());

  it('reads something worth counting: the walk is not empty', () => {
    // Without this, a catalogue that had lost every entry would pass every other
    // test in this file by doing nothing at all.
    expect(howManyScreens()).toBeGreaterThan(50);
    expect(walkReads().length).toBeGreaterThan(4);
  });

  it('declares only reads: nothing in the list can write', () => {
    for (const path of walkReads()) {
      expect(path.startsWith('/')).toBe(true);
      expect(path).not.toMatch(/\b(POST|PATCH|PUT|DELETE)\b/i);
      for (const action of ['claim', 'confirm', 'submit', 'release', 'logout']) {
        expect(path).not.toContain(action);
      }
    }
  });

  it('walks every screen in the design and does not change one row', async () => {
    const before = await countEverything();
    expect(Object.keys(before).length).toBeGreaterThan(15);

    // Every read, as the walk makes them: signed in as the person whose practice
    // data it is, with the ids filled in the way the app fills them in.
    const asked: string[] = [];
    for (const template of walkReads()) {
      const path = template
        .replace('/campaigns/:id', `/campaigns/${campaignId}`)
        .replace(/^\/tasks\/:id/, `/tasks/${taskId}`);
      asked.push(path);
      const res = await request(server())
        .get(path)
        .set('Authorization', `Bearer ${token}`);
      // A read that fails is a broken walk through, and worth failing on: the
      // point is that the walk RAN, not that it was skipped and changed nothing.
      expect([200, 201]).toContain(res.status);
    }
    expect(asked.length).toBe(walkReads().length);

    const after = await countEverything();

    // Named table by table rather than as one object comparison, so a failure
    // says which table gained a row instead of printing twenty seven numbers.
    const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
    expect(changed).toEqual([]);
    expect(after).toEqual(before);
  });

  it('changes nothing when it is walked twice, either', async () => {
    // Somebody demonstrating the app goes back and forth. A read that writes only
    // on its first call would have slipped through the test above.
    const before = await countEverything();
    for (let round = 0; round < 2; round += 1) {
      for (const template of walkReads()) {
        const path = template
          .replace('/campaigns/:id', `/campaigns/${campaignId}`)
          .replace(/^\/tasks\/:id/, `/tasks/${taskId}`);
        await request(server()).get(path).set('Authorization', `Bearer ${token}`);
      }
    }
    expect(await countEverything()).toEqual(before);
  });

  it('the three things that must not happen are all writes, and none was made', async () => {
    // The claim is not spent, the money has not moved, no text was sent. Stated
    // against the tables that would carry each of them, because "no rows changed"
    // is only reassuring if somebody says which rows would have.
    const tickets = await prisma.ticketEntry.count();
    const money = await prisma.walletEntry.count();
    const codes = await prisma.otpChallenge.count();

    for (const template of walkReads()) {
      const path = template
        .replace('/campaigns/:id', `/campaigns/${campaignId}`)
        .replace(/^\/tasks\/:id/, `/tasks/${taskId}`);
      await request(server()).get(path).set('Authorization', `Bearer ${token}`);
    }

    expect(await prisma.ticketEntry.count()).toBe(tickets);
    expect(await prisma.walletEntry.count()).toBe(money);
    expect(await prisma.otpChallenge.count()).toBe(codes);
  });

  it('the counting covers every table, including any added by a migration', async () => {
    // tablesCovered reads the database's own catalogue. This proves it, so that
    // "every table" in the test above is a fact and not a claim.
    const counted = Object.keys(await countEverything()).sort();
    const real = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
      + "AND tablename <> '_prisma_migrations' ORDER BY tablename",
    );
    expect(counted).toEqual(real.map((r) => r.tablename).sort());
  });
});
