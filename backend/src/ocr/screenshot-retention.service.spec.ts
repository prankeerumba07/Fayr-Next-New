import {
  PURGE_BATCH_LIMIT,
  ScreenshotRetentionService,
} from './screenshot-retention.service';

/**
 * THE HASH AND THE CASE MUST OUTLIVE THE BYTES.
 *
 * A verification screenshot is private PII and there was no retention period at
 * all: every image ever uploaded was kept forever, and the purge function was
 * written and called from nowhere. This is the purge, and the invariant it must
 * not break is the one the whole design rests on — the image goes, the sha256 and
 * the case row stay, so "this exact picture has been submitted before" is still
 * answerable after the picture is gone.
 *
 * Prisma and the storage layer are mocked; the e2e drives the real disk.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-08-25T12:00:00Z');

/** `days` before NOW, as a Date. */
const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY);

function makePrisma() {
  return {
    screenshotUpload: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

function makeStorage() {
  return { deletePrivate: jest.fn().mockResolvedValue(undefined) };
}

function build(retentionDays = 90) {
  const prisma = makePrisma();
  const storage = makeStorage();
  const config = { get: jest.fn().mockReturnValue(retentionDays) };
  const service = new ScreenshotRetentionService(
    prisma as never,
    storage as never,
    config as never,
  );
  return { service, prisma, storage, config };
}

/** One expired upload row, shaped like the real select. */
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'shot-1',
  storageKey: 'screenshots/abc.png',
  sizeBytes: 1_024,
  uploadedAt: ago(200),
  ...over,
});

describe('ScreenshotRetentionService', () => {
  it('asks only for images whose bytes are still there and are past the period', async () => {
    const { service, prisma } = build(90);
    await service.purgeExpired(NOW);

    const where = prisma.screenshotUpload.findMany.mock.calls[0][0].where;
    // deletedAt: null — an already-purged row must never be purged twice, and its
    // hash must never be re-examined as though the image were still held.
    expect(where.deletedAt).toBeNull();
    expect(where.uploadedAt.lt).toEqual(ago(90));
  });

  it('deletes the bytes, then stamps the row — and touches nothing else', async () => {
    const { service, prisma, storage } = build();
    prisma.screenshotUpload.findMany.mockResolvedValue([row()]);

    const report = await service.purgeExpired(NOW);

    expect(storage.deletePrivate).toHaveBeenCalledWith('screenshots/abc.png');
    expect(prisma.screenshotUpload.update).toHaveBeenCalledWith({
      where: { id: 'shot-1' },
      // deletedAt ONLY. Not the sha256, not the storageKey, not the size: the row
      // is the record that this image existed and what it was, and that record is
      // what survives.
      data: { deletedAt: NOW },
    });
    expect(report.purged).toBe(1);
    expect(report.bytesFreed).toBe(1_024);
  });

  it('reads the period from config, not from a constant in the code', async () => {
    const { service, prisma } = build(30);
    await service.purgeExpired(NOW);
    expect(prisma.screenshotUpload.findMany.mock.calls[0][0].where.uploadedAt.lt)
      .toEqual(ago(30));
  });

  it('leaves a file it could not delete UNSTAMPED, so the next tick retries it', async () => {
    // Bytes first, then the stamp, deliberately. If the unlink fails the row still
    // says "held", which is TRUE — the file is still on disk. Stamping first would
    // mark it purged and leave the PII sitting there with nothing ever looking at
    // it again.
    const { service, prisma, storage } = build();
    prisma.screenshotUpload.findMany.mockResolvedValue([
      row({ id: 'bad', storageKey: 'screenshots/bad.png' }),
      row({ id: 'good', storageKey: 'screenshots/good.png', sizeBytes: 2_048 }),
    ]);
    storage.deletePrivate.mockImplementation((key: string) =>
      key.includes('bad')
        ? Promise.reject(new Error('EPERM'))
        : Promise.resolve(),
    );

    const report = await service.purgeExpired(NOW);

    expect(report.failed).toBe(1);
    expect(report.purged).toBe(1); // one bad file does not stop the rest
    expect(report.bytesFreed).toBe(2_048); // and does not count as freed
    const stamped = prisma.screenshotUpload.update.mock.calls.map(
      (c: [{ where: { id: string } }]) => c[0].where.id,
    );
    expect(stamped).toEqual(['good']);
  });

  it('reports the oldest image it purged, so the period is visible in the log', async () => {
    const { service, prisma } = build();
    prisma.screenshotUpload.findMany.mockResolvedValue([
      row({ id: 'a', uploadedAt: ago(120) }),
      row({ id: 'b', uploadedAt: ago(400) }),
      row({ id: 'c', uploadedAt: ago(91) }),
    ]);
    const report = await service.purgeExpired(NOW);
    expect(report.purged).toBe(3);
    expect(report.oldestPurgedAt).toBe(ago(400).toISOString());
  });

  it('does nothing, and says nothing was there, when nothing has expired', async () => {
    const { service, storage } = build();
    const report = await service.purgeExpired(NOW);
    expect(storage.deletePrivate).not.toHaveBeenCalled();
    expect(report).toEqual({
      purged: 0,
      bytesFreed: 0,
      failed: 0,
      remaining: 0,
      oldestPurgedAt: null,
    });
  });

  it('caps one tick and SAYS how many it left behind', async () => {
    // A silent cap reads as "everything is purged" when it is not. The count of
    // what is still expired goes in the report so the log can state it.
    const { service, prisma } = build();
    expect(prisma.screenshotUpload.findMany).not.toHaveBeenCalled();
    prisma.screenshotUpload.findMany.mockResolvedValue(
      Array.from({ length: PURGE_BATCH_LIMIT }, (_, i) =>
        row({ id: `s-${i}`, sizeBytes: 1 }),
      ),
    );
    prisma.screenshotUpload.count.mockResolvedValue(PURGE_BATCH_LIMIT + 7);

    const report = await service.purgeExpired(NOW);

    expect(prisma.screenshotUpload.findMany.mock.calls[0][0].take).toBe(
      PURGE_BATCH_LIMIT,
    );
    expect(report.purged).toBe(PURGE_BATCH_LIMIT);
    expect(report.remaining).toBe(7);
  });

  it('does not count a full batch as "more to do" when there is no more', async () => {
    const { service, prisma } = build();
    prisma.screenshotUpload.findMany.mockResolvedValue([row()]);
    prisma.screenshotUpload.count.mockResolvedValue(1);
    expect((await service.purgeExpired(NOW)).remaining).toBe(0);
  });
});
