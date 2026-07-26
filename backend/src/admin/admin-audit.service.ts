import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** One recordable staff action. `targetUserId` is set when it concerns a user. */
export interface AuditInput {
  staffUserId: string;
  action: string;
  targetUserId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes the staff audit trail. Append-only by contract (the table is never
 * updated or deleted through the app), so this service only ever inserts.
 * Recording is best-effort relative to the action it accompanies: callers that
 * want the audit row and the effect to be atomic pass a transaction client.
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: AuditInput,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await db.adminAuditLog.create({
      data: {
        staffUserId: input.staffUserId,
        action: input.action,
        targetUserId: input.targetUserId,
        metadata: input.metadata,
      },
    });
  }
}
