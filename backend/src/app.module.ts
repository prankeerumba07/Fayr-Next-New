import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CampaignModule } from './campaigns/campaign.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { buildLoggerOptions } from './logging/pino-logger.config';
import { MeModule } from './me/me.module';
import { OcrModule } from './ocr/ocr.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportModule } from './reports/report.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { CampaignHealthModule } from './campaign-health/campaign-health.module';
import { SupportModule } from './support/support.module';
import { TaskModule } from './tasks/task.module';
import { TicketModule } from './tickets/ticket.module';
import { WalletModule } from './wallet/wallet.module';
import { WithdrawalModule } from './withdrawals/withdrawal.module';

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
 *
 * LoggerModule (pino) provides structured request logging + request ids, and the
 * app-wide AllExceptionsFilter normalizes every error into one safe JSON shape.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // `.env` is loaded automatically in dev; in production, config comes from
      // real environment variables injected by the platform.
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildLoggerOptions,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
      // Rate limiting is disabled only under NODE_ENV=test, so the functional
      // e2e suite isn't throttled by cumulative requests. Every real environment
      // (development, production) always enforces it.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    WalletModule,
    TicketModule,
    CampaignModule,
    TaskModule,
    SchedulerModule,
    CampaignHealthModule,
    AdminModule,
    SupportModule,
    MeModule,
    WithdrawalModule,
    ReportModule,
    OcrModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
