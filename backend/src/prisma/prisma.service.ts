import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The database gateway. Every module injects THIS (never a bare PrismaClient),
 * so connection lifecycle and logging live in one place.
 *
 * It connects on module init and disconnects on shutdown. If the database is
 * unreachable at boot the connection throws and the process exits — a loud,
 * fast failure the orchestrator can restart, rather than a server that accepts
 * traffic it can't serve. Post-boot database loss is caught separately by the
 * readiness probe (GET /health/ready), which reports 503 without crashing.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from PostgreSQL');
  }
}
