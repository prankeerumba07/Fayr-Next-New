import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LIVE_STATES } from '../live-page.rules';

/** What the phone found on one offer's page. */
export class LiveResultDto {
  @IsUUID()
  campaignId!: string;

  @IsIn([...LIVE_STATES])
  state!: string;

  /** What the shop's own page answered. Absent when nothing answered at all. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(599)
  httpStatus?: number;

  /** The words on the page that decided it. Kept short: it is evidence, not a copy. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  evidence?: string;
}

/** One morning's run. Capped, because there is one row per live offer. */
export class SubmitLiveResultsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => LiveResultDto)
  results!: LiveResultDto[];
}
