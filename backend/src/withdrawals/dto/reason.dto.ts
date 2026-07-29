import { IsString, MaxLength, MinLength } from 'class-validator';

/** A staff reason for rejecting or failing a withdrawal (recorded on the row). */
export class ReasonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
