import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface FakeRes {
  statusCode: number;
  body: Record<string, unknown> | undefined;
  status(code: number): FakeRes;
  json(b: Record<string, unknown>): FakeRes;
}

function makeRes(): FakeRes {
  return {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: Record<string, unknown>) {
      this.body = b;
      return this;
    },
  };
}

function makeHost(req: unknown, res: unknown): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  let logger: { setContext: jest.Mock; error: jest.Mock };
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    logger = { setContext: jest.fn(), error: jest.fn() };
    filter = new AllExceptionsFilter(logger as never);
  });

  it('passes an HttpException through and stamps the request id', () => {
    const res = makeRes();
    filter.catch(
      new BadRequestException(['mobile must be E.164']),
      makeHost({ id: 'req-1', url: '/auth/otp/request', method: 'POST' }, res),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: ['mobile must be E.164'],
      requestId: 'req-1',
      path: '/auth/otp/request',
    });
    expect(typeof res.body?.timestamp).toBe('string');
    // A handled error must NOT log a stack.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('preserves extra fields on a custom HttpException (resendInSeconds)', () => {
    const res = makeRes();
    filter.catch(
      new HttpException(
        { message: 'wait', resendInSeconds: 42 },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      makeHost({ id: 'req-2', url: '/auth/otp/request' }, res),
    );

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'wait',
      resendInSeconds: 42,
      requestId: 'req-2',
    });
  });

  it('maps an unexpected error to a generic 500 and never leaks internals', () => {
    const res = makeRes();
    filter.catch(
      new Error('connection failed to secret-db-host:5432'),
      makeHost({ id: 'req-3', url: '/boom', method: 'GET' }, res),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body?.message).toBe('Internal server error');
    expect(res.body?.error).toBe('Internal Server Error');
    // The infra detail from the thrown error must not appear in the response.
    expect(JSON.stringify(res.body)).not.toContain('secret-db-host');

    // ...but it IS logged server-side, with the request id, for diagnosis.
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logObj] = logger.error.mock.calls[0] as [
      { err: unknown; requestId: string },
    ];
    expect(logObj.err).toBeInstanceOf(Error);
    expect(logObj.requestId).toBe('req-3');
  });
});
