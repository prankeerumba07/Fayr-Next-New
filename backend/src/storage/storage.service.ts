import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

/**
 * The public URL space uploaded files are served under. main.ts mounts the
 * upload directory here as static assets, and LocalDiskStorageService builds its
 * returned `url` from it — one constant so the two can never drift apart.
 */
export const UPLOADS_URL_PREFIX = '/uploads';

/** Image content types an operator may upload, mapped to the extension we save. */
export const IMAGE_EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Max accepted image size — enforced by the upload controller's ParseFilePipe. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Max accepted verification-screenshot size — screenshots run larger than logos. */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB

/** What a successful save returns: the stored key and its public URL path. */
export interface StoredFile {
  /** Storage-relative key (e.g. "campaigns/<uuid>.jpg") — for a future delete. */
  key: string;
  /** Root-relative public URL (e.g. "/uploads/campaigns/<uuid>.jpg"). */
  url: string;
}

/**
 * What a PRIVATE save returns. Deliberately carries NO url — private files (e.g.
 * verification screenshots, which are user PII) are never publicly served; they
 * are read back only through an RBAC-checked streaming endpoint by their `key`.
 * The sha256 supports dedup + forgery forensics (the same image reused across
 * users/tasks is a fraud signal, and it outlives the image after retention purge).
 */
export interface StoredPrivateFile {
  key: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Where uploaded binaries live. An abstract class (not just an interface) so it
 * doubles as the DI token: swapping local disk for S3/R2 is a one-line provider
 * change in StorageModule, with every controller untouched. The image validation
 * (type, size) is the caller's job; this layer only persists bytes.
 */
export abstract class StorageService {
  abstract save(input: {
    buffer: Buffer;
    mimetype: string;
    /** Sub-folder to group by purpose, e.g. "campaigns". */
    subdir: string;
  }): Promise<StoredFile>;

  /**
   * Persist a PRIVATE binary (never publicly served). Returns the key + sha256 +
   * size; the caller streams it back later via {@link readPrivate} after an
   * authorization check. Kept a distinct method (not `save`) so a private file
   * can never accidentally get a public URL.
   */
  abstract savePrivate(input: {
    buffer: Buffer;
    mimetype: string;
    subdir: string;
  }): Promise<StoredPrivateFile>;

  /** Read a private file's bytes by its key. Throws if the key is missing/unsafe. */
  abstract readPrivate(key: string): Promise<Buffer>;

  /** Delete a private file by key (retention purge). A missing file is a no-op. */
  abstract deletePrivate(key: string): Promise<void>;
}

/**
 * Local-disk implementation for dev. Writes each file under
 * `<UPLOAD_DIR>/<subdir>/<uuid>.<ext>` with a random name (never the client's
 * filename — that avoids collisions and path-traversal via the original name),
 * and returns a `/uploads/...` URL that main.ts serves statically.
 */
@Injectable()
export class LocalDiskStorageService extends StorageService {
  private readonly root: string;
  private readonly privateRoot: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    // Resolve once at construction, against cwd — matches how main.ts mounts it.
    this.root = resolve(
      process.cwd(),
      config.get('UPLOAD_DIR', { infer: true }),
    );
    // A SEPARATE root, deliberately outside the static-served UPLOAD_DIR, so a
    // private file can never be reached by a public /uploads URL.
    this.privateRoot = resolve(
      process.cwd(),
      config.get('PRIVATE_UPLOAD_DIR', { infer: true }),
    );
  }

  async save(input: {
    buffer: Buffer;
    mimetype: string;
    subdir: string;
  }): Promise<StoredFile> {
    const ext = IMAGE_EXT_BY_MIME[input.mimetype] ?? 'bin';
    const filename = `${randomUUID()}.${ext}`;
    const dir = join(this.root, input.subdir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), input.buffer);
    const key = `${input.subdir}/${filename}`;
    return { key, url: `${UPLOADS_URL_PREFIX}/${key}` };
  }

  async savePrivate(input: {
    buffer: Buffer;
    mimetype: string;
    subdir: string;
  }): Promise<StoredPrivateFile> {
    const ext = IMAGE_EXT_BY_MIME[input.mimetype] ?? 'bin';
    const filename = `${randomUUID()}.${ext}`;
    const dir = join(this.privateRoot, sanitizeSubdir(input.subdir));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), input.buffer);
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    return {
      key: `${sanitizeSubdir(input.subdir)}/${filename}`,
      sha256,
      sizeBytes: input.buffer.length,
    };
  }

  async readPrivate(key: string): Promise<Buffer> {
    return readFile(this.privatePath(key));
  }

  async deletePrivate(key: string): Promise<void> {
    try {
      await unlink(this.privatePath(key));
    } catch (err) {
      // Retention purge is idempotent: an already-gone file is not an error.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  /**
   * Resolve a storage key to an absolute path INSIDE privateRoot, refusing any
   * key that would escape it (path traversal). Keys we mint never contain `..`,
   * but this guards against a tampered/foreign key reaching the filesystem.
   */
  private privatePath(key: string): string {
    const full = resolve(this.privateRoot, key);
    if (full !== this.privateRoot && !full.startsWith(this.privateRoot + '/')) {
      throw new Error('Unsafe storage key');
    }
    return full;
  }
}

/** Keep a subdir to a simple, single-segment slug — no separators, no traversal. */
function sanitizeSubdir(subdir: string): string {
  return subdir.replace(/[^a-zA-Z0-9_-]/g, '');
}
