import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { LocalDiskStorageService } from './storage.service';

/**
 * Unit test for the local-disk storage — in particular the PRIVATE path used for
 * verification screenshots: a round-trip save/read, a correct sha256 + size, an
 * idempotent delete, and refusal of a traversal key. Uses a throwaway temp dir.
 */
describe('LocalDiskStorageService (private files)', () => {
  let base: string;
  let svc: LocalDiskStorageService;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'fayr-storage-'));
    const publicDir = join(base, 'public');
    const privateDir = join(base, 'private');
    const config = {
      get: (key: string) =>
        key === 'PRIVATE_UPLOAD_DIR' ? privateDir : publicDir,
    } as unknown as ConfigService<Env, true>;
    svc = new LocalDiskStorageService(config);
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const png = Buffer.from('a fake screenshot payload', 'utf8');

  it('saves a private file with sha256 + size and NO public url', async () => {
    const stored = await svc.savePrivate({
      buffer: png,
      mimetype: 'image/png',
      subdir: 'screenshots',
    });
    expect(stored).not.toHaveProperty('url');
    expect(stored.key).toMatch(/^screenshots\/[0-9a-f-]+\.png$/);
    expect(stored.sizeBytes).toBe(png.length);
    expect(stored.sha256).toBe(createHash('sha256').update(png).digest('hex'));
  });

  it('reads the bytes back by key, then deletes idempotently', async () => {
    const stored = await svc.savePrivate({
      buffer: png,
      mimetype: 'image/jpeg',
      subdir: 'screenshots',
    });
    const back = await svc.readPrivate(stored.key);
    expect(back.equals(png)).toBe(true);

    await svc.deletePrivate(stored.key);
    await expect(svc.readPrivate(stored.key)).rejects.toThrow();
    // Deleting an already-gone file is a no-op, not an error.
    await expect(svc.deletePrivate(stored.key)).resolves.toBeUndefined();
  });

  it('writes private files OUTSIDE the public upload dir', async () => {
    const stored = await svc.savePrivate({
      buffer: png,
      mimetype: 'image/png',
      subdir: 'screenshots',
    });
    expect(existsSync(join(base, 'private', stored.key))).toBe(true);
    expect(existsSync(join(base, 'public', stored.key))).toBe(false);
  });

  it('refuses a path-traversal key', async () => {
    await expect(svc.readPrivate('../../etc/passwd')).rejects.toThrow(
      /unsafe storage key/i,
    );
  });

  it('still returns a public URL for the non-private save()', async () => {
    const stored = await svc.save({
      buffer: png,
      mimetype: 'image/png',
      subdir: 'campaigns',
    });
    expect(stored.url).toMatch(/^\/uploads\/campaigns\//);
  });
});
