import type { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import { stdSerializers } from 'pino-http';
import type { Env } from '../config/env.validation';

/**
 * Structured-logging configuration for the whole app.
 *
 *  - Every request gets a request id: an inbound `x-request-id` is honored (so a
 *    trace survives across services/a gateway), otherwise a UUID is minted. It's
 *    echoed back in the response header and stamped on every log line for that
 *    request, so a user-reported error maps to exact server logs.
 *  - Log level tracks outcome: 5xx/errors → error, 4xx → warn, else info.
 *  - Secrets are redacted: the Authorization and Cookie headers never reach the
 *    logs. (Request bodies aren't logged at all, so OTP codes/refresh tokens
 *    can't leak through here.)
 *  - Production emits JSON (one line per request, machine-queryable); dev pipes
 *    through pino-pretty for readability.
 */
export function buildLoggerOptions(config: ConfigService<Env, true>): Params {
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const isProd = nodeEnv === 'production';
  const isDev = nodeEnv === 'development';

  return {
    pinoHttp: {
      // Quiet during tests; verbose in dev; production stays at info.
      level: isProd ? 'info' : isDev ? 'debug' : 'silent',

      genReqId: (req: IncomingMessage, res: ServerResponse): string => {
        const incoming = req.headers['x-request-id'];
        const id =
          (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },

      customLogLevel: (
        _req: IncomingMessage,
        res: ServerResponse,
        err?: Error,
      ): 'info' | 'warn' | 'error' => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },

      customProps: (req: IncomingMessage) => ({
        requestId: (req as IncomingMessage & { id?: string }).id,
      }),

      /**
       * NOTHING FROM A WEB ADDRESS'S QUERY STRING REACHES THE LOG.
       *
       * Found by reading the real log rather than the code, and it took two goes.
       * Redacting `req.query` removed the parsed copy, and the number was still
       * there — because the logged `url` carries the query string too. So the
       * address is cut at the question mark, which keeps the useful half (which
       * endpoint) and drops the half that can carry somebody's mobile number.
       *
       * Wrapping pino-http's own serializer rather than replacing it, so every
       * other field a log is read for stays exactly as it was.
       */
      serializers: {
        req(request: unknown) {
          const serialized = stdSerializers.req(
            request as Parameters<typeof stdSerializers.req>[0],
          );
          const url = serialized.url;
          return {
            ...serialized,
            url: typeof url === 'string' ? url.split('?')[0] : url,
          };
        },
      },

      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          // THE QUERY STRING, ENTIRELY. Found by reading the real log rather than
          // the code: pino logs the parsed query on every request, so a staff
          // search for a person by mobile number wrote that number into the
          // application log, where it stays for as long as logs are kept. Redacted
          // wholesale rather than field by field, because the next endpoint to take
          // something personal in a query string will not come back here first.
          //
          // The url itself is still logged, which is what makes a log useful. The
          // rule that keeps that safe is separate and stated in the security
          // report: nothing personal may travel in a web address.
          'req.query',
        ],
        remove: true,
      },

      // Pretty output only in dev. In prod/test the transport is left undefined
      // (plain JSON to stdout) — and crucially, no pino-pretty worker thread is
      // spawned, which keeps Jest free of lingering open handles.
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:standard' },
          }
        : undefined,
    },
  };
}
