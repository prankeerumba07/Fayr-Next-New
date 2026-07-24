import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

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
  Logger.log(`Fayr backend listening on http://localhost:${port}`, 'Bootstrap');
}

// Any failure to boot must exit non-zero and loud, never a silent half-start
// that a health check would then report as "down" with no reason in the logs.
bootstrap().catch((err) => {
  Logger.error(
    `Fatal error during bootstrap: ${err instanceof Error ? err.message : String(err)}`,
    err instanceof Error ? err.stack : undefined,
    'Bootstrap',
  );
  process.exit(1);
});
