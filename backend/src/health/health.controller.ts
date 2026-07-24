import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
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
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

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
      // 503, with a reason — never an unhandled 500. The load balancer reads the
      // status code; the reason helps whoever is on call.
      throw new ServiceUnavailableException({
        status: 'not_ready',
        db: 'down',
        reason: err instanceof Error ? err.message : 'database unreachable',
      });
    }
  }
}
