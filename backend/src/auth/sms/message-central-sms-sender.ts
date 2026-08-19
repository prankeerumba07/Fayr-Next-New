import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { OTP_TTL_SECONDS } from '../auth.constants';
import { maskMobile, scrubForLog } from './mask';
import type { SmsSender } from './sms-sender';

/**
 * Message Central (MessageNow) — a real SMS transport behind SmsSender.
 *
 * WHY MessageNow AND NOT VerifyNow. VerifyNow generates its own OTP and verifies
 * it through its own endpoint. That would put the code outside our control, and
 * with it the per-number cooldown, the 5-attempt lock and the block check that
 * live in AuthService. MessageNow takes OUR text carrying OUR code, so this class
 * stays a postman and every security decision stays in one place.
 *
 * ── SMS RETRIEVER, FOR LATER ─────────────────────────────────────────────────
 * This free route sends from a random numeric sender, so Android's SMS Retriever
 * autofill will NOT fire: typing the code by hand must work perfectly on every
 * screen. When we move to a DLT-registered Indian route and want autofill back,
 * the 11-character app hash embedded in the message must be the hash of the
 * PLAY-SIGNED RELEASE key, not the local debug key. Play App Signing re-signs the
 * upload, so a debug hash works on the developer's machine and silently fails for
 * every real user — the worst shape of bug, invisible until launch.
 *
 * ── LIMITS OF THIS ROUTE, RECORDED RATHER THAN PAPERED OVER ──────────────────
 * The no-DLT international route is valid for genuinely user-triggered OTP only.
 * It can be filtered or suspended without notice, free quotas are small, and a
 * DLT-registered Indian route is REQUIRED before real users. Open item, not a
 * solved one. See src/auth/sms/README.md.
 */

/** Docs: GET /auth/v1/authentication/token?customerId&key&scope=NEW&country&email */
const TOKEN_PATH = '/auth/v1/authentication/token';
/** Docs: POST /verification/v3/send?countryCode&flowType=SMS&mobileNumber&senderId&type=SMS&message&messageType */
const SEND_PATH = '/verification/v3/send';

/** What the user is told when delivery fails. No provider, no status, no enum. */
const USER_FACING_FAILURE =
  'We could not send your code just now. Please wait a moment and try again.';

interface CachedToken {
  token: string;
  expiresAt: number;
}

@Injectable()
export class MessageCentralSmsSender implements SmsSender {
  private readonly logger = new Logger('SmsSender:messagecentral');
  private readonly baseUrl: string;
  private readonly customerId: string;
  private readonly key: string;
  private readonly email: string;
  private readonly senderId: string;
  private readonly countryCode: string;
  private readonly messageType: string;
  private readonly timeoutMs: number;
  private readonly tokenTtlMs: number;
  private cached: CachedToken | null = null;

  constructor(config: ConfigService<Env, true>) {
    const read = (k: keyof Env): string =>
      String(config.get(k, { infer: true }) ?? '');
    this.baseUrl = read('MESSAGECENTRAL_BASE_URL').replace(/\/+$/, '');
    this.customerId = read('MESSAGECENTRAL_CUSTOMER_ID');
    this.key = read('MESSAGECENTRAL_PASSWORD_BASE64');
    this.email = read('MESSAGECENTRAL_EMAIL');
    this.senderId = read('MESSAGECENTRAL_SENDER_ID');
    this.countryCode = read('MESSAGECENTRAL_COUNTRY_CODE');
    this.messageType = read('MESSAGECENTRAL_MESSAGE_TYPE');
    this.timeoutMs = Number(config.get('MESSAGECENTRAL_TIMEOUT_MS', { infer: true }));
    this.tokenTtlMs =
      Number(config.get('MESSAGECENTRAL_TOKEN_TTL_MINUTES', { infer: true })) * 60_000;
  }

  async sendOtp(mobile: string, code: string): Promise<void> {
    const masked = maskMobile(mobile);
    // Split BEFORE authenticating: a number we cannot address is not worth a
    // token round-trip, and mangling it would text a stranger.
    const national = this.nationalNumber(mobile);

    // One send. An auth rejection is the ONLY thing retried, because a rejected
    // request was never delivered — see attemptSend.
    const first = await this.attemptSend(national, code, await this.token());
    if (first !== 'unauthorised') {
      this.logger.log(`code sent to ${masked}`);
      return;
    }

    this.logger.warn(`token rejected for ${masked}; re-authenticating once`);
    this.cached = null;
    const second = await this.attemptSend(national, code, await this.token(), true);
    if (second === 'unauthorised') {
      // Do not loop. Two rejections is a configuration problem, not a blip.
      this.logger.error(`token rejected twice for ${masked} — check credentials`);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }
    this.logger.log(`code sent to ${masked} after re-authenticating`);
  }

