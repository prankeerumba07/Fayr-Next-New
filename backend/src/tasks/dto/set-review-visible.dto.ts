import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Only http(s). A `javascript:` or `data:` string is not a page anybody can go
 * and open, and this field's whole job is to name a place a second person can
 * check. Deliberately not @IsUrl(), which accepts every scheme.
 */
const HTTP_URL = /^https?:\/\/[^\s]{4,500}$/i;

/**
 * A Fayr reviewer states whether the review is publicly visible.
 *
 * The third privileged staff decision, and the one that touches a PAYOUT SIGNAL
 * most directly: `published` is what starts the holding period, and the holding
 * period is what stands between a review and a refund. So it asks for more than a
 * yes/no.
 *
 * `productUrl` is required in BOTH directions. "I checked" with no address is not
 * evidence — a year later somebody has to be able to open the same page and see
 * what the reviewer saw, or fail to. That applies just as much to "I looked and
 * it was not there".
 */
export class SetReviewVisibleDto {
  /**
   * true  — I opened the page and the review is there.
   * false — withdrawing a confirmation I made earlier.
   *
   * Not optional, and with no default: a decision this reads as must be stated.
   */
  @IsBoolean()
  visible!: boolean;

  /** The page they actually opened. */
  @Matches(HTTP_URL, {
    message: 'productUrl must be the http(s) address of the page you opened',
  })
  productUrl!: string;

  /**
   * When they opened it. Optional — the server stamps now, which is the ordinary
   * case and the more trustworthy one. Supplied only when the check happened
   * earlier than the record of it; a date in the future is refused in the service,
   * because nobody has looked at something tomorrow.
   */
  @IsOptional()
  @IsISO8601()
  seenAt?: string;

  /** What they saw. Required: an audit row that says nothing looks like diligence. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
