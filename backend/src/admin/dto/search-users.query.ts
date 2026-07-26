import { Matches } from 'class-validator';
import { E164_REGEX } from '../../auth/auth.constants';

/**
 * Staff search is BY MOBILE ONLY. The E.164 constraint is also the guardrail that
 * enforces the product rule "never the Fayr id": a FAYR-100001 display id or a
 * UUID doesn't match E.164, so it's rejected at validation (400) — there is no
 * field here that accepts anything but a mobile number.
 */
export class SearchUsersQueryDto {
  @Matches(E164_REGEX, {
    message: 'mobile must be in E.164 format, e.g. +919876543210',
  })
  mobile!: string;
}
