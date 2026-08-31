import { IsString, MaxLength, MinLength } from 'class-validator';
import { MESSAGE_MAX_LENGTH } from '../chat.rules';

/** What a shopper types into the box. */
export class SayDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX_LENGTH)
  message!: string;
}

/** What a member of staff types into the box. */
export class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX_LENGTH)
  message!: string;
}

/** Words to check without sending them. */
export class CheckReplyDto {
  @IsString()
  @MaxLength(MESSAGE_MAX_LENGTH)
  message!: string;
}
