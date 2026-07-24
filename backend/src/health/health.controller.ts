import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Two distinct probes, on purpose:
 *
 *  - GET /health        LIVENESS. Dependency-free — answers even when the DB is
 *                       down, so infra can tell "process alive" from "unhealthy"
 *                       and doesn't kill a pod that's merely waiting on the DB.
 *  - GET /health/ready  READINESS. Confirms the database is reachable. Returns
 *                       503 (not a crash) when it isn't, so a load balancer can
 *                       route away until it recovers.
 */
// Health probes are polled continuously by infra from a small set of IPs —
// rate-limiting them would starve the very checks that keep the service in
// rotation. Exempt the whole controller from the global throttler.
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check(): {
    status: 'ok';
    service: string;
    uptimeSeconds: number;
    timestamp: string;
  } {
    return {
      status: 'ok',
      service: 'fayr-backend',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ready'; db: 'up'; timestamp: string }> {
    try {
      // Cheapest possible round-trip that proves the connection is live.
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', db: 'up', timestamp: new Date().toISOString() };
    } catch (err) {
      // Log the REAL cause server-side for whoever is on call...
      this.logger.error(
        `Readiness check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // ...but return a GENERIC reason to the caller. A probe response must not
      // leak infra details (DB host/port, driver internals). 503, never a 500.
      throw new ServiceUnavailableException({
        status: 'not_ready',
        db: 'down',
        reason: 'database unreachable',
      });
    }
  }
}
