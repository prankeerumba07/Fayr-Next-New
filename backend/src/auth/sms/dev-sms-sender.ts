import { Injectable, Logger } from '@nestjs/common';
import type { SmsSender } from './sms-sender';

/**
 * Development SMS sender: logs the code to the server console instead of texting
 * it. Lets the entire auth flow be built and tested with no SMS vendor.
 *
 * PRODUCTION GAP — before launch, a real provider must replace this binding in
 * AuthModule. It is the piece that pairs with the app's SMS Retriever API. This
 * class must NEVER be wired in production; logging a live OTP is a credential leak.
 */
@Injectable()
export class DevSmsSender implements SmsSender {
  private readonly logger = new Logger('SmsSender:dev');

  sendOtp(mobile: string, code: string): Promise<void> {
    this.logger.warn(`DEV ONLY — OTP for ${mobile} is ${code}`);
    return Promise.resolve();
  }
}
