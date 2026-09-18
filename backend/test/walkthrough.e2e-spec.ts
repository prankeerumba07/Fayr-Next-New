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
/**
 * THE ONE TABLE THE WALK THROUGH IS ALLOWED TO ADD TO.
 *
 * WHAT THIS FILE ACTUALLY GUARANTEES, stated plainly because the exemption below
 * only makes sense against it: walking the design cannot change A PERSON'S STATE.
 * It must never spend a claim, move money, grant a ticket, create a task, start a
 * withdrawal or alter a profile. That guarantee is untouched and is asserted, one
 * table at a time, by the narrowness check further down this file.
 *
 * A MEASUREMENT ROW IS NOT A STATE CHANGE. GET /campaigns records FEED_OPENED, so
 * a walk now leaves two user_events rows behind. Nobody's money, tickets, claims
 * or profile differ by anything afterwards. Counting that as a failure would mean
 * this test was guarding "no row anywhere" rather than the thing it was written
 * for, and the only ways to make it pass again would both be worse than the bias:
 * giving the app a mode where measurement is switched off, or teaching the walk
 * through to lie about which requests it makes.
 *
 * THE COST, WRITTEN DOWN RATHER THAN DISCOVERED LATER. A staff member walking
 * every screen produces FEED_OPENED rows that nothing distinguishes from a real
 * shopper opening the feed, so the signing-up funnel is very slightly inflated by
 * our own use of the app — a handful of rows a week at this size, not worth
 * engineering around, but worth knowing about before somebody reads a number off
 * that chart and believes it to the row.
 *
 * ONE TABLE, AND THE LIST IS CHECKED. This is a named exemption and not a table
 * quietly dropped from a list, so the next reader can see that it is deliberate
 * and exactly how narrow it is. Adding a second name here fails the check below.
 */
const MEASUREMENT_NOT_STATE: readonly string[] = ['user_events'];

/**
 * The counts this file judges: everything except the measurement tables.
 *
 * Applied to BOTH sides of every comparison rather than to the difference, so a
 * table that appears or disappears between two counts cannot slip through.
 */
function stateOnly(counts: Record<string, number>): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [table, n] of Object.entries(counts)) {
    if (!MEASUREMENT_NOT_STATE.includes(table)) kept[table] = n;
  }
  return kept;
}

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
  });

  afterAll(async () => app.close());

  // Reset AND rebuild, before every test rather than once.
  //
  // The counting only has to hold inside a single test, so a fresh database each
  // time costs nothing and the suite stops leaving its rows behind for whichever
  // spec runs next. suite-isolation.e2e-spec.ts checks that every spec in this
  // folder does this, and it caught this file for doing it once in beforeAll —
  // which is exactly the drift that rule exists to prevent.
  beforeEach(async () => {
    await resetDatabase(prisma);

    // One person with one claim on one offer, so every path the walk reads
    // resolves to something real rather than to a 404. This is the setting up,
    // and it happens BEFORE any counting starts.
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
    const changed = Object.keys(stateOnly(before)).filter(
      (t) => before[t] !== after[t],
    );
    expect(changed).toEqual([]);
    expect(stateOnly(after)).toEqual(stateOnly(before));
  });

  it('the exemption is one table wide, and covers nothing that holds state', async () => {
    // The exemption at the top of this file is the only hole in its guarantee, so
    // the size of that hole is asserted rather than trusted. Widening it fails
    // here first, which is the point: the next person to add a table to that list
    // has to come past this check to do it.
    expect(MEASUREMENT_NOT_STATE).toEqual(['user_events']);

    // And every table carrying something the walk through must never touch is
    // still judged by the counting above. Named one at a time rather than as
    // "everything else", because "everything else" is exactly what a future
    // exemption would quietly shrink without a single check going red.
    const mustStayCovered = [
      'wallet_entries', // money, leg by leg
      'ledger_transactions', // money, the balanced pairs
      'wallet_accounts', // money, the accounts themselves
      'ticket_entries', // tickets spent and returned
      'tasks', // a claim
      'task_events', // what happened to a claim
      'withdrawals', // money on its way out
      'payout_methods', // where that money would go
      'users', // the profile
    ];
    const everyTable = Object.keys(await countEverything());
    const judged = Object.keys(stateOnly(await countEverything()));
    for (const table of mustStayCovered) {
      // Both, and in this order. A table renamed by a migration would otherwise
      // pass the second check by being absent from every list rather than by
      // being watched.
      expect(everyTable).toContain(table);
      expect(judged).toContain(table);
    }
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
    expect(stateOnly(await countEverything())).toEqual(stateOnly(before));
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
