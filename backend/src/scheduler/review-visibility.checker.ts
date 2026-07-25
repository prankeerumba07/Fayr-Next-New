import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

/**
 * Server-side check of whether a review is still PUBLICLY visible — the payout
 * signal the backend can verify itself, with no user marketplace session. This
 * is deliberately NOT the on-device scraper (which reads authenticated order
 * history); it is a plain GET of the public review permalink.
 */
export interface ReviewVisibilityChecker {
  /**
   * Resolves true if the review at `permalink` is still publicly live, false if
   * it's definitively gone (removed / not found / behind a sign-in wall). THROWS
   * on a transient failure (network error, timeout) — callers must treat a throw
   * as "couldn't check", never as "not visible", so a network blip can't wrongly
   * claw back a refund.
   */
  isPublished(permalink: string): Promise<boolean>;
}

export const REVIEW_VISIBILITY_CHECKER = Symbol('REVIEW_VISIBILITY_CHECKER');

// A realistic desktop UA — some marketplaces serve a barebones/blocked page to
// obvious bots, which would look like a removed review.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

@Injectable()
export class HttpReviewVisibilityChecker implements ReviewVisibilityChecker {
  private readonly logger = new Logger(HttpReviewVisibilityChecker.name);
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.timeoutMs = config.get('VISIBILITY_FETCH_TIMEOUT_MS', { infer: true });
  }

  async isPublished(permalink: string): Promise<boolean> {
    const res = await fetch(permalink, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'en-IN,en;q=0.9',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    // A removed review typically 404s; anything else non-OK we treat as gone.
    if (!res.ok) {
      this.logger.debug(`review permalink ${permalink} → HTTP ${res.status}`);
      return false;
    }
    // A sign-in redirect means the page is gated, not that the review is live —
    // treat it as not publicly visible (the public signal must stand on its own).
    if (/\/ap\/signin|\/customer\/login|accounts\.google/i.test(res.url)) {
      return false;
    }
    // 200 on the public permalink is the same signal the on-device check uses.
    return true;
  }
}