  /**
   * One send attempt. Returns 'sent', or 'unauthorised' when the provider
   * rejected our token (safe to repeat — nothing was delivered). EVERYTHING else
   * throws, so no failure path can ever produce a second message: a timeout may
   * mean the SMS is already on its way, and two different codes for one request
   * would leave the user unable to log in.
   */
  private async attemptSend(
    national: string,
    code: string,
    token: string,
    isRetry = false,
  ): Promise<'sent' | 'unauthorised'> {
    const url = new URL(this.baseUrl + SEND_PATH);
    url.searchParams.set('countryCode', this.countryCode);
    url.searchParams.set('flowType', 'SMS');
    url.searchParams.set('mobileNumber', national);
    url.searchParams.set('senderId', this.senderId);
    url.searchParams.set('type', 'SMS');
    url.searchParams.set('messageType', this.messageType);
    url.searchParams.set('message', this.messageText(code));

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers: { authToken: token, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Timeout or network error. NEVER retried.
      this.logger.error(`send failed: ${this.describe(err)}`);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    if (res.status === 401 || res.status === 403) return 'unauthorised';

    const body = await this.readBody(res);
    if (!res.ok) {
      this.logger.error(`send rejected (HTTP ${res.status}): ${scrubForLog(body.raw)}`);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }
    // A 200 is not a success on its own: the provider reports failures inside the
    // body, and treating one as sent would leave the user waiting for nothing.
    //
    // AN UNREADABLE BODY IS A FAILURE. This used to fall through to 'sent': both
    // checks below read body.json, which is null when parsing fails, and
    // `undefined != null` is FALSE in JS so the second check short-circuited before
    // comparing anything. A gateway HTML page, a proxy interstitial, or a
    // plain-text 'Success' therefore counted as delivered — and left no trace,
    // because the provider-reference line only logs when a transactionId is
    // present. We cannot confirm a send we cannot read, so we do not claim it.
    if (body.json == null) {
      this.logger.error(
        `send response could not be read as JSON (HTTP ${res.status}): `
        + `${body.raw.length ? scrubForLog(body.raw).slice(0, 300) : '(empty body)'}`,
      );
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }
    const errorMessage = body.json.data?.errorMessage;
    const responseCode = body.json.responseCode;
    // Strict !== undefined: a documented response may legitimately omit
    // responseCode, and `!= null` was the loose comparison that hid the bug above.
    if (
      errorMessage
      || (responseCode !== undefined && responseCode !== null && Number(responseCode) !== 200)
    ) {
      this.logger.error(`send refused by provider: ${scrubForLog(body.raw)}`);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    const txn = body.json?.data?.transactionId;
    if (txn) this.logger.log(`provider reference ${txn}${isRetry ? ' (retry)' : ''}`);
    return 'sent';
  }

  /** A cached token, fetched only when absent or past its cache lifetime. */
  private async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.token;

    const url = new URL(this.baseUrl + TOKEN_PATH);
    url.searchParams.set('customerId', this.customerId);
    url.searchParams.set('key', this.key);
    url.searchParams.set('scope', 'NEW');
    url.searchParams.set('country', this.countryCode);
    url.searchParams.set('email', this.email);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.logger.error(`could not reach the SMS provider: ${this.describe(err)}`);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    const body = await this.readBody(res);
    // The published token response is a copy-paste of the SEND response and
    // contains no token field, so accept either shape and fail loudly if neither
    // is present rather than sending with an empty header.
    const token = body.json?.token ?? body.json?.data?.token;
    if (!res.ok || typeof token !== 'string' || token.length === 0) {
      this.logger.error(
        `no usable token in the provider response (HTTP ${res.status}): ${scrubForLog(body.raw)}`,
      );
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }
    this.cached = { token, expiresAt: Date.now() + this.tokenTtlMs };
    return token;
  }

  /**
   * The E.164 number split into the national part the provider expects
   * alongside a separate countryCode. A number outside the configured country is
   * REFUSED rather than reshaped — Fayr is India-only, so a foreign number here
   * means something upstream is wrong, and guessing where to cut the digits could
   * text an unrelated person.
   */
  private nationalNumber(mobile: string): string {
    const digits = String(mobile ?? '').replace(/\D/g, '');
    if (!digits.startsWith(this.countryCode)) {
      this.logger.error(
        `refusing to send to ${maskMobile(mobile)} — not a +${this.countryCode} number`,
      );
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }
    return digits.slice(this.countryCode.length);
  }

  /** The message. Short, plain, and it says not to share the code. */
  private messageText(code: string): string {
    const minutes = Math.max(1, Math.round(OTP_TTL_SECONDS / 60));
    return `${code} is your Fayr code. It works for ${minutes} minutes. Do not share it with anyone.`;
  }

  /** Read a response once, keeping both the parsed and the raw form. */
  private async readBody(
    res: Response,
  ): Promise<{ raw: string; json: Record<string, any> | null }> {
    let raw = '';
    try {
      raw = await res.text();
    } catch {
      return { raw: '', json: null };
    }
    try {
      return { raw, json: JSON.parse(raw) as Record<string, any> };
    } catch {
      return { raw, json: null };
    }
  }

  /** An error described without leaking a URL that carries the code. */
  private describe(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${scrubForLog(err.message)}`;
    return scrubForLog(String(err));
  }
}
