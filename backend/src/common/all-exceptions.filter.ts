import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/** The minimal response surface the filter needs — avoids a hard express dep. */
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): unknown;
}

/** The minimal request surface the filter reads. `id` is set by pino-http. */
interface RequestLike {
  id?: string;
  url?: string;
  method?: string;
}

/** Standard reason phrases, so every error body has a stable `error` label. */
const REASON: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/**
 * The single place every unhandled error becomes an HTTP response.
 *
 * Guarantees:
 *  - ONE consistent JSON shape for all errors:
 *    { statusCode, error, message, ...extra, requestId, timestamp, path }.
 *  - Deliberate HttpExceptions (validation, auth, throttle, readiness) pass
 *    through with their status, message, and any extra fields intact.
 *  - Anything else is a 500 with a GENERIC message — no stack, no driver detail,
 *    no infra internals ever reach the client. The real error (with stack) is
 *    logged server-side against the requestId so it's still fully diagnosable.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('ExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<ResponseLike>();
    const req = ctx.getRequest<RequestLike>();
    const requestId = req.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = REASON[status];
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      error = REASON[status] ?? 'Error';
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (resp && typeof resp === 'object') {
        const {
          message: m,
          error: e,
          statusCode: _sc,
          ...rest
        } = resp as Record<string, unknown>;
        message = (m as string | string[] | undefined) ?? exception.message;
        if (typeof e === 'string') error = e;
        extra = rest;
      }
    } else {
      // The ONLY path that carries a stack to the logs — a genuinely unexpected
      // error. Everything the client sees below is generic.
      this.logger.error(
        { err: exception, requestId, path: req.url, method: req.method },
        'Unhandled exception',
      );
    }

    res.status(status).json({
      statusCode: status,
      error,
      message,
      ...extra,
      requestId,
      timestamp: new Date().toISOString(),
      path: req.url,
    });
  }
}
