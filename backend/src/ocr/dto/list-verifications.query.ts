import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** The states a staff reviewer can filter the queue by (all still pending a human). */
export const QUEUE_STATES = ['EXTRACTED', 'FAILED', 'UPLOADED'] as const;

/**
 * Filters + pagination for the verification queue. Default view is the pending
 * cases (EXTRACTED/FAILED/UPLOADED), oldest first, so the queue drains FIFO; the
 * client (panel) prioritises visually by verdict. `status` narrows to one state.
 */
export class ListVerificationsQueryDto {
  @IsOptional()
  @IsIn(QUEUE_STATES)
  status?: (typeof QUEUE_STATES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
