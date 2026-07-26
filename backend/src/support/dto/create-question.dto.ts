import { IsString, MaxLength, MinLength } from 'class-validator';

/** A new support question from a user: a short subject and a longer body. */
export class CreateQuestionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
