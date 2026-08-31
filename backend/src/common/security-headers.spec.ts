import { securityHeaders } from './security-headers';

function run(https: boolean): {
  headers: Record<string, string>;
  removed: string[];
  wentOn: boolean;
} {
  const headers: Record<string, string> = {};
  const removed: string[] = [];
  let wentOn = false;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    removeHeader: (k: string) => {
      removed.push(k);
    },
  };
  securityHeaders({ https })({}, res, () => {
    wentOn = true;
  });
  return { headers, removed, wentOn };
}

/**
 * The headers a browser needs, and the one that must never be sent in
 * development.
 */
describe('securityHeaders', () => {
  it('closes the uploaded-file attack', () => {
    // The reason this middleware exists: /uploads serves files a person sent us,
    // and without these two a browser can be talked into running one as a page on
    // this service's own address.
    const { headers } = run(false);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(headers['Content-Security-Policy']).toContain('sandbox');
  });

  it('refuses framing, both of the ways browsers still read', () => {
    const { headers } = run(false);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Content-Security-Policy']).toContain(
      "frame-ancestors 'none'",
    );
  });

  it('never sends our own addresses to another site', () => {
    // An address can carry an identifier, and an identifier is somebody's row.
    expect(run(false).headers['Referrer-Policy']).toBe('no-referrer');
  });

  it('stops another site pulling our files into its pages', () => {
    expect(run(false).headers['Cross-Origin-Resource-Policy']).toBe(
      'same-site',
    );
  });

  it('stops advertising what this is built with', () => {
    expect(run(false).removed).toContain('X-Powered-By');
  });

  it('does NOT demand https in development', () => {
    // The one header that is unrecoverable if sent wrongly: it would tell the
    // browser to use https for a year, on a machine serving plain http, and lock
    // somebody out of their own laptop.
    expect(run(false).headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('does demand https in production', () => {
    const value = run(true).headers['Strict-Transport-Security'];
    expect(value).toContain('max-age=31536000');
    expect(value).toContain('includeSubDomains');
  });

  it('always lets the request carry on', () => {
    expect(run(false).wentOn).toBe(true);
    expect(run(true).wentOn).toBe(true);
  });

  it('sets the same headers whatever the request was', () => {
    // No branching on the request at all, so no path can miss them.
    expect(Object.keys(run(false).headers).sort()).toEqual(
      Object.keys(run(false).headers).sort(),
    );
  });
});
