import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

/**
 * End-to-end for the read-only campaign endpoints: boots the real app (so the
 * JwtAuthGuard and global ValidationPipe are live) and drives it over HTTP. A
 * valid access token is minted directly from JwtService — the guard verifies any
 * correctly-signed token, and the OTP flow is already covered by the auth e2e.
 */
describe('Campaigns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  const tokenForNewUser = async (): Promise<string> => {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    return jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
  };

  const makeCampaign = (
    over: Partial<Prisma.CampaignCreateInput> = {},
  ): Prisma.CampaignCreateInput => ({
    platform: 'AMAZON',
    status: 'ACTIVE',
    title: 'Review a product',
    productName: 'A product',
    category: 'electronics',
    productPricePaise: 129900n,
    payoutPercent: 100,
    ticketCost: 5,
    ...over,
  });

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

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(
        `Campaign e2e aborted: connected to non-test database "${db}"`,
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe('auth', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/campaigns').expect(401);
    });

    it('rejects a garbage bearer token', async () => {
      await request(app.getHttpServer())
        .get('/campaigns')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });
  });

  describe('GET /campaigns', () => {
    it('lists only ACTIVE campaigns, newest first, with money as strings', async () => {
      const token = await tokenForNewUser();
      await prisma.campaign.create({
        data: makeCampaign({
          title: 'Older active',
          productPricePaise: 59900n,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      });
      await prisma.campaign.create({
        data: makeCampaign({
          title: 'Newer active',
          productPricePaise: 129900n,
          payoutCapPaise: 60000n,
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
        }),
      });
      await prisma.campaign.create({
        data: makeCampaign({ title: 'Paused', status: 'PAUSED' }),
      });

      const res = await request(app.getHttpServer())
        .get('/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(2); // the paused one is excluded
      expect(res.body.map((c: { title: string }) => c.title)).toEqual([
        'Newer active',
        'Older active',
      ]);
      // Money is a decimal string, not a number.
      expect(res.body[0].productPricePaise).toBe('129900');
      expect(res.body[0].payoutCapPaise).toBe('60000');
      expect(typeof res.body[0].productPricePaise).toBe('string');
    });

    it('filters by platform', async () => {
      const token = await tokenForNewUser();
      await prisma.campaign.create({ data: makeCampaign() });

      await request(app.getHttpServer())
        .get('/campaigns?platform=AMAZON')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => expect(res.body).toHaveLength(1));

      await request(app.getHttpServer())
        .get('/campaigns?platform=FLIPKART')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => expect(res.body).toHaveLength(0));
    });

    it('rejects an unknown platform value', async () => {
      const token = await tokenForNewUser();
      await request(app.getHttpServer())
        .get('/campaigns?platform=NOPE')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('GET /campaigns/:id', () => {
    it('returns a campaign by id', async () => {
      const token = await tokenForNewUser();
      const created = await prisma.campaign.create({
        data: makeCampaign({ title: 'By id', productPricePaise: 74900n }),
      });

      const res = await request(app.getHttpServer())
        .get(`/campaigns/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.id).toBe(created.id);
      expect(res.body.title).toBe('By id');
      expect(res.body.productPricePaise).toBe('74900');
    });

    it('returns a PAUSED campaign by id (not status-filtered)', async () => {
      const token = await tokenForNewUser();
      const paused = await prisma.campaign.create({
        data: makeCampaign({ status: 'PAUSED' }),
      });

      await request(app.getHttpServer())
        .get(`/campaigns/${paused.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => expect(res.body.status).toBe('PAUSED'));
    });

    it('404s for a well-formed id that does not exist', async () => {
      const token = await tokenForNewUser();
      await request(app.getHttpServer())
        .get('/campaigns/00000000-0000-4000-8000-0000000000ff')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('400s for a malformed id', async () => {
      const token = await tokenForNewUser();
      await request(app.getHttpServer())
        .get('/campaigns/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });
});
