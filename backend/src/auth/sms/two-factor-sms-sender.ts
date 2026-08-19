import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { maskMobile, scrubForLog, scrubUrlForLog } from './mask';
import { splitMobile } from './phone';
import type { SmsSender } from './sms-sender';

/**
 * 2Factor.in — an Indian SMS transport behind SmsSender.
 *
 * WHY THE `SMS` ROUTE AND NOT `AUTOGEN`. 2Factor offers both. AUTOGEN has them
 * generate the code, which would never match the hash we stored and would move the
 * cooldown, the 5-attempt lock and the block check outside our control. The SMS
 * route takes OUR code, so this class stays a postman. Same test that ruled out
 * Message Central's VerifyNow.
 *
 * THEIR CONTRACT (from their docs and knowledge base):
 *   GET https://2factor.in/API/V1/{api_key}/SMS/{phone}/{otp}[/{template_name}]
 *   success → {"Status":"Success","Details":"<session id>"}
 *   failure → {"Status":"Error","Details":"Invalid API Key - No Account Exists"}
 *
 * ⚠️ HTTP STATUS MEANS NOTHING HERE. Every documented failure — bad key, disabled
 * account, expired account, low balance, unapproved sender ID — arrives as
 * Status:"Error", and no HTTP status codes are documented at all. `Status` is the
 * only authority, and an unreadable body is a failure.
 *
 * ⚠️ BOTH SECRETS ARE IN THE URL PATH. The API key and the login code are path
 * segments, not query parameters, so a plainly-logged URL would print a live
 * credential. Every URL that goes near a log goes through scrubUrlForLog, which
 * redacts credential-shaped path segments and is additionally handed the API key as
 * a literal.
 *
 * ── SMS RETRIEVER, FOR LATER ─────────────────────────────────────────────────
 * Like the other free route, this delivers from a shared/unbranded sender, so
 * Android SMS Retriever autofill will not fire: typing the code by hand must always
 * work. When we move to a DLT-registered route and want autofill, the 11-character
 * app hash must be the PLAY-SIGNED RELEASE hash, not the local debug hash — Play
 * App Signing re-signs the upload, so a debug hash works for the developer and
 * silently fails for every real user.
 *
 * ── LIMITS ───────────────────────────────────────────────────────────────────
 * A trial account has a small credit balance and, per their own error list, can be
 * disabled or expire. See src/auth/sms/README.md; a DLT-registered Indian route is
 * still required before real users.
 */

const USER_FACING_FAILURE =
  'We could not send your code just now. Please wait a moment and try again.';

@Injectable()
export class TwoFactorSmsSender implements SmsSender {
  private readonly logger = new Logger('SmsSender:2factor');
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly templateName: string;
  private readonly countryCode: string;
  private readonly numberFormat: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    const read = (k: keyof Env): string => String(config.get(k, { infer: true }) ?? '');
    this.baseUrl = read('TWOFACTOR_BASE_URL').replace(/\/+$/, '');
    this.apiKey = read('TWOFACTOR_API_KEY');
    this.templateName = read('TWOFACTOR_TEMPLATE_NAME').trim();
    this.countryCode = read('TWOFACTOR_COUNTRY_CODE');
    this.numberFormat = read('TWOFACTOR_NUMBER_FORMAT');
    this.timeoutMs = Number(config.get('TWOFACTOR_TIMEOUT_MS', { infer: true }));
  }

  async sendOtp(mobile: string, code: string): Promise<void> {
    const masked = maskMobile(mobile);

    const split = splitMobile(mobile, this.countryCode);
    if (split == null) {
      this.logger.error(
        `refusing to send to ${masked} — not a +${this.countryCode} number`,
      );
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }
    // Their docs show +91XXXXXXXXXX; plain national is also widely accepted. Env
    // switchable so the right one for this account is a setting, not an edit.
    const number = this.numberFormat === 'national' ? split.national : split.e164;

    // Path segments, in their documented order. encodeURIComponent is deliberately
    // NOT applied to the number: their example shows a literal '+', which is a
    // legal path character, and percent-encoding it has been known to fail.
    const parts = [this.baseUrl, 'API', 'V1', this.apiKey, 'SMS', number, code];
    if (this.templateName) parts.push(encodeURIComponent(this.templateName));
    const url = parts.join('/');
    // Never the raw URL: it carries the API key AND the code.
    const safeUrl = scrubUrlForLog(url, { secrets: [this.apiKey] });

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Timeout or network error. NEVER retried — the message may already be on its
      // way, and a second attempt would put a different code on the same phone.
      this.logger.error(`send failed (${safeUrl}): ${this.describe(err)}`);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    let raw = '';
    try {
      raw = await res.text();
    } catch {
      raw = '';
    }

    let body: Record<string, unknown> | null = null;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }

    // An unreadable reply is a FAILURE. We cannot confirm a send we cannot read, so
    // we must not claim the code is on its way.
    if (body == null) {
      this.logger.error(
        `send response could not be read as JSON (HTTP ${res.status}): `
        + `${raw.length ? scrubForLog(raw).slice(0, 300) : '(empty body)'}`,
      );
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    const status = String(body.Status ?? '');
    if (status.toLowerCase() !== 'success') {
      // `Details` carries their real reason — low balance, unapproved sender ID,
      // disabled account. Logged (scrubbed) so a failure is actionable; never shown
      // to the user.
      this.logger.error(
        `send refused by provider (HTTP ${res.status}): `
        + `Status=${status || '(none)'} Details=${scrubForLog(String(body.Details ?? ''))}`,
      );
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    // Their session id. Useful for support, and not a secret.
    const details = String(body.Details ?? '');
    this.logger.log(
      `code sent to ${masked}${details ? ` — provider reference ${details}` : ''}`,
    );
  }

  private describe(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${scrubForLog(err.message)}`;
    return scrubForLog(String(err));
  }
}
