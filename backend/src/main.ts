import { Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  // `bufferLogs` holds early framework logs until the pino logger is installed,
  // so even boot-time messages come out structured (and in the right order).
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Route ALL logging — framework internals included — through pino, so every
  // line is structured and carries the request id.
  app.useLogger(app.get(Logger));

  // Validate and shape every request body against its DTO before it reaches a
  // handler. `whitelist` strips unknown properties, `forbidNonWhitelisted`
  // rejects them outright, and `transform` produces real DTO instances — so a
  // handler never sees an unvalidated or unexpected shape.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Run onModuleDestroy / onApplicationShutdown hooks on SIGTERM/SIGINT, so the
  // process drains cleanly (DB pools, timers) instead of being hard-killed —
  // this is what lets a deploy roll over without dropping in-flight work.
  app.enableShutdownHooks();

  // `<Env, true>` tells ConfigService the env was validated, so `get(...)` is
  // typed and non-optional — no `undefined` config values leaking into runtime.
  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });

  await app.listen(port);
  app
    .get(Logger)
    .log(`Fayr backend listening on http://localhost:${port}`, 'Bootstrap');
}

// Any failure to boot must exit non-zero and loud, never a silent half-start
// that a health check would then report as "down" with no reason in the logs.
// This runs before/around the pino logger is available, so use the plain Nest
// logger here as a last-resort channel.
bootstrap().catch((err) => {
  NestLogger.error(
    `Fatal error during bootstrap: ${err instanceof Error ? err.message : String(err)}`,
    err instanceof Error ? err.stack : undefined,
    'Bootstrap',
  );
  process.exit(1);
});
