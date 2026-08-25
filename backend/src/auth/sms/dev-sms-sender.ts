import { Injectable, Logger } from '@nestjs/common';
import { maskMobile } from './mask';
import type { SmsSender } from './sms-sender';

/**
 * Development SMS sender: logs the code to the server console instead of texting
 * it. Lets the entire auth flow be built and tested with no SMS vendor.
 *
 * NEVER wire this in production: logging a live OTP is a credential leak. That
 * used to be a COMMENT and nothing more — 'dev' is the default value of
 * SMS_PROVIDER, and nothing refused it under NODE_ENV=production, so a deploy that
 * forgot the line would print every live code into the production log while sending
 * no SMS at all. It is now an interlock in two places: the env schema and
 * createSmsSender both refuse 'dev' in production.
 *
 * The NUMBER is masked even here. The code has to be printed for this sender to be
 * useful; the phone number never does, and this was the only sender that did not go
 * through mask.ts.
 */
@Injectable()
export class DevSmsSender implements SmsSender {
  private readonly logger = new Logger('SmsSender:dev');

  sendOtp(mobile: string, code: string): Promise<void> {
    this.logger.warn(
      `DEV ONLY — no SMS sent. Code for ${maskMobile(mobile)} is ${code}`,
    );
    return Promise.resolve();
  }
}
