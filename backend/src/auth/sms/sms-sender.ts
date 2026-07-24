/**
 * Delivery abstraction for one-time codes. The auth flow depends only on this
 * interface, so the real provider (MSG91/Twilio/etc.) is a drop-in swap in
 * AuthModule with no change to the auth logic.
 */
export interface SmsSender {
  /**
   * Deliver `code` to `mobile` (E.164). MUST reject (throw) on delivery failure
   * so the caller can surface an error instead of a code that never arrives.
   */
  sendOtp(mobile: string, code: string): Promise<void>;
}

/** DI token for the SmsSender binding. */
export const SMS_SENDER = Symbol('SMS_SENDER');
