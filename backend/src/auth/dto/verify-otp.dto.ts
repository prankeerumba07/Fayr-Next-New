import { IsString, Matches } from 'class-validator';
import { E164_REGEX, OTP_LENGTH } from '../auth.constants';

export class VerifyOtpDto {
  @IsString()
  @Matches(E164_REGEX, {
    message: 'mobile must be in E.164 format, e.g. +919876543210',
  })
  mobile!: string;

  @IsString()
  @Matches(new RegExp(`^\\d{${OTP_LENGTH}}$`), {
    message: `code must be exactly ${OTP_LENGTH} digits`,
  })
  code!: string;
}
