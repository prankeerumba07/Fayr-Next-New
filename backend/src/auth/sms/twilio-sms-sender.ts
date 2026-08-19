import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { maskMobile, scrubBodyForLog, scrubForLog } from './mask';
import { splitMobile } from './phone';
import type { SmsSender } from './sms-sender';

/**
 * Twilio Programmable Messaging — a real SMS transport behind SmsSender.
 *
 * WHY PROGRAMMABLE MESSAGING AND NOT TWILIO VERIFY. Verify generates and validates
 * its own code, which would move the cooldown, the 5-attempt lock and the block
 * check outside our control. Programmable Messaging takes OUR body carrying OUR
 * code. Same rule that ruled out MessageNow's VerifyNow and 2Factor's AUTOGEN.
 *
 * THEIR CONTRACT (docs verified 2026-08-19):
 *   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
 *   content-type: application/x-www-form-urlencoded
 *   Basic auth over AccountSid:AuthToken
 *   form: To, Body, and ONE sender — From or MessagingServiceSid
 *   201 → {"sid":"SM…","status":"queued","error_code":null,…}
 *   4xx → {"code":21608,"message":"…","more_info":"…","status":400}
 *
 * ⚠️ A 201 IS NOT DELIVERY. `status` can be 'failed' or 'undelivered', and
 * `error_code` can be set on an otherwise-successful create. Both are checked.
 *
 * ── DLT ──────────────────────────────────────────────────────────────────────
 * India's DLT registration applies to the DOMESTIC route. A non-Indian Twilio
 * account reaching +91 numbers goes over the international (ILDO) route, which is
 * outside DLT — at the cost of a random numeric sender, higher price and poorer
 * deliverability. Confirmed against current guidance 2026-08-19. That is what makes
 * this usable today, and it is NOT a substitute for DLT before real users.
 *
 * ── SMS RETRIEVER, FOR LATER ─────────────────────────────────────────────────
 * A random numeric sender means Android SMS Retriever autofill will not fire, so
 * typing the code by hand must always work. When we move to a DLT-registered route
 * and want autofill, the 11-character app hash must be the PLAY-SIGNED RELEASE
 * hash, not the local debug hash — Play App Signing re-signs the upload, so a debug
 * hash works for the developer and silently fails for every real user.
 */

const USER_FACING_FAILURE =
  'We could not send your code just now. Please wait a moment and try again.';

/** Message statuses that mean "Twilio has it and is working on it". */
const ACCEPTED_STATUSES = new Set(['queued', 'accepted', 'sending', 'sent', 'delivered']);

/**
 * The two failures a trial account actually hits, translated into an instruction.
 * A generic "send failed" here would cost the operator an afternoon.
 */
const KNOWN_CODES: Record<number, string> = {
  21608:
    'this number is not in Twilio\'s Verified Caller IDs. On a trial account you can '
    + 'only text numbers you have verified. Add it in the Twilio console under '
    + 'Phone Numbers → Manage → Verified Caller IDs (a trial allows at most 5).',
  21408:
    'Geo Permissions for the destination region are disabled. Enable India in the '
    + 'Twilio console under Messaging → Settings → Geo Permissions, and accept the '
    + 'high-risk acknowledgement it shows.',
  21606:
    'the From number cannot send SMS. Use a Twilio number that is SMS-capable, or '
    + 'set TWILIO_MESSAGING_SERVICE_SID instead.',
  21610:
    'this number has replied STOP and is unsubscribed. Twilio will not deliver to it '
    + 'until it opts back in.',
  20003:
    'Twilio rejected the credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN '
    + 'in backend/.env.',
};

