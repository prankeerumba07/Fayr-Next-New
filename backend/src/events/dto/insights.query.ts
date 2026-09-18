import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS } from '../events.constants';

/** How many days back the dashboard is looking. */
export class InsightsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WINDOW_DAYS)
  days: number = DEFAULT_WINDOW_DAYS;
}
