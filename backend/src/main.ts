import { resolve } from 'node:path';
import { Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { Env } from './config/env.validation';
import { UPLOADS_URL_PREFIX } from './storage/storage.service';

async function bootstrap(): Promise<void> {
  // `bufferLogs` holds early framework logs until the pino logger is installed,
  // so even boot-time messages come out structured (and in the right order).
  // The Express typing is needed for useStaticAssets (serving uploaded images).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Route ALL logging — framework internals included — through pino, so every
  // line is structured and carries the request id.
  app.useLogger(app.get(Logger));

  // Global request validation/shaping — shared with the e2e tests so both run
  // the identical pipeline (see app.setup.ts).
  configureApp(app);

  // Run onModuleDestroy / onApplicationShutdown hooks on SIGTERM/SIGINT, so the
  // process drains cleanly (DB pools, timers) instead of being hard-killed —
  // this is what lets a deploy roll over without dropping in-flight work.
  app.enableShutdownHooks();

  // `<Env, true>` tells ConfigService the env was validated, so `get(...)` is
  // typed and non-optional — no `undefined` config values leaking into runtime.
  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });

  // Serve operator-uploaded files (campaign images) as static assets under
  // /uploads, straight from the storage directory. Same root the StorageService
  // writes to; the shared UPLOADS_URL_PREFIX keeps the mount and the returned
  // URLs in lockstep. (In production these would move behind a CDN / object
  // store — the URL space stays the same, so clients don't change.)
  const uploadDir = resolve(
    process.cwd(),
    config.get('UPLOAD_DIR', { infer: true }),
  );
  app.useStaticAssets(uploadDir, { prefix: `${UPLOADS_URL_PREFIX}/` });

  // CORS for browser clients (the web prototype, a future web app). An explicit
  // allowlist wins everywhere; with none set, non-production reflects the request
  // origin for local convenience, while production stays closed (no cross-origin).
  const allowlist = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
  app.enableCors({
    origin: allowlist.length > 0 ? allowlist : !isProd,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Bind to 0.0.0.0 (all interfaces), not just loopback, so other devices on the
  // same network — e.g. a phone on the same hotspot — can reach the API, not only
  // the laptop itself.
  await app.listen(port, '0.0.0.0');
  app
    .get(Logger)
    .log(
      `Fayr backend listening on http://0.0.0.0:${port} (reachable at http://<this-machine-lan-ip>:${port})`,
      'Bootstrap',
    );
}

// Any failure to boot must exit non-zero AND LOUD, never a silent half-start that
// a health check would then report as "down" with no reason anywhere.
//
// That promise was broken, and this is how: the app boots with `bufferLogs`, then
// swaps in pino, which writes through an ASYNCHRONOUS transport. `process.exit(1)`
// kills the process before that transport flushes, so the message below was
// composed, logged, and lost — a bare exit code and not one line to say why.
//
// Found the hard way, with the database down: ten minutes went on a silent exit 1
// that "Can't reach database server at localhost:5432" would have answered in one.
// On the morning of a demo that is the whole difference.
//
// So the reason goes to stderr FIRST, synchronously, where nothing can buffer or
// drop it — and then through the logger as well, for whatever is collecting
// structured logs when there is time to flush them.
bootstrap().catch((err) => {
  const reason = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  process.stderr.write(
    `\nFayr backend failed to start: ${reason}\n${stack ?? ''}\n`,
  );
  NestLogger.error(`Fatal error during bootstrap: ${reason}`, stack, 'Bootstrap');
  process.exit(1);
});
