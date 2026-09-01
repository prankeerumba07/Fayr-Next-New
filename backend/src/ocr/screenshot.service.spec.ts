import { ConflictException, NotFoundException } from '@nestjs/common';
import { ScreenshotVerificationService } from './screenshot.service';

/**
 * Unit test for the upload orchestration — every collaborator (prisma, storage,
 * vision, matcher) mocked, no DB or network. Proves ownership/closed/cap guards,
 * that a genuine upload is always stored + filed as a pending case, and that
 * extraction is a best-effort side effect: it runs only when OCR is enabled AND
 * under the daily cap, and a vision failure still leaves the case pending (never
 * throws, never advances the task).
 */

const CAMPAIGN = {
  productName: 'boAt Airdopes 141',
  productPricePaise: 129900n,
  minRating: null,
};

function makeTask(over: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    userId: 'user-1',
    closedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    campaign: CAMPAIGN,
    ...over,
  };
}

function build(opts: {
  task?: unknown;
  liveCount?: number;
  usedToday?: number;
  enabled?: boolean;
  dailyCap?: number;
  extract?: jest.Mock;
}) {
  const prisma = {
    task: { findUnique: jest.fn().mockResolvedValue(opts.task ?? makeTask()) },
    screenshotUpload: {
      count: jest.fn().mockResolvedValue(opts.liveCount ?? 0),
      create: jest.fn().mockResolvedValue({
        uploadedAt: new Date('2026-07-02T10:00:00Z'),
        submission: { id: 'sub-1', status: 'UPLOADED' },
      }),
    },
    evidenceSubmission: {
      count: jest.fn().mockResolvedValue(opts.usedToday ?? 0),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const storage = {
    savePrivate: jest.fn().mockResolvedValue({
      key: 'screenshots/abc.png',
      sha256: 'deadbeef',
      sizeBytes: 2048,
    }),
  };
  const vision = {
    enabled: opts.enabled ?? true,
    dailyCap: opts.dailyCap ?? 500,
    extract:
      opts.extract ??
      jest.fn().mockResolvedValue({
        status: 'extracted',
        model: 'claude-haiku-4-5',
        fields: {
          productName: 'boAt Airdopes 141',
          amount: 1299,
          confidence: 90,
        },
        tokensIn: 2000,
        tokensOut: 300,
        costMicroUsd: 3500,
        escalated: false,
      }),
  };
  const matcher = {
    match: jest
      .fn()
      .mockReturnValue({ fields: [], verdict: 'MATCH', confidence: 90 }),
  };
  const svc = new ScreenshotVerificationService(
    prisma as never,
    storage as never,
    vision as never,
    matcher as never,
  );
  return { svc, prisma, storage, vision, matcher };
}

const FILE = {
  originalname: 'proof.png',
  mimetype: 'image/png',
  size: 2048,
  buffer: Buffer.from('img'),
};

describe('ScreenshotVerificationService', () => {
  it("404s when the task isn't the caller's (no existence leak)", async () => {
    const { svc } = build({ task: makeTask({ userId: 'someone-else' }) });
    await expect(
      svc.uploadForUser('user-1', 'task-1', 'PURCHASE', FILE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409s on a closed task', async () => {
    const { svc } = build({ task: makeTask({ closedAt: new Date() }) });
    await expect(
      svc.uploadForUser('user-1', 'task-1', 'PURCHASE', FILE),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s once the per-task screenshot cap is reached', async () => {
    const { svc, storage } = build({ liveCount: 12 });
    await expect(
      svc.uploadForUser('user-1', 'task-1', 'PURCHASE', FILE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.savePrivate).not.toHaveBeenCalled();
  });

  it('stores privately, files a pending case, and runs extraction + matching', async () => {
    const { svc, storage, prisma, vision, matcher } = build({});
    const res = await svc.uploadForUser('user-1', 'task-1', 'PURCHASE', FILE);

    expect(storage.savePrivate).toHaveBeenCalledWith(
      expect.objectContaining({ subdir: 'screenshots', mimetype: 'image/png' }),
    );
    expect(prisma.screenshotUpload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: 'task-1',
          userId: 'user-1',
          kind: 'PURCHASE',
          storageKey: 'screenshots/abc.png',
          sha256: 'deadbeef',
        }),
      }),
    );
    expect(vision.extract).toHaveBeenCalledTimes(1);
    expect(matcher.match).toHaveBeenCalledTimes(1);
    expect(prisma.evidenceSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          status: 'EXTRACTED',
          verdict: 'MATCH',
          confidence: 90,
          costMicroUsd: 3500,
        }),
      }),
    );
    // The USER response is minimal — pending only, no verdict/confidence leaked.
    //
    // `details` is null here on purpose and it is worth saying why. This is the
    // answer to the UPLOAD itself, and the read of the image happens after it: at
    // this moment nothing has been read, so there is nothing to compare. The rows
    // arrive on the next list, which is what the app asks for straight afterwards.
    // Null rather than an empty list, because "not read yet" and "read and found
    // nothing" are different and the app says different words for them.
    expect(res).toEqual({
      id: 'sub-1',
      taskId: 'task-1',
      kind: 'PURCHASE',
      status: 'pending_review',
      reviewReason: null,
      reviewedAt: null,
      uploadedAt: '2026-07-02T10:00:00.000Z',
      details: null,
    });
    expect(res).not.toHaveProperty('verdict');
    expect(res).not.toHaveProperty('confidence');
  });

  it('skips extraction (still stores) when OCR is not configured', async () => {
    const { svc, storage, prisma, vision } = build({ enabled: false });
    const res = await svc.uploadForUser('user-1', 'task-1', 'DELIVERY', FILE);
    expect(storage.savePrivate).toHaveBeenCalledTimes(1);
    expect(vision.extract).not.toHaveBeenCalled();
    expect(prisma.evidenceSubmission.update).not.toHaveBeenCalled();
    expect(res.status).toBe('pending_review');
  });

  it('skips extraction when the daily cap is reached', async () => {
    const { svc, vision } = build({ usedToday: 500, dailyCap: 500 });
    await svc.uploadForUser('user-1', 'task-1', 'PURCHASE', FILE);
    expect(vision.extract).not.toHaveBeenCalled();
  });

  it('records FAILED (never throws) when extraction fails', async () => {
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'failed', reason: 'boom' });
    const { svc, prisma } = build({ extract });
    const res = await svc.uploadForUser('user-1', 'task-1', 'PURCHASE', FILE);
    expect(prisma.evidenceSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', error: 'boom' }),
      }),
    );
    expect(res.status).toBe('pending_review'); // still awaiting a human
  });
});