@Injectable()
export class TwilioSmsSender implements SmsSender {
  private readonly logger = new Logger('SmsSender:twilio');
  private readonly baseUrl: string;
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;
  private readonly messagingServiceSid: string;
  private readonly countryCode: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    const read = (k: keyof Env): string => String(config.get(k, { infer: true }) ?? '');
    this.baseUrl = read('TWILIO_BASE_URL').replace(/\/+$/, '');
    this.accountSid = read('TWILIO_ACCOUNT_SID');
    this.authToken = read('TWILIO_AUTH_TOKEN');
    this.fromNumber = read('TWILIO_FROM_NUMBER').trim();
    this.messagingServiceSid = read('TWILIO_MESSAGING_SERVICE_SID').trim();
    this.countryCode = read('TWILIO_COUNTRY_CODE');
    this.timeoutMs = Number(config.get('TWILIO_TIMEOUT_MS', { infer: true }));
  }

  async sendOtp(mobile: string, code: string): Promise<void> {
    const masked = maskMobile(mobile);

    const split = splitMobile(mobile, this.countryCode);
    if (split == null) {
      this.logger.error(`refusing to send to ${masked} — not a +${this.countryCode} number`);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    const form = new URLSearchParams();
    form.set('To', split.e164);
    form.set('Body', this.messageText(code));
    // Their API takes ONE sender. A Messaging Service wins when configured, because
    // it is what a real deploy would use; a trial has only a From number.
    if (this.messagingServiceSid) {
      form.set('MessagingServiceSid', this.messagingServiceSid);
    } else {
      form.set('From', this.fromNumber);
    }

    const url = `${this.baseUrl}/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    // Basic auth in a HEADER, never in the URL — a URL reaches logs and proxies.
    const authorization =
      'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // NEVER retried: a timeout may mean the message is already on its way, and a
      // second attempt would put a different code on the same phone.
      this.logger.error(`send failed for ${masked}: ${this.describe(err)}`);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    const raw = await res.text().catch(() => '');
    let body: Record<string, unknown> | null = null;
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }

    // An unreadable reply is a FAILURE. We cannot confirm a send we cannot read.
    if (body == null) {
      this.logger.error(
        `send response could not be read as JSON (HTTP ${res.status}): `
        + `${raw.length ? this.safeBody(raw).slice(0, 300) : '(empty body)'}`,
      );
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    // An API-level error: {code, message, more_info, status}.
    const apiCode = typeof body.code === 'number' ? body.code : null;
    if (!res.ok || apiCode != null) {
      this.explain(apiCode, body, res.status, masked);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    // A 201 is not delivery. Their own fields say whether it is really under way.
    const status = String(body.status ?? '');
    const errorCode = body.error_code == null ? null : Number(body.error_code);
    if (errorCode != null || !ACCEPTED_STATUSES.has(status)) {
      this.explain(errorCode, body, res.status, masked);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    this.logger.log(
      `code sent to ${masked} — provider reference ${String(body.sid ?? '(none)')} (${status})`,
    );
  }

  /**
   * Say what actually went wrong, in the log, in words that name the fix. The USER
   * only ever sees USER_FACING_FAILURE; this is for whoever is watching the terminal.
   */
  private explain(
    code: number | null,
    body: Record<string, unknown>,
    httpStatus: number,
    masked: string,
  ): void {
    const known = code != null ? KNOWN_CODES[code] : undefined;
    // safeBody, NOT scrubForLog: the auth token is hex with letters mixed in, so it
    // has no long digit runs and digit masking leaves it intact. Twilio echoes the
    // credential back in some auth errors. Caught by this file's own test.
    const detail = this.safeBody(String(body.message ?? body.status ?? ''));
    if (known) {
      this.logger.error(`cannot text ${masked}: ${known} (Twilio ${code}: ${detail})`);
      return;
    }
    this.logger.error(
      `send refused for ${masked} (HTTP ${httpStatus}`
      + `${code != null ? `, Twilio ${code}` : ''}): ${detail || this.safeBody(JSON.stringify(body))}`,
    );
  }

  /** The code is 6 digits and the token could appear in an echoed body. */
  private safeBody(raw: string): string {
    return scrubBodyForLog(raw, { secrets: [this.authToken, this.accountSid] });
  }

  private messageText(code: string): string {
    return `${code} is your Fayr code. Do not share it with anyone.`;
  }

  private describe(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${scrubForLog(err.message)}`;
    return scrubForLog(String(err));
  }
}
