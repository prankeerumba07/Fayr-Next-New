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
