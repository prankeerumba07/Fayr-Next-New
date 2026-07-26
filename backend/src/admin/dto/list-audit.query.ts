import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Filters + pagination for the audit trail (ADMIN oversight). All filters are
 * optional (no filter = the whole trail, newest first). limit is capped so a
 * single call can't pull an unbounded page.
 */
export class ListAuditQueryDto {
  @IsOptional()
  @IsUUID()
  staffUserId?: string;

  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
