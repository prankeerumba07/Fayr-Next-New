import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import { backdatePracticeCampaign } from '../scripts/backdate-practice-campaign';
import { PrismaService } from '../src/prisma/prisma.service';
import { PRACTICE_WINDOW_MAX_DAYS } from '../src/tasks/engine/practice-window';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { AppModule } from '../src/app.module';
import { resetDatabase } from './reset-db';

/**
 * MOVING A PRACTICE CAMPAIGN'S CREATION DATE BACK, AND TOUCHING NOTHING ELSE.
 *
 * WHY THE COMMAND EXISTS, STATED HONESTLY. It is NOT what makes an old order
 * match — engine/practice-window.ts does that now, on both halves of the floor,
 * and backdating never did it alone: orderWindow's floor is the LATER of (claim
 * less grace) and the campaign's creation, so moving the campaign while leaving
 * the claim where it is changes nothing at all with the practice window off.
 * All backdating buys on its own is the two hour grace: the campaign stops being
 * the later of the two bounds and the claim's own grace takes over. A months old
 * order is still refused. What it is for is the RECORD: a campaign made yesterday
 * carrying a refund for
 * an order from ten months earlier reads as a campaign that paid for a purchase
 * it could not have caused, and this makes the two dates make sense together.
 *
 * That is why the second check below exists, and it MEASURES the limit rather
 * than asserting it. Its first writing claimed backdating moved the window by
 * nothing and was wrong by exactly two hours.
 *
 * WHAT IT PROVES, in the order it matters:
 *
 *   1. it refuses any database that is not a practice one, and a name it could
 *      not read, before it writes anything;
 *   2. THE HONEST LIMIT, MEASURED: with the practice window off, backdating
 *      buys the two hour grace and not one day more, because the claim's own
 *      grace becomes the later bound — and a months old order is still refused;
 *   3. it moves createdAt back by exactly the days given, and prints both dates;
 *   4. it changes NOTHING else on that campaign;
 *   5. it touches no other campaign, and no task, ticket or money record;
 *   6. it refuses when more than one campaign matches, and names every one;
 *   7. it refuses nothing-matched, forward, zero, a fraction, junk, and above
 *      the ten year ceiling;
 *   8. partial and case-insensitive matching really works;
 *   9. it is relative, so running it twice moves twice — said out loud because
 *      that is the one thing about it that could surprise somebody.
 */
