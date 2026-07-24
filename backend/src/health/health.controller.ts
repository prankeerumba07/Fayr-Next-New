import { Controller, Get } from '@nestjs/common';

/**
 * Liveness endpoint for load balancers, uptime monitors, and a quick manual
 * "is it up?" check. Deliberately dependency-free: it must answer even when the
 * database or downstream services are down, so infra can tell "process alive"
 * apart from "process healthy". A DB-backed readiness probe comes in a later
 * step, kept as a SEPARATE endpoint for exactly that reason.
 */
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

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
}
