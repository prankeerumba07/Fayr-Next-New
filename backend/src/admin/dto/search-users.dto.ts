import { Matches } from 'class-validator';
import { E164_REGEX } from '../../auth/auth.constants';

/**
 * Staff search is BY MOBILE ONLY, and the number arrives in the BODY rather than
 * in the web address — see the endpoint for why.
 *
 * The E.164 constraint is also the guardrail that enforces the product rule
 * "never the Fayr id": a FAYR-100001 display id or a UUID does not match E.164, so
 * it is rejected at validation. There is no field here that accepts anything but a
 * mobile number.
 */
export class SearchUsersDto {
  @Matches(E164_REGEX, {
    message: 'mobile must be in E.164 format, e.g. +919876543210',
  })
  mobile!: string;
}
