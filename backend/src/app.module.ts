import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * The application root. Feature modules are registered here as we build them.
 *
 * ConfigModule is global (every module can inject ConfigService without
 * re-importing) and validates the environment at boot via `validateEnv`, so the
 * app cannot start with invalid configuration.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // `.env` is loaded automatically in dev; in production, config comes from
      // real environment variables injected by the platform.
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
