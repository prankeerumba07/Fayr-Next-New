import { IsIn } from 'class-validator';
import type { ScreenshotKind } from '../evidence-match.service';

/** The three proof stages a screenshot can attest to (mirrors ScreenshotKind). */
export const SCREENSHOT_KINDS: readonly ScreenshotKind[] = [
  'PURCHASE',
  'DELIVERY',
  'REVIEW',
];

/**
 * The non-file part of a screenshot upload. The image itself arrives as the
 * multipart `file`; `kind` says which stage of the flow it proves, which drives
 * both the extraction prompt context and which fields gate the match verdict.
 */
export class UploadScreenshotDto {
  @IsIn(SCREENSHOT_KINDS)
  kind!: ScreenshotKind;
}
