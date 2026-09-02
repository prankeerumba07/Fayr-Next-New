import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CHAT_STATES } from '../chat.rules';

export class ListChatsQueryDto {
  @IsOptional()
  @IsIn(CHAT_STATES as unknown as string[])
  state?: (typeof CHAT_STATES)[number];

  @IsOptional()
  @IsUUID()
  takenByStaffId?: string;

  /**
   * ONE PERSON'S WHOLE HISTORY, newest first, every state including closed.
   *
   * The other side of the rule that a shopper never sees their own older
   * conversations: whoever is helping them has to be able to read the lot. This
   * is a staff route and there is no route a shopper can reach that accepts it.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  offset?: number;
}
