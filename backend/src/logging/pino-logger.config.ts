import type { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
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
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  return {
    pinoHttp: {
      level: isProd ? 'info' : 'debug',

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

      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        remove: true,
      },

      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:standard' },
          },
    },
  };
}
