import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';
import { QUESTION_MAX_LENGTH } from '../assistant.constants';

/** A question typed into "Chat with us". Kept exactly as typed. */
export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(QUESTION_MAX_LENGTH)
  question!: string;
}

/** Did the reply help? One simple yes or no. */
export class HelpfulDto {
  @IsBoolean()
  helpful!: boolean;
}
