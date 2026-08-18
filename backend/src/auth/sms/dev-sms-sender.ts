import { Injectable, Logger } from '@nestjs/common';
import type { SmsSender } from './sms-sender';

/**
 * Development SMS sender: logs the code to the server console instead of texting
 * it. Lets the entire auth flow be built and tested with no SMS vendor.
 *
 * NEVER wire this in production: logging a live OTP is a credential leak. It is
 * selected only when SMS_PROVIDER is unset or 'dev' (see sms.provider.ts), and the
 * boot line says so in the terminal, in as many words, so nobody can mistake a
 * console run for real delivery.
 */
@Injectable()
export class DevSmsSender implements SmsSender {
  private readonly logger = new Logger('SmsSender:dev');

  sendOtp(mobile: string, code: string): Promise<void> {
    this.logger.warn(`DEV ONLY — OTP for ${mobile} is ${code}`);
    return Promise.resolve();
  }
}
