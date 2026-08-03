// Route private screenshot writes to a throwaway dir (cleaned in afterAll), set
// BEFORE the app boots and ConfigModule reads the environment.
process.env.PRIVATE_UPLOAD_DIR = './private-uploads-test';
process.env.UPLOAD_DIR = './uploads-test';

import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma, StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

// A 1×1 transparent PNG — a real, valid image for the upload path.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * End-to-end for screenshot OCR verification — the WHOLE path over HTTP + DB, not
 * a re-statement of the mocked O.6 service test. OCR extraction is intentionally
 * OFF here (no ANTHROPIC_API_KEY), so a fresh upload lands as UPLOADED and staff
 * approve off the raw image — which is exactly the graceful, key-free path.
 *
 * It proves two money-relevant behaviours:
 *  1. upload → staff approve → the task's evidence + STATE actually change
 *     (CLAIMED → PURCHASED, order sourced `ocr`, the staff-confirmed price lands);
 *  2. a lower-tier OCR delivery approved with a LATER timestamp cannot override an
 *     earlier, higher-tier (order-details) delivery date — the earlier date wins,
 *     verified through the real endpoints + the DB (not just transition()).
 */
describe('OCR verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffTokens: StaffTokenService;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;
  const bearer = (t: string): string => `Bearer ${t}`;
  const newMobile = (): string =>
    `+9194${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function newUser(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
    return { id: user.id, token };
  }

  async function staffToken(role: StaffRole): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `${role.toLowerCase()}${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name: `Test ${role}`,
        role,
      },
    });
    return (await staffTokens.issueSession(staff)).accessToken;
  }

  const makeCampaign = (
    over: Partial<Prisma.CampaignCreateInput> = {},
  ): Promise<Campaign> =>
    prisma.campaign.create({
      data: {
        platform: 'AMAZON',
        status: 'ACTIVE',
        title: 'Review the boAt Airdopes 141',
        productName: 'boAt Airdopes 141',
        category: 'electronics', // 10-day window
        productPricePaise: 129900n,
        payoutPercent: 100,
        ticketCost: 5,
        minRating: 4,
        ...over,
      },
    });

  /** A CLAIMED task owned by `userId`, claimed at a fixed past date. */
  const makeTask = (
    userId: string,
    campaignId: string,
  ): Promise<{ id: string }> =>
    prisma.task.create({
      data: {
        userId,
        campaignId,
        platform: 'AMAZON',
        state: 'CLAIMED',
        category: 'electronics',
        createdAt: new Date('2026-06-01T00:00:00Z'),
      },
      select: { id: true },
    });

  const server = () => app.getHttpServer();

  async function uploadScreenshot(
    userToken: string,
    taskId: string,
    kind: string,
  ): Promise<string> {
    const res = await request(server())
      .post(`/tasks/${taskId}/screenshot`)
      .set('Authorization', bearer(userToken))
      .field('kind', kind)
      .attach('file', PNG_1PX, {
        filename: 'proof.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(res.body.status).toBe('pending_review');
    expect(res.body).not.toHaveProperty('verdict'); // never leaked to the user
    return res.body.id as string; // EvidenceSubmission id
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    staffTokens = app.get(StaffTokenService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(
        `OCR e2e aborted: connected to non-test database "${db}"`,
      );
    }
  });

  afterAll(async () => {
    await app.close();
    await rm(resolve(process.cwd(), 'private-uploads-test'), {
      recursive: true,
      force: true,
    });
    await rm(resolve(process.cwd(), 'uploads-test'), {
      recursive: true,
      force: true,
    });
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "users","campaigns","tasks","task_events","visibility_checks","screenshot_uploads","evidence_submissions","admin_audit_log","staff_users" RESTART IDENTITY CASCADE',
    );
  });

  it('upload → staff approve advances the task (CLAIMED → PURCHASED, order sourced ocr)', async () => {
    const { id: userId, token } = await newUser();
    const support = await staffToken('SUPPORT');
    const campaign = await makeCampaign();
    const { id: taskId } = await makeTask(userId, campaign.id);

    const submissionId = await uploadScreenshot(token, taskId, 'PURCHASE');

    // It shows up in the staff queue (real HTTP), pending a human.
    const queue = await request(server())
      .get('/admin/verifications')
      .set('Authorization', bearer(support))
      .expect(200);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(
      submissionId,
    );

    // Approve with a staff-confirmed item price (OCR read nothing here).
    await request(server())
      .post(`/admin/verifications/${submissionId}/approve`)
      .set('Authorization', bearer(support))
      .send({ reason: 'Order page checked', itemPaise: '129900' })
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('APPROVED'));

    // THE PROOF: GET /tasks/:id shows the task actually changed.
    await request(server())
      .get(`/tasks/${taskId}`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => {
        expect(r.body.state).toBe('PURCHASED'); // was CLAIMED
        expect(r.body.order).not.toBeNull();
        expect(r.body.order.source).toBe('ocr'); // lowest-tier source
        expect(r.body.order.itemPaise).toBe('129900'); // staff-confirmed figure
      });

    // And the durable records: submission APPROVED + an audited review decision.
    const sub = await prisma.evidenceSubmission.findUniqueOrThrow({
      where: { id: submissionId },
    });
    expect(sub.status).toBe('APPROVED');
    expect(
      await prisma.adminAuditLog.count({
        where: { action: 'EVIDENCE_REVIEW' },
      }),
    ).toBe(1);
  });

  it('a lower-tier OCR delivery approved LATER cannot override an earlier order-details delivery date', async () => {
    const { id: userId, token } = await newUser();
    const support = await staffToken('SUPPORT');
    const campaign = await makeCampaign();
    const { id: taskId } = await makeTask(userId, campaign.id);

    // Seed an EARLIER delivery from the higher-tier scraper source, over HTTP.
    const earlier = Date.UTC(2026, 6, 5); // 5 Jul 2026
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: { id: 'o1', itemPaise: '129900', source: 'order-details' },
        delivery: { at: earlier, source: 'order-details' },
        returned: false,
      })
      .expect(200)
      .expect((r) => {
        expect(r.body.state).toBe('DELIVERED');
        expect(r.body.delivery.at).toBe(new Date(earlier).toISOString());
        expect(r.body.delivery.source).toBe('order-details');
      });

    // Upload + approve an OCR DELIVERY screenshot — its fragment is timestamped at
    // upload time (NOW, far later than `earlier`).
    const submissionId = await uploadScreenshot(token, taskId, 'DELIVERY');
    await request(server())
      .post(`/admin/verifications/${submissionId}/approve`)
      .set('Authorization', bearer(support))
      .send({ reason: 'Looks delivered' })
      .expect(200);

    // THE PROOF (HTTP): the earlier, higher-tier delivery date still wins.
    await request(server())
      .get(`/tasks/${taskId}`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => {
        expect(r.body.delivery.at).toBe(new Date(earlier).toISOString());
        expect(r.body.delivery.source).toBe('order-details'); // NOT ocr
        expect(r.body.state).toBe('DELIVERED');
      });

    // THE PROOF (DB): the promoted deliveredAt column is unchanged, and the nested
    // evidence still reads order-details — the OCR upload-time date never leaked in.
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.deliveredAt?.getTime()).toBe(earlier);
    const evidence = task.evidence as {
      delivery?: { at?: number; source?: string };
    };
    expect(evidence.delivery?.at).toBe(earlier);
    expect(evidence.delivery?.source).toBe('order-details');

    // The approval was still recorded + audited (it just didn't move the date).
    const sub = await prisma.evidenceSubmission.findUniqueOrThrow({
      where: { id: submissionId },
    });
    expect(sub.status).toBe('APPROVED');
  });
});
