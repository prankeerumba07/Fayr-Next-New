import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  DEFAULT_STATS_WINDOW_DAYS,
  MAX_STATS_WINDOW_DAYS,
} from '../assistant.constants';

/** How many days back the "how long is this taking" figures look. */
export class AssistantStatsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_STATS_WINDOW_DAYS)
  days: number = DEFAULT_STATS_WINDOW_DAYS;
}
