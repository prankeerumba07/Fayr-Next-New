import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ANSWER_BODY_MAX_LENGTH,
  ANSWER_TITLE_MAX_LENGTH,
  MAX_PHRASES_PER_ANSWER,
  PHRASE_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from '../assistant.constants';
import { LANGUAGES } from '../language';

/** An answer a person is writing, or a correction to one already stored. */
export class SaveAnswerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  key!: string;

  @IsIn([...LANGUAGES])
  language!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(ANSWER_TITLE_MAX_LENGTH)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(ANSWER_BODY_MAX_LENGTH)
  body!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(TOPIC_MAX_LENGTH)
  topic!: string;

  /**
   * Given, they REPLACE the stored wordings. Left out, the stored ones are left
   * alone — so correcting the words of an answer never silently throws away the
   * forty ways people ask for it.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PHRASES_PER_ANSWER)
  @IsString({ each: true })
  @MaxLength(PHRASE_MAX_LENGTH, { each: true })
  @Type(() => String)
  phrases?: string[];
}

/** Words to check without saving anything. */
export class CheckWordsDto {
  @IsIn([...LANGUAGES])
  language!: string;

  @IsOptional()
  @IsString()
  @MaxLength(ANSWER_TITLE_MAX_LENGTH)
  title?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(ANSWER_BODY_MAX_LENGTH)
  body!: string;
}
