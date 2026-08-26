import { AssistantQuestionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../assistant.constants';

/**
 * The staff queue filter. No filter at all means every question, newest first;
 * the screen asks for UNRESOLVED, which is the list somebody has to act on.
 * The page size is capped so one call can never pull the whole history.
 */
export class ListAssistantQuestionsQueryDto {
  @IsOptional()
  @IsEnum(AssistantQuestionStatus)
  status?: AssistantQuestionStatus;

  @IsOptional()
  @IsUUID()
  userId?: string;

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
