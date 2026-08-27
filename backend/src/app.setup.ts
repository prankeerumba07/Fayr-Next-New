import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { securityHeaders } from './common/security-headers';

/**
 * Request-handling configuration shared by the real server (main.ts) and the
 * e2e tests, so both exercise the exact same pipeline. Anything that changes how
 * a request is validated or shaped belongs here — never inline in main.ts — or
 * the tests would stop reflecting production behavior.
 *
 * (The exception filter, throttler, and logger are wired inside AppModule, so
 * they apply automatically wherever AppModule is used.)
 */
export function configureApp(app: INestApplication): void {
  // Security headers FIRST, so nothing can answer before they are set — including
  // the static /uploads mount, which serves files a person sent us. Here rather
  // than in main.ts for the reason above: the e2e suite has to see them too, or
  // the tests stop describing the real service.
  //
  // The one header that differs between a laptop and production is gated on
  // NODE_ENV explicitly. See security-headers.ts for why that one is dangerous to
  // get wrong.
  app.use(
    securityHeaders({ https: process.env.NODE_ENV === 'production' }),
  );
  // Belt as well as braces: Express adds this header itself, before any
  // middleware of ours could remove it on a path we forgot.
  (app as NestExpressApplication).disable?.('x-powered-by');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
