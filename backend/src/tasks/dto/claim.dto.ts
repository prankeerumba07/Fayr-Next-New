import { IsUUID } from 'class-validator';

/** Body for POST /tasks — claim a campaign. */
export class ClaimDto {
  @IsUUID()
  campaignId!: string;
}
