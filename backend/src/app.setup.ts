import { INestApplication, ValidationPipe } from '@nestjs/common';

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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
