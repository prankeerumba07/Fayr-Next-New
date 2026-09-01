import { Equals, IsBoolean, IsUUID } from 'class-validator';

/** Body for POST /tasks — claim a campaign. */
export class ClaimDto {
  @IsUUID()
  campaignId!: string;

  /**
   * The person ticked the box on the product page saying they accept this offer's
   * terms and have read the page. Required, and required to be TRUE.
   *
   * The owner asked on 1 September 2026 for the claim button to be dead until the
   * box is ticked, and for the acceptance to be RECORDED rather than only used to
   * light up a button. A disabled button is a courtesy, not a control: it lives in
   * the app, and anything that can reach this route can miss it out. So the rule
   * lives here as well, and the service refuses without it too — see
   * TaskService.claim.
   *
   * @Equals(true) rather than @IsBoolean() alone, because `false` is a perfectly
   * valid boolean and would otherwise create a task recording that somebody
   * declined the terms and claimed anyway.
   */
  @IsBoolean()
  @Equals(true, {
    message: 'You have to accept the terms and conditions before claiming.',
  })
  acceptedTerms!: boolean;
}
