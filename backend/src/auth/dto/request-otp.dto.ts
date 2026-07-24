import { IsString, Matches } from 'class-validator';
import { E164_REGEX } from '../auth.constants';

export class RequestOtpDto {
  @IsString()
  @Matches(E164_REGEX, {
    message: 'mobile must be in E.164 format, e.g. +919876543210',
  })
  mobile!: string;
}
