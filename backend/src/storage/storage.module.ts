import { Module } from '@nestjs/common';
import { LocalDiskStorageService, StorageService } from './storage.service';

/**
 * Binary storage for operator uploads (campaign images now; verification
 * screenshots later). StorageService is the abstract token; the concrete
 * implementation is chosen here — LocalDiskStorageService for dev. To move to
 * S3/Cloudflare R2, swap `useClass` for an S3StorageService; nothing that injects
 * StorageService changes.
 */
@Module({
  providers: [{ provide: StorageService, useClass: LocalDiskStorageService }],
  exports: [StorageService],
})
export class StorageModule {}
