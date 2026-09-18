import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

/**
 * WHICH SCREENS PEOPLE REACH, AND WHAT CANNOT GET IN WITH THEM.
 *
 * POST /events has no sign-in on it, because the half of the funnel it measures
 * happens before anybody has an account. That makes it the one route in Fayr a
 * stranger can write to, so what it REFUSES matters more than what it stores.
 *
 * These run through the real server, the real ValidationPipe and the real
 * database, because every guard here is a decorator and a decorator that is not
 * exercised end to end is a decorator that might not be wired up at all.
 */
describe('Screen events (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  const post = (body: Record<string, unknown>) =>
    request(server()).post('/events').send(body);

  const screenRows = () =>
    prisma.userEvent.findMany({ where: { type: 'SCREEN_VIEWED' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (!rows[0]?.current_database?.endsWith('_test')) {
      throw new Error('Screen events e2e aborted: non-test database');
    }
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe('what it records', () => {
    it('writes the screen down, and nothing else with it', async () => {
      await post({ type: 'SCREEN_VIEWED', screen: 'Wallet' }).expect(204);

      const rows = await screenRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('SCREEN_VIEWED');
      // The whole payload, asserted as a whole rather than field by field. A
      // toMatchObject here would pass while quietly storing something else.
      expect(rows[0].payload).toEqual({ screen: 'Wallet' });
      expect(rows[0].userId).toBeNull();
      expect(rows[0].anonymousId).toBeNull();
    });

    it('keeps the anonymous id alongside it, which is the only link to a person', () => {
      const anon = '7b1f2c90-3d4e-4a5b-8c6d-9e0f1a2b3c4d';
      return post({ type: 'SCREEN_VIEWED', screen: 'Journey', anonymousId: anon })
        .expect(204)
        .then(async () => {
          const rows = await screenRows();
          expect(rows[0].anonymousId).toBe(anon);
          expect(rows[0].payload).toEqual({ screen: 'Journey' });
        });
    });

    it('accepts a marketplace connect screen, which is registered from PLATFORM_LIST', async () => {
      // These routes have no literal name in App.js, so they are the ones most
      // likely to be left out of the allow-list by somebody reading it quickly.
      await post({ type: 'SCREEN_VIEWED', screen: 'amazon' }).expect(204);
      const rows = await screenRows();
      expect(rows[0].payload).toEqual({ screen: 'amazon' });
    });

    it('leaves the payload empty rather than writing {} when no screen came', async () => {
      // Null means "this step carried nothing". An empty object would be a third
      // state that every reader of this table would then have to know about.
      await post({ type: 'APP_OPENED' }).expect(204);
      const row = await prisma.userEvent.findFirstOrThrow({
        where: { type: 'APP_OPENED' },
      });
      expect(row.payload).toBeNull();
    });
  });

  describe('what it refuses', () => {
    it('refuses a screen name the app does not have', async () => {
      await post({ type: 'SCREEN_VIEWED', screen: 'Dashboard' }).expect(400);
      expect(await screenRows()).toHaveLength(0);
    });

    it('refuses a mobile number in the screen field', async () => {
      // The rule the allow-list exists for, proved rather than described. Both
      // shapes people actually type, and neither needs a rule about phone numbers
      // — they are refused because they are not screens.
      await post({ type: 'SCREEN_VIEWED', screen: '+919812345678' }).expect(400);
      await post({ type: 'SCREEN_VIEWED', screen: '9812345678' }).expect(400);
      expect(await screenRows()).toHaveLength(0);
    });

    it('refuses an order id and a route with an id on the end of it', async () => {
      await post({ type: 'SCREEN_VIEWED', screen: '408-5614193-1514764' }).expect(400);
      await post({
        type: 'SCREEN_VIEWED',
        screen: 'Task/9f1c2f70-1f6b-4a4e-9f0e-2b6c7a3d5e11',
      }).expect(400);
      expect(await screenRows()).toHaveLength(0);
    });

    it('refuses a screen name that is only nearly right', async () => {
      await post({ type: 'SCREEN_VIEWED', screen: 'home' }).expect(400);
      await post({ type: 'SCREEN_VIEWED', screen: 'Home ' }).expect(400);
      expect(await screenRows()).toHaveLength(0);
    });

    it('still refuses a step the app is not allowed to report, screen or no screen', async () => {
      // Adding SCREEN_VIEWED to the short list must not have opened the route to
      // the rest of the vocabulary. ACCOUNT_CREATED through here would mean the
      // signup count could be inflated from a laptop.
      await post({ type: 'ACCOUNT_CREATED', screen: 'Home' }).expect(400);
      await post({ type: 'FIRST_CLAIM', screen: 'Home' }).expect(400);
      expect(await prisma.userEvent.count()).toBe(0);
    });

    it('refuses a field nobody declared, so a new one cannot arrive unnoticed', async () => {
      await post({ type: 'SCREEN_VIEWED', screen: 'Home', mobile: '+919812345678' })
        .expect(400);
      expect(await screenRows()).toHaveLength(0);
    });
  });
});
