import { AnswerStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  TOPIC_MAX_LENGTH,
} from '../assistant.constants';
import { LANGUAGES } from '../language';

/** The answer-book filter. Everything optional; no filter means the whole book. */
export class ListAnswersQueryDto {
  @IsOptional()
  @IsIn([...LANGUAGES])
  language?: string;

  @IsOptional()
  @IsEnum(AnswerStatus)
  status?: AnswerStatus;

  @IsOptional()
  @IsString()
  @MaxLength(TOPIC_MAX_LENGTH)
  topic?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
