import { WithdrawalStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/** Staff withdrawal-queue filter. No filter = all withdrawals, newest first. */
export class ListWithdrawalsQueryDto {
  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;
}
