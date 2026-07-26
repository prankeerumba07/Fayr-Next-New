import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../admin.constants';

/**
 * Staff login credentials. `email` is normalized (trim + lowercase) at the edge
 * BEFORE validation, so a trailing space or mixed case still resolves to the one
 * stored account; `password` is only length-bounded here — we never assert the
 * password POLICY at login, so the endpoint can't be used to probe it. The
 * MaxLength caps argon2's work on absurd inputs (a DoS guard).
 */
export class StaffLoginDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
