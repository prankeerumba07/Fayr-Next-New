import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { maskMobile, scrubBodyForLog, scrubForLog } from './mask';
import { splitMobile } from './phone';
import type { SmsSender } from './sms-sender';

/**
 * Fast2SMS — an Indian SMS transport behind SmsSender, on the Quick route.
 *
 * THEIR CONTRACT (docs verified 2026-08-19):
 *   POST https://www.fast2sms.com/dev/bulkV2
 *   header: authorization: <api key>
 *   form: route=q, message=<our text>, numbers=<10 digits, comma separated>
 *   success → {"return":true,"request_id":"lwdtp7cjyqxvfe9","message":["Message sent successfully"]}
 *
 * ⚠️ THEIR FAILURE BODY SHAPE IS NOT PUBLISHED. The error-code LIST is (27 codes,
 * all covered in the spec), but no example failure body is documented anywhere we
 * could find. So `return === true` is the ONLY success signal, and every other
 * shape — including one we have never seen — is a failure. Inverting that is
 * precisely how a failure gets reported as a delivered code.
 *
 * We send by POST rather than GET on purpose: their docs allow the key as a query
 * parameter on GET, and a URL carrying a live credential reaches logs and proxies.
 * A header cannot.
 *
 * ── LIMITS ───────────────────────────────────────────────────────────────────
 * The Quick route needs no DLT and delivers from a random numeric sender. It costs
 * roughly ₹5 a message, so the ₹50 free credit is about TEN messages. Their code 995
 * also refuses repeated sends to the same number, which an OTP resend can trip. See
 * src/auth/sms/README.md.
 *
 * ── SMS RETRIEVER, FOR LATER ─────────────────────────────────────────────────
 * A random numeric sender means Android SMS Retriever autofill cannot fire, so
 * typing the code by hand must always work. When we move to a DLT-registered route
 * and want autofill, the 11-character app hash must be the PLAY-SIGNED RELEASE hash,
 * not the local debug hash — Play App Signing re-signs the upload, so a debug hash
 * works for the developer and silently fails for every real user.
 */

const USER_FACING_FAILURE =
  'We could not send your code just now. Please wait a moment and try again.';

/**
 * The failures an OTP flow will actually meet, turned into an instruction. Every
 * other documented code is still logged with its number and their own message.
 */
const KNOWN_CODES: Record<number, string> = {
  412:
    'Fast2SMS rejected the authorization key. Check FAST2SMS_API_KEY in backend/.env '
    + '(Dev API section of their dashboard).',
  413: 'the authorization key is disabled. Re-enable or regenerate it in their dashboard.',
  414:
    'this machine\'s IP is blacklisted in their Dev API section. Their dashboard has an '
    + 'IP allowlist — add the current IP, or clear the restriction.',
  415: 'the Fast2SMS account is disabled. Nothing here can fix that; contact them.',
  416:
    'the Fast2SMS wallet has insufficient balance. The Quick route costs about Rs 5 a '
    + 'message, so Rs 50 of credit is roughly ten. Top up to continue.',
  407: 'they rejected the message TEXT as containing invalid words. Reword the template.',
  411: 'they rejected the number. It must be 10 digits with no country code.',
  995:
    'they detected repeated sends to the same number. An OTP resend can trip this; wait '
    + 'before trying that number again.',
  996: 'their OTP route needs KYC completed first. The Quick route should not need it.',
  998: 'they want the DLT or Quick route for this send. Check route=q is being sent.',
  999:
    'they require a single wallet transaction of at least Rs 100 before the API works. '
    + 'The free credit alone may not satisfy this.',
};

@Injectable()
export class Fast2SmsSender implements SmsSender {
  private readonly logger = new Logger('SmsSender:fast2sms');
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly countryCode: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    const read = (k: keyof Env): string => String(config.get(k, { infer: true }) ?? '');
    this.baseUrl = read('FAST2SMS_BASE_URL').replace(/\/+$/, '');
    this.apiKey = read('FAST2SMS_API_KEY');
    this.countryCode = read('FAST2SMS_COUNTRY_CODE');
    this.timeoutMs = Number(config.get('FAST2SMS_TIMEOUT_MS', { infer: true }));
  }

  async sendOtp(mobile: string, code: string): Promise<void> {
    const masked = maskMobile(mobile);

    const split = splitMobile(mobile, this.countryCode);
    if (split == null) {
      this.logger.error(`refusing to send to ${masked} — not a +${this.countryCode} number`);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    const form = new URLSearchParams();
    form.set('route', 'q'); // Quick SMS: no DLT, random numeric sender
    form.set('message', this.messageText(code));
    form.set('numbers', split.national); // 10 digits, no country code

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/dev/bulkV2`, {
        method: 'POST',
        headers: {
          // Their header name, lower-cased. Never a query parameter.
          authorization: this.apiKey,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // NEVER retried: a timeout may mean the message is already on its way.
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

    if (body == null) {
      this.logger.error(
        `send response could not be read as JSON (HTTP ${res.status}): `
        + `${raw.length ? this.safeBody(raw).slice(0, 300) : '(empty body)'}`,
      );
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    // STRICTLY true. Not truthy — 'true', 1 and 'yes' are all refused, because their
    // failure body is undocumented and a loose check would let an unknown shape count
    // as a delivered code.
    if (body.return !== true) {
      this.explain(body, res.status, masked);
      throw new ServiceUnavailableException(USER_FACING_FAILURE);
    }

    this.logger.log(
      `code sent to ${masked} — provider reference ${String(body.request_id ?? '(none)')}`,
    );
  }

  /** What went wrong, in the log, naming the fix where we know it. */
  private explain(body: Record<string, unknown>, httpStatus: number, masked: string): void {
    const code = body.status_code == null ? null : Number(body.status_code);
    const message = this.safeBody(
      Array.isArray(body.message) ? body.message.join('; ') : String(body.message ?? ''),
    );
    const known = code != null ? KNOWN_CODES[code] : undefined;
    if (known) {
      this.logger.error(`cannot text ${masked}: ${known} (Fast2SMS ${code}: ${message})`);
      return;
    }
    this.logger.error(
      `send refused for ${masked} (HTTP ${httpStatus}`
      + `${code != null ? `, Fast2SMS ${code}` : ''}): `
      + `${message || this.safeBody(JSON.stringify(body))}`,
    );
  }

  private safeBody(raw: string): string {
    return scrubBodyForLog(raw, { secrets: [this.apiKey] });
  }

  private messageText(code: string): string {
    return `${code} is your Fayr code. Do not share it with anyone.`;
  }

  private describe(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${scrubForLog(err.message)}`;
    return scrubForLog(String(err));
  }
}
