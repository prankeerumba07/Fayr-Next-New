import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { APP_REPORTABLE, APP_SCREENS } from '../user-event.types';

/**
 * A step the app is telling us about.
 *
 * `type` is checked against the SHORT list, not the whole vocabulary. This route
 * has no sign-in on it — it has to work before anybody has an account — so an
 * app that could name any step could sit on a laptop inflating the signup count.
 * Five names, and nothing else is accepted.
 *
 * There is no free-text field here and there never should be. A number, a name
 * or an address reaching this table is the failure this whole design is shaped
 * to prevent. `screen` is not an exception to that rule: it is checked against a
 * fixed list of the app's own route names, so the only strings it can ever carry
 * are ones already written down in user-event.types.ts. A mobile number typed
 * into it is refused with a 400 exactly like any other word that is not a screen.
 */
export class ReportEventDto {
  @IsString()
  @IsIn(APP_REPORTABLE as unknown as string[])
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  anonymousId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  platform?: string;

  /**
   * Which screen was drawn, for SCREEN_VIEWED.
   *
   * An ALLOW-LIST rather than a length check, and the difference is the whole
   * point: a length check would happily store a mobile number, an order id or a
   * URL with a task id in it. @IsIn can only ever accept a name the app really
   * registers, so nothing personal can arrive here even from a client we did not
   * write. No @MaxLength beside it — every accepted value is already a known
   * short string, and a second, weaker rule next to this one would only invite
   * somebody to relax the strong one.
   */
  @IsOptional()
  @IsString()
  @IsIn(APP_SCREENS as unknown as string[])
  screen?: string;
}
