import { IsString, MaxLength, MinLength } from 'class-validator';
import { TOPIC_MAX_LENGTH } from '../../assistant/assistant.constants';

/** Turning a reply an agent wrote into a new draft answer. */
export class SaveReplyAsAnswerDto {
  /**
   * What kind of question this answers. Required, and deliberately not guessed:
   * the answer book is browsed by kind, and an answer filed under the wrong one
   * is an answer nobody finds again.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(TOPIC_MAX_LENGTH)
  topic!: string;
}
