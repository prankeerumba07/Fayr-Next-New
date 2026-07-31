import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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

/** What a successful save returns: the stored key and its public URL path. */
export interface StoredFile {
  /** Storage-relative key (e.g. "campaigns/<uuid>.jpg") — for a future delete. */
  key: string;
  /** Root-relative public URL (e.g. "/uploads/campaigns/<uuid>.jpg"). */
  url: string;
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

  constructor(config: ConfigService<Env, true>) {
    super();
    // Resolve once at construction, against cwd — matches how main.ts mounts it.
    this.root = resolve(
      process.cwd(),
      config.get('UPLOAD_DIR', { infer: true }),
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
}
