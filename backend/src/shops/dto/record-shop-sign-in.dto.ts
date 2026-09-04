import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Platform } from '@prisma/client';

/** The seven shops, from the one list the rest of the system uses. */
export const EVERY_PLATFORM = Object.values(Platform);

/** How long a reason may be. Long enough for a sentence, short enough to read. */
export const HOW_WE_KNEW_MAX = 200;

/**
 * SOMEBODY SIGNED IN AT A SHOP.
 *
 * TWO FIELDS, AND NEITHER IS A SECRET. Which shop, and in words how Fayr knew.
 * There is no field for a password, a code, a cookie or an account number, and
 * that is not an omission: nothing on the phone ever has one to send, because the
 * person types on the shop's own page and Fayr never sees it.
 *
 * WHO it was is never sent either. It is taken from the sign-in on the request,
 * because a person's own identity is not something a phone gets to claim.
 */
export class RecordShopSignInDto {
  @IsIn(EVERY_PLATFORM)
  platform!: Platform;

  /** In words, so a row can be read a year later without reading the code. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(HOW_WE_KNEW_MAX)
  howWeKnew?: string;
}