describe('Backdating a practice campaign (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tasks: TaskService;
  let tickets: TicketService;

  const DAY = 24 * 60 * 60 * 1000;

  let seq = 0;
  const newMobile = (): string =>
    `+9193${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

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
      throw new Error(`backdating e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ── 1. the refusal ─────────────────────────────────────────────────────────

  it('refuses a database that is not a practice one, and writes nothing', async () => {
    const campaign = await makeCampaign();

    await expect(
      backdatePracticeCampaign(app, 'boAt', 400, {
        quiet: true,
        databaseNameOverride: 'fayr_live',
      }),
    ).rejects.toThrow(/practice|development/i);

    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.createdAt.getTime()).toBe(campaign.createdAt.getTime());
  });

  it('FAILS CLOSED: a name it could not read is not a practice database', async () => {
    const campaign = await makeCampaign();

    await expect(
      backdatePracticeCampaign(app, 'boAt', 400, {
        quiet: true,
        databaseNameOverride: '',
      }),
    ).rejects.toThrow(/practice|development/i);

    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.createdAt.getTime()).toBe(campaign.createdAt.getTime());
  });

  it('accepts a practice database whether its name ends in dev or test', async () => {
    await makeCampaign({ title: 'Only one of these' });
    for (const name of ['fayr_next_dev', 'fayr_next_test']) {
      const report = await backdatePracticeCampaign(app, 'Only one', 1, {
        quiet: true,
        databaseNameOverride: name,
      });
      expect(report.databaseName).toBe(name);
    }
  });

  it('refuses the database BEFORE it complains about the days', async () => {
    // Order matters in a refusal. "That is not a practice database" is the more
    // important sentence, and a command that checked the arguments first would
    // hand back the wrong complaint on a real database.
    const said = await backdatePracticeCampaign(app, 'boAt', -5, {
      quiet: true,
      databaseNameOverride: 'fayr_live',
    }).then(
      () => 'it did not refuse',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    expect(said).toMatch(/not a practice or development database/i);
  });

  // ── 2. the honest limit ────────────────────────────────────────────────────

  it('THE HONEST LIMIT: on its own it buys the two hour grace and not one day more', async () => {
    // WHAT BACKDATING ACTUALLY DOES TO THE WINDOW, measured rather than claimed.
    // The first writing of this check asserted it moved the floor by NOTHING and
    // was wrong by exactly two hours, which is the whole point of measuring.
    //
    // orderWindow's floor is the LATER of (claim less grace) and the campaign's
    // creation. A campaign made moments before the claim is the later of the two,
    // so it IS the floor, and backdating it hands the job to the other bound —
    // the claim's own grace. So the floor moves from "when the campaign was made"
    // to "two hours before they tapped claim", and stops there.
    //
    // TWO HOURS. Not the four hundred days asked for. A months old order is
    // still refused, which is the thing that matters.
    //
    // The suite pins PRACTICE_ORDER_WINDOW_DAYS off (see global-setup.ts), so
    // this is the world a real deployment is always in.
    const { ORDER_WINDOW_GRACE_MS, checkOrderWindow, orderWindow } =
      await import('../src/tasks/engine/order-window');
    const campaign = await makeCampaign({ title: 'Prove the limit' });
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    await tickets.grantSignup(user.id);
    const claimed = await tasks.claim(user.id, campaign.id, { terms: true });
    // The claim RESPONSE carries dates as strings; the window is measured from
    // the row, which is what the service itself reads.
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: claimed.id },
    });
    const claimedAt = task.createdAt.getTime();

    const before = orderWindow({
      claimedAt,
      campaignCreatedAt: campaign.createdAt.getTime(),
      claimExpiresAt: null,
    });
    // The campaign was made moments ago, so IT is the floor to begin with.
    expect(before.floor).toBe(campaign.createdAt.getTime());

    await backdatePracticeCampaign(app, 'Prove the limit', 400, { quiet: true });

    const moved = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    const after = orderWindow({
      claimedAt,
      campaignCreatedAt: moved.createdAt.getTime(),
      claimExpiresAt: null,
    });

    // The campaign really did move four hundred days...
    expect(moved.createdAt.getTime()).toBe(
      campaign.createdAt.getTime() - 400 * DAY,
    );
    // ...and the floor moved to the claim's own grace and no further.
    expect(after.floor).toBe(claimedAt - ORDER_WINDOW_GRACE_MS);
    expect(before.floor - after.floor).toBeLessThanOrEqual(ORDER_WINDOW_GRACE_MS);

    // AND THE ORDER THE OWNER IS TESTING IS STILL REFUSED. This is why
    // backdating was never the answer on its own.
    const boughtMonthsAgo = claimedAt - 300 * DAY;
    expect(checkOrderWindow(boughtMonthsAgo, before)).toBe('before-claim');
    expect(checkOrderWindow(boughtMonthsAgo, after)).toBe('before-claim');
  });

  // ── 3. what it does ───────────────────────────────────────────────────────

  it('moves createdAt back by exactly the days given, and reports both dates', async () => {
    const campaign = await makeCampaign({ title: 'Move me back' });

    const report = await backdatePracticeCampaign(app, 'Move me back', 400, {
      quiet: true,
    });

    expect(report.title).toBe('Move me back');
    expect(report.campaignId).toBe(campaign.id);
    expect(report.days).toBe(400);
    expect(report.wasCreatedAt.getTime()).toBe(campaign.createdAt.getTime());
    expect(report.nowCreatedAt.getTime()).toBe(
      campaign.createdAt.getTime() - 400 * DAY,
    );

    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.createdAt.getTime()).toBe(
      campaign.createdAt.getTime() - 400 * DAY,
    );
  });

  it('moves exactly one day for one day, and no more', async () => {
    // The arithmetic on its own, because a units mistake here — hours for days,
    // or an off-by-one — would look plausible on a four hundred day move.
    const campaign = await makeCampaign({ title: 'Just one day' });
    const report = await backdatePracticeCampaign(app, 'Just one day', 1, {
      quiet: true,
    });
    expect(report.nowCreatedAt.getTime()).toBe(
      campaign.createdAt.getTime() - DAY,
    );
  });

  // ── 4. and nothing else ───────────────────────────────────────────────────

  it('changes NOTHING else on that campaign', async () => {
    const campaign = await makeCampaign({
      title: 'Leave the rest of me alone',
      terms: 'One review per person.',
      imageUrl: 'https://example.invalid/picture.jpg',
      totalSlots: 4,
      payoutCapPaise: 50000n,
      asin: 'B0TESTASIN',
    });

    await backdatePracticeCampaign(app, 'Leave the rest', 30, { quiet: true });

    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.title).toBe('Leave the rest of me alone');
    expect(after.productName).toBe('boAt Rockerz 255 Pro+');
    expect(after.terms).toBe('One review per person.');
    expect(after.imageUrl).toBe('https://example.invalid/picture.jpg');
    expect(after.totalSlots).toBe(4);
    expect(after.payoutCapPaise).toBe(50000n);
    expect(after.asin).toBe('B0TESTASIN');
    expect(after.productPricePaise).toBe(129900n);
    expect(after.payoutPercent).toBe(100);
    expect(after.ticketCost).toBe(5);
    expect(after.status).toBe('ACTIVE');
    expect(after.platform).toBe('AMAZON');
    expect(after.category).toBe('electronics');
  });

  it('touches no other campaign, and no task, ticket or money record', async () => {
    const mine = await makeCampaign({ title: 'The one I meant' });
    const other = await makeCampaign({ title: 'Somebody else entirely' });
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    await tickets.grantSignup(user.id);
    const claimed = await tasks.claim(user.id, mine.id, { terms: true });
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: claimed.id },
    });
    const ticketsBefore = await tickets.getBalance(user.id);
    const ledgerBefore = await prisma.ledgerTransaction.count();

    await backdatePracticeCampaign(app, 'The one I meant', 100, {
      quiet: true,
    });

    const otherAfter = await prisma.campaign.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(otherAfter.createdAt.getTime()).toBe(other.createdAt.getTime());

    // The task on the backdated campaign is untouched — its own claim moment is
    // what the window is measured from, and moving that would be moving a
    // person's deadline underneath them.
    const taskAfter = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(taskAfter.createdAt.getTime()).toBe(task.createdAt.getTime());
    expect(taskAfter.claimExpiresAt?.getTime()).toBe(
      task.claimExpiresAt?.getTime(),
    );
    expect(taskAfter.state).toBe('CLAIMED');
    expect(await tickets.getBalance(user.id)).toBe(ticketsBefore);
    expect(await prisma.ledgerTransaction.count()).toBe(ledgerBefore);
  });

  // ── 5. more than one match ────────────────────────────────────────────────

  it('refuses when more than one campaign matches, and names every one', async () => {
    const first = await makeCampaign({ title: 'boAt Rockerz 255' });
    const second = await makeCampaign({ title: 'boAt Rockerz 550' });

    const said = await backdatePracticeCampaign(app, 'boAt Rockerz', 400, {
      quiet: true,
    }).then(
      () => 'it did not refuse',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );

    expect(said).toMatch(/2 campaigns/);
    expect(said).toContain('boAt Rockerz 255');
    expect(said).toContain('boAt Rockerz 550');
    // AND NEITHER WAS MOVED. A refusal that has already changed one of them is
    // not a refusal.
    for (const c of [first, second]) {
      const after = await prisma.campaign.findUniqueOrThrow({
        where: { id: c.id },
      });
      expect(after.createdAt.getTime()).toBe(c.createdAt.getTime());
    }
  });

  it('and more of the title picks out the one that was meant', async () => {
    const first = await makeCampaign({ title: 'boAt Rockerz 255' });
    const second = await makeCampaign({ title: 'boAt Rockerz 550' });

    const report = await backdatePracticeCampaign(app, 'Rockerz 550', 7, {
      quiet: true,
    });
    expect(report.campaignId).toBe(second.id);

    const untouched = await prisma.campaign.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(untouched.createdAt.getTime()).toBe(first.createdAt.getTime());
  });

  it('refuses when nothing matches at all', async () => {
    await makeCampaign({ title: 'The only campaign here' });
    await expect(
      backdatePracticeCampaign(app, 'a kettle', 30, { quiet: true }),
    ).rejects.toThrow(/no campaign/i);
  });

  it('refuses an empty name rather than matching everything', async () => {
    // "contains an empty string" matches every row, so this is the one argument
    // that would silently turn "which campaign?" into "all of them".
    const campaign = await makeCampaign();
    for (const words of ['', '   ']) {
      await expect(
        backdatePracticeCampaign(app, words, 30, { quiet: true }),
      ).rejects.toThrow(/no campaign was named/i);
    }
    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.createdAt.getTime()).toBe(campaign.createdAt.getTime());
  });

  // ── 6. matching ───────────────────────────────────────────────────────────

  it('matches part of a title, and does not care about capitals', async () => {
    const campaign = await makeCampaign({ title: 'Review the boAt Rockerz' });
    for (const words of ['boat rockerz', 'BOAT', 'Review the', 'rockerz']) {
      const report = await backdatePracticeCampaign(app, words, 1, {
        quiet: true,
      });
      expect(report.campaignId).toBe(campaign.id);
    }
  });

  // ── 7. the number of days ─────────────────────────────────────────────────

  it('refuses a number of days that is not a positive whole number', async () => {
    const campaign = await makeCampaign({ title: 'Do not move me' });

    await expect(
      backdatePracticeCampaign(app, 'Do not move', 0, { quiet: true }),
    ).rejects.toThrow(/forward|nowhere/i);
    await expect(
      backdatePracticeCampaign(app, 'Do not move', -30, { quiet: true }),
    ).rejects.toThrow(/forward|nowhere/i);
    await expect(
      backdatePracticeCampaign(app, 'Do not move', 1.5, { quiet: true }),
    ).rejects.toThrow(/whole number/i);
    await expect(
      backdatePracticeCampaign(app, 'Do not move', NaN, { quiet: true }),
    ).rejects.toThrow(/not a number of days/i);
    await expect(
      backdatePracticeCampaign(app, 'Do not move', Infinity, { quiet: true }),
    ).rejects.toThrow(/not a number of days/i);

    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.createdAt.getTime()).toBe(campaign.createdAt.getTime());
  });

  it('refuses further back than the ten year ceiling', async () => {
    // The same ceiling the practice window uses, and refused rather than
    // clamped: this command PRINTS the date it produced, and a clamped answer
    // printed as an answer is worse than a no.
    const campaign = await makeCampaign({ title: 'Not to the last century' });

    await expect(
      backdatePracticeCampaign(app, 'last century', PRACTICE_WINDOW_MAX_DAYS + 1, {
        quiet: true,
      }),
    ).rejects.toThrow(/ceiling|ten year/i);

    const after = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(after.createdAt.getTime()).toBe(campaign.createdAt.getTime());

    // And the ceiling itself is allowed, so the refusal is above it and not at it.
    const report = await backdatePracticeCampaign(
      app,
      'last century',
      PRACTICE_WINDOW_MAX_DAYS,
      { quiet: true },
    );
    expect(report.days).toBe(PRACTICE_WINDOW_MAX_DAYS);
  });

  // ── 8. it is relative ────────────────────────────────────────────────────

  it('is RELATIVE, so running it twice moves it twice', async () => {
    // Said out loud, because it is the one thing about this that could surprise
    // somebody. It prints the old and new date every run, so there is no way to
    // do it twice without seeing it.
    const campaign = await makeCampaign({ title: 'Twice over' });

    const first = await backdatePracticeCampaign(app, 'Twice over', 100, {
      quiet: true,
    });
    const second = await backdatePracticeCampaign(app, 'Twice over', 100, {
      quiet: true,
    });

    expect(first.nowCreatedAt.getTime()).toBe(
      campaign.createdAt.getTime() - 100 * DAY,
    );
    expect(second.wasCreatedAt.getTime()).toBe(first.nowCreatedAt.getTime());
    expect(second.nowCreatedAt.getTime()).toBe(
      campaign.createdAt.getTime() - 200 * DAY,
    );
  });
});
