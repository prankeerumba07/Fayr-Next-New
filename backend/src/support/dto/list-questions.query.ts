import { QuestionStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/** Staff question list filter. No filter = all questions, newest first. */
export class ListQuestionsQueryDto {
  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus;
}
