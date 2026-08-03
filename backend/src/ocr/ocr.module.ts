import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import type { Env } from '../config/env.validation';
import { StorageModule } from '../storage/storage.module';
import { TaskModule } from '../tasks/task.module';
import { EvidenceMatchService } from './evidence-match.service';
import { ANTHROPIC_CLIENT } from './ocr.constants';
import { ScreenshotController } from './screenshot.controller';
import { ScreenshotVerificationService } from './screenshot.service';
import { StaffVerificationController } from './staff-verification.controller';
import { StaffVerificationService } from './staff-verification.service';
import { VisionExtractionService } from './vision-extraction.service';

/**
 * Screenshot OCR (tier-3 supporting evidence). Provides the Anthropic client as a
 * NULLABLE dependency — constructed only when ANTHROPIC_API_KEY is set, otherwise
 * null so the extraction service degrades to "skipped" and manual review still
 * works.
 *
 * Owns two surfaces: the USER upload endpoint (O.5, guarded by AuthModule's
 * JwtAuthGuard, storing into StorageModule's private space) and the STAFF review
 * back office (O.6). AdminModule supplies the staff guards + audit service, and
 * TaskModule the evidence funnel (applyEvidence) that approve routes through.
 */
@Module({
  imports: [AuthModule, StorageModule, AdminModule, TaskModule],
  controllers: [ScreenshotController, StaffVerificationController],
  providers: [
    {
      provide: ANTHROPIC_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Anthropic | null => {
        const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
        return apiKey ? new Anthropic({ apiKey }) : null;
      },
    },
    VisionExtractionService,
    EvidenceMatchService,
    ScreenshotVerificationService,
    StaffVerificationService,
  ],
  exports: [VisionExtractionService, EvidenceMatchService],
})
export class OcrModule {}
