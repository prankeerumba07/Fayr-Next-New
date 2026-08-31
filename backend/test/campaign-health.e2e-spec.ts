import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { CampaignHealthService } from '../src/campaign-health/campaign-health.service';
import { seedDemo } from '../prisma/demo-seed';
import { resetDatabase } from './reset-db';

/**
 * THE DAILY CHECK, AGAINST THE REAL CATALOGUE.
 *
 * The rules themselves are unit-tested at every boundary. What can only be proved
 * here is the part that reads the world: which offers it looks at, whether it can
 * actually tell a missing picture file from a present one, and whether the run it
 * records lets anyone say "this is new since last night".
 *
 * The findings it reports below are real. The seeded catalogue is the live one,
 * captured from the demo database — so a Meesho offer with no picture and two
 * Modrix offers sharing one are not fixtures anybody invented for a test. They are
 * what the check found on the first night it ran.
 */
describe('Campaign health check (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let health: CampaignHealthService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    health = app.get(CampaignHealthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedDemo(app, { quiet: true });
  });

  describe('what it looks at', () => {
    it('checks every live offer and nothing that is not live', async () => {
      const report = await health.run();
      const live = await prisma.campaign.count({ where: { status: 'ACTIVE' } });
      expect(report.checked).toBe(live);

      // An ended offer is not on anyone's feed, so a finding on it is noise that
      // can never be actioned.
      const ended = await prisma.campaign.findMany({
        where: { status: { not: 'ACTIVE' } },
        select: { id: true },
      });
      const reportedIds = report.offers.map((o) => o.campaignId);
      for (const e of ended) expect(reportedIds).not.toContain(e.id);
    });

    it('reports only offers that have something to say', async () => {
      const report = await health.run();
      for (const offer of report.offers) {
        expect(offer.findings.length).toBeGreaterThan(0);
        expect(offer.title).toBeTruthy();
      }
    });

    it('counts findings by severity, and the counts add up', async () => {
      const report = await health.run();
      const perOffer = report.offers.flatMap((o) => o.findings);
      const grouped = [...report.limits, ...report.patterns].reduce(
        (n, l) => n + l.offers.length,
        0,
      );
      expect(report.counts.blocking + report.counts.attention + report.counts.unchecked)
        .toBe(perOffer.length + grouped);
      expect(report.counts.blocking).toBe(
        perOffer.filter((f) => f.severity === 'blocking').length,
      );
      // Nothing an offer needs fixing for is hidden away in the limits section.
      expect(perOffer.every((f) => f.severity !== 'unchecked')).toBe(true);
    });

    it('says what it could not check ONCE, listing the offers it applies to', async () => {
      // THE THING THAT DECIDES WHETHER THIS GETS READ. Eleven of thirteen offers
      // have no product link, so the same "cannot be checked" note applied to
      // every one of them. Printed per offer that is twenty-odd identical lines
      // burying the one real problem — which is how a team learns to close the
      // tab. It is said once, with the list.
      const report = await health.run();
      const pictures = report.limits.find((l) => l.code === 'picture-not-verified');
      expect(pictures).toBeTruthy();
      expect(pictures!.offers.length).toBeGreaterThan(5);
      expect(pictures!.detail).toBeTruthy();
      // Each offer named once, so the list can be worked through.
      const ids = pictures!.offers.map((o) => o.campaignId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('what it actually found in the live catalogue', () => {
    it('finds the live offer that has no picture', async () => {
      const report = await health.run();
      const noPicture = report.offers.filter((o) =>
        o.findings.some((f) => f.code === 'picture-missing'),
      );
      expect(noPicture.length).toBeGreaterThanOrEqual(1);
      // Named, so whoever fixes it knows which offer to open.
      expect(noPicture.map((o) => o.title).join(' ')).toMatch(/Kurta/i);
    });

    it('finds the two live offers showing the same picture, and names each other', async () => {
      const report = await health.run();
      const shared = report.offers.filter((o) =>
        o.findings.some((f) => f.code === 'picture-shared'),
      );
      // Both sides of a shared picture are reported — whichever offer someone
      // opens first, the report tells them what the other one is.
      expect(shared.length).toBe(2);
      const [a, b] = shared;
      expect(a.findings.find((f) => f.code === 'picture-shared')!.detail).toContain(
        b.title,
      );
      expect(b.findings.find((f) => f.code === 'picture-shared')!.detail).toContain(
        a.title,
      );
    });

    it('can tell a picture file that is there from one that is not', async () => {
      // Point a live offer at a file that does not exist. Nothing else changes,
      // so this proves the check reads the disk rather than trusting the column.
      const before = await health.run();
      const target = await prisma.campaign.findFirstOrThrow({
        where: { status: 'ACTIVE', imageUrl: { not: null } },
      });
      expect(
        before.offers
          .find((o) => o.campaignId === target.id)
          ?.findings.some((f) => f.code === 'picture-file-missing') ?? false,
      ).toBe(false);

      await prisma.campaign.update({
        where: { id: target.id },
        data: { imageUrl: '/uploads/campaigns/definitely-not-here.png' },
      });

      const after = await health.run();
      const found = after.offers.find((o) => o.campaignId === target.id);
      expect(found!.findings.map((f) => f.code)).toContain('picture-file-missing');
      expect(found!.findings.find((f) => f.code === 'picture-file-missing')!.detail)
        .toContain('definitely-not-here.png');
    });

    it('reads what was really paid, so a stale price shows up', async () => {
      // The seeded journeys pay the listed price, so nothing is stale to begin
      // with. Move the listed price and the orders now disagree with it — using
      // the same comparison the refund gate uses, so the check can never
      // contradict a payout.
      const bag = await prisma.campaign.findFirstOrThrow({
        where: { title: { contains: 'Carry Your Laptop' } },
      });
      expect(
        (await health.run()).offers
          .find((o) => o.campaignId === bag.id)
          ?.findings.some((f) => f.code === 'price-disagrees-with-orders') ?? false,
      ).toBe(false);

      await prisma.campaign.update({
        where: { id: bag.id },
        data: { productPricePaise: 999900n },
      });

      const found = (await health.run()).offers.find((o) => o.campaignId === bag.id);
      expect(found!.findings.map((f) => f.code)).toContain(
        'price-disagrees-with-orders',
      );
    });

    it('never says a picture is right — only that it could not be checked', async () => {
      const report = await health.run();
      // Every offer without a product link is named, and named under a heading
      // that says it was NOT checked rather than that it passed. A pass here would
      // be believed, and would be wrong.
      const limit = report.limits.find((l) => l.code === 'picture-not-verified');
      expect(limit).toBeTruthy();
      expect(limit!.severity).toBe('unchecked');
      expect(limit!.detail).toMatch(/cannot|not been checked/i);
      // And it never appears as a per-offer defect, which would read as one.
      expect(
        report.offers.flatMap((o) => o.findings).map((f) => f.code),
      ).not.toContain('picture-not-verified');
    });
  });

    it('lifts a finding that is on most of the catalogue out of the per-offer list', async () => {
      // A FINDING ON TWELVE OF THIRTEEN OFFERS IS A POLICY QUESTION, NOT A TO-DO
      // LIST. Almost every live offer uses a category the return-window table
      // does not recognise, so it falls back to seven days. Printed once per offer
      // that is twelve lines saying the same thing, and the one offer with no
      // picture at all scrolls off the top.
      //
      // So anything on more than half the live offers is reported as a pattern,
      // with its count, and stops repeating per offer. Nothing is dropped; the
      // list is still there to work through.
      const report = await health.run();
      const pattern = report.patterns.find(
        (p) => p.code === 'return-window-is-the-default',
      );
      expect(pattern).toBeTruthy();
      expect(pattern!.offers.length * 2).toBeGreaterThan(report.checked);
      expect(
        report.offers.flatMap((o) => o.findings).map((f) => f.code),
      ).not.toContain('return-window-is-the-default');

      // The one genuinely exceptional offer is now at the top of a short list.
      expect(report.offers[0].findings[0].severity).toBe('blocking');
    });

    it('leaves a finding on a handful of offers where it belongs', async () => {
      // Two offers share a picture. That is two offers' problem, not the
      // catalogue's, and lifting it would hide it.
      const report = await health.run();
      expect(report.patterns.map((p) => p.code)).not.toContain('picture-shared');
      expect(
        report.offers.flatMap((o) => o.findings).map((f) => f.code),
      ).toContain('picture-shared');
    });

    it('writes every grouped heading for a list, not for one offer', async () => {
      // The guard that keeps a future rule honest: the moment something groups,
      // its heading is read by someone looking at ten offers. "This offer has no
      // category" over a group of ten is simply wrong, and one offer's own price
      // in the heading is worse.
      const report = await health.run();
      const grouped = [...report.limits, ...report.patterns];
      expect(grouped.length).toBeGreaterThan(0);
      for (const g of grouped) {
        expect(g.title).not.toMatch(/this offer/i);
        expect(g.detail).not.toMatch(/this offer/i);
        expect(g.offers.length).toBeGreaterThan(0);
      }
    });

  describe('the daily part', () => {
    it('records a run, with its own counts and the trigger that started it', async () => {
      const report = await health.run();
      await health.record('SCHEDULED', report);

      const run = await health.latestRun();
      expect(run).not.toBeNull();
      expect(run!.trigger).toBe('SCHEDULED');
      expect(run!.checked).toBe(report.checked);
      expect(run!.blocking).toBe(report.counts.blocking);
      expect(Array.isArray(run!.findings)).toBe(true);
    });

    it('says what is new since the last run, and nothing when nothing changed', async () => {
      const first = await health.run();
      await health.record('SCHEDULED', first);
      expect(health.newSince(first, await health.latestRun())).toEqual([]);

      // Break one live offer the way an operator would: clear its terms.
      const target = await prisma.campaign.findFirstOrThrow({
        where: { status: 'ACTIVE', terms: { not: null } },
      });
      await prisma.campaign.update({
        where: { id: target.id },
        data: { terms: null },
      });

      const second = await health.run();
      const fresh = health.newSince(second, await health.latestRun());
      expect(fresh).toContainEqual(
        expect.objectContaining({ campaignId: target.id, code: 'terms-missing' }),
      );
    });

    it('has no previous run to compare against on the first night, and says so plainly', async () => {
      const report = await health.run();
      // Everything is "new" only if there is something to be new against. With no
      // previous run the honest answer is an empty list, not the whole report
      // dressed up as news.
      expect(health.newSince(report, null)).toEqual([]);
    });

    it('keeps the runs so it can be proved it ran', async () => {
      await health.record('SCHEDULED', await health.run());
      await health.record('MANUAL', await health.run());
      const runs = await prisma.campaignCheckRun.findMany({
        orderBy: { ranAt: 'desc' },
      });
      expect(runs.length).toBe(2);
      expect((await health.latestRun())!.trigger).toBe('MANUAL');
    });
  });
});
