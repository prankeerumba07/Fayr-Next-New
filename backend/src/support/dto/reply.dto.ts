import { IsString, MaxLength, MinLength } from 'class-validator';

/** One message added to a question's thread (user follow-up or staff answer). */
export class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
