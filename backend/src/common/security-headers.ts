/**
 * The three things this middleware touches, declared here rather than pulled from
 * a types package the project does not have. A middleware that only sets headers
 * needs nothing else, and a dependency added for two type names is a dependency to
 * keep patched for ever.
 */
interface HeaderWritableResponse {
  setHeader(name: string, value: string): unknown;
  removeHeader(name: string): unknown;
}

/**
 * THE SECURITY HEADERS EVERY ANSWER CARRIES.
 *
 * There were none at all. Found by reading the real response headers rather than
 * the code: every reply carried `x-powered-by: Express` and nothing else.
 *
 * WHY IT MATTERS HERE SPECIFICALLY, and not as a checklist item. This service
 * serves user-supplied FILES from /uploads. Without `nosniff` and a strict
 * content policy, a browser can be talked into treating an uploaded file as a web
 * page and running it — on this service's own address, where a staff member's
 * sign-in lives. That is the whole attack, and two headers close it.
 *
 * WRITTEN BY HAND RATHER THAN WITH A LIBRARY. Not out of pride: a library sets
 * about fifteen headers with defaults tuned for a website, and this is a JSON
 * service with one file mount. Every line below is here for a reason that is
 * written next to it, which is the only way anybody can later tell which ones
 * still apply.
 */

/**
 * Content policy for a service that returns JSON and files, and never a page.
 *
 * `default-src 'none'` is the strong part: an uploaded file that a browser did
 * open as a page could load nothing, run nothing and send nothing. The rest closes
 * the ways a page can be abused even when it renders nothing.
 */
const CONTENT_POLICY = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'sandbox',
].join('; ');

export interface SecurityHeaderOptions {
  /**
   * True only in production. It gates the ONE header that must never be sent in
   * development: telling a browser to use https for a year is unrecoverable on a
   * machine that serves this over plain http, and it would lock somebody out of
   * their own laptop.
   */
  https: boolean;
}

export function securityHeaders(options: SecurityHeaderOptions) {
  return function apply(
    _req: unknown,
    res: HeaderWritableResponse,
    next: () => void,
  ): void {
    // Do not advertise what this is built with. Free reconnaissance otherwise.
    res.removeHeader('X-Powered-By');

    // The two that close the uploaded-file attack.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', CONTENT_POLICY);

    // No framing, by the old header and the new one, because both are still read.
    res.setHeader('X-Frame-Options', 'DENY');

    // Never send this service's addresses to another site. An address can carry an
    // identifier, and an identifier is somebody's row.
    res.setHeader('Referrer-Policy', 'no-referrer');

    // A file served from here may not be pulled into another site's page.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

    // The old Flash and Acrobat cross-domain rules. Still honoured by some
    // readers, still worth refusing.
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    if (options.https) {
      // Production only. See the note on the option.
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  };
}
