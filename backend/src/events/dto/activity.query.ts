import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_ACTIVITY_LIMIT,
  DEFAULT_WINDOW_DAYS,
  MAX_ACTIVITY_LIMIT,
  MAX_WINDOW_DAYS,
} from '../events.constants';

/**
 * How far back one person's trail is read, and how much of it comes back.
 *
 * REFUSED, NOT CLAMPED. Both bounds are @Min/@Max, so days=9999 is a 400 and not
 * a quiet 365. A caller that asked for a year of history and silently received a
 * month would draw a chart with a hole in it and no way to know — the same
 * reasoning the insights query already follows, kept identical on purpose.
 */
export class ActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WINDOW_DAYS)
  days: number = DEFAULT_WINDOW_DAYS;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ACTIVITY_LIMIT)
  limit: number = DEFAULT_ACTIVITY_LIMIT;
}
