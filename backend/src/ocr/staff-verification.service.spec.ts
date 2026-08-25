import { ConflictException, NotFoundException } from '@nestjs/common';
import { StaffVerificationService } from './staff-verification.service';

/**
 * Unit test for the staff review gate — prisma/storage/audit/tasks all mocked.
 * Proves the money-relevant behaviours: approve funnels an `ocr` fragment through
 * TaskService.applyEvidence for the task OWNER and marks APPROVED; reject/
 * request-more never touch the task; an already-decided case can't be re-decided;
 * the image stream is audited and 404s once purged. No DB, no network.
 */

const STAFF = 'staff-1';

function submission(over: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    status: 'EXTRACTED',
    verdict: 'MATCH',
    confidence: 90,
    model: 'claude-haiku-4-5',
    tokensIn: 2000,
    tokensOut: 300,
    costMicroUsd: 3500,
    error: null,
    extraction: { productName: 'boAt', amount: 1299, confidence: 90 },
    match: [],
    reviewedByStaffId: null,
    reviewReason: null,
    reviewedAt: null,
    createdAt: new Date('2026-07-05T12:00:00Z'),
    screenshot: {
      id: 'shot-1',
      kind: 'PURCHASE',
      taskId: 'task-1',
      userId: 'owner-1',
      sha256: 'hashA',
      mimetype: 'image/png',
      sizeBytes: 2048,
      storageKey: 'screenshots/x.png',
      deletedAt: null,
      uploadedAt: new Date('2026-07-05T12:00:00Z'),
      task: {
        id: 'task-1',
        state: 'PURCHASED',
        userId: 'owner-1',
        campaign: {
          id: 'camp-1',
          title: 'boAt earbuds',
          productName: 'boAt Airdopes 141',
          productPricePaise: 129900n,
          minRating: null,
        },
      },
    },
    ...over,
  };
}

function build(sub: unknown = submission()) {
  const prisma = {
    evidenceSubmission: {
      findUnique: jest.fn().mockResolvedValue(sub),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'sub-1',
            status: data.status,
            reviewedAt: data.reviewedAt ?? null,
            reviewReason: data.reviewReason ?? null,
          }),
        ),
    },
  };
  const storage = {
    readPrivate: jest.fn().mockResolvedValue(Buffer.from('png')),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const tasks = { applyEvidence: jest.fn().mockResolvedValue({}) };
  const svc = new StaffVerificationService(
    prisma as never,
    storage as never,
    audit as never,
    tasks as never,
  );
  return { svc, prisma, storage, audit, tasks };
}

describe('StaffVerificationService', () => {
  it('approve funnels an ocr fragment for the task OWNER, then marks APPROVED + audits', async () => {
    const { svc, prisma, audit, tasks } = build();
    const res = await svc.approve(STAFF, 'sub-1', 'looks good');

    // Applied to the OWNER's task (not the staff id), via the shared funnel.
    expect(tasks.applyEvidence).toHaveBeenCalledTimes(1);
    const [ownerId, taskId, fragment] = tasks.applyEvidence.mock.calls[0];
    expect(ownerId).toBe('owner-1');
    expect(taskId).toBe('task-1');
    expect(fragment.order.source).toBe('ocr'); // lowest-tier source

    expect(prisma.evidenceSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          reviewedByStaffId: STAFF,
          reviewReason: 'looks good',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EVIDENCE_REVIEW',
        staffUserId: STAFF,
        targetUserId: 'owner-1',
        metadata: expect.objectContaining({ decision: 'approve' }),
      }),
    );
    expect(res.status).toBe('APPROVED');
  });

  it('reject closes the case WITHOUT touching the task', async () => {
    const { svc, tasks, prisma } = build();
    const res = await svc.reject(STAFF, 'sub-1', 'blurry');
    expect(tasks.applyEvidence).not.toHaveBeenCalled();
    expect(prisma.evidenceSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
    expect(res.status).toBe('REJECTED');
  });

  it('request-more sets NEEDS_MORE and never touches the task', async () => {
    const { svc, tasks } = build();
    const res = await svc.requestMore(STAFF, 'sub-1', 'send the order page');
    expect(tasks.applyEvidence).not.toHaveBeenCalled();
    expect(res.status).toBe('NEEDS_MORE');
  });

  it('refuses to re-decide an already-approved case (409)', async () => {
    const { svc, tasks } = build(submission({ status: 'APPROVED' }));
    await expect(svc.approve(STAFF, 'sub-1', undefined)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tasks.applyEvidence).not.toHaveBeenCalled();
  });

  it('404s an unknown case', async () => {
    const { svc } = build(null);
    await expect(svc.getOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('streams the image, auditing SCREENSHOT_VIEW', async () => {
    const { svc, storage, audit } = build();
    const out = await svc.streamImage(STAFF, 'sub-1');
    expect(storage.readPrivate).toHaveBeenCalledWith('screenshots/x.png');
    expect(out.mimetype).toBe('image/png');
    expect(out.filename).toBe('screenshot-sub-1.png');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SCREENSHOT_VIEW',
        targetUserId: 'owner-1',
      }),
    );
  });

  it('404s a purged (deleted) screenshot without reading bytes', async () => {
    const { svc, storage } = build(
      submission({
        screenshot: { ...submission().screenshot, deletedAt: new Date() },
      }),
    );
    await expect(svc.streamImage(STAFF, 'sub-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.readPrivate).not.toHaveBeenCalled();
  });
});
