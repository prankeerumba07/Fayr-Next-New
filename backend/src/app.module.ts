import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * The application root. Feature modules are registered here as we build them.
 *
 * ConfigModule is global (every module can inject ConfigService without
 * re-importing) and validates the environment at boot via `validateEnv`, so the
 * app cannot start with invalid configuration.
 *
 * ThrottlerModule applies a coarse per-IP rate limit across every route as an
 * app-wide guard; individual endpoints tighten it with @Throttle, and the health
 * probes opt out with @SkipThrottle so infra polling is never rate-limited.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // `.env` is loaded automatically in dev; in production, config comes from
      // real environment variables injected by the platform.
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
