import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toAuditEntry, type AuditListResponse } from './audit.response';

/** One recordable staff action. `targetUserId` is set when it concerns a user. */
export interface AuditInput {
  staffUserId: string;
  action: string;
  targetUserId?: string;
  metadata?: Prisma.InputJsonValue;
}

/** Read-side filter for the audit trail. All fields optional except the page. */
export interface AuditFilter {
  staffUserId?: string;
  targetUserId?: string;
  action?: string;
  limit: number;
  offset: number;
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

  /**
   * A page of the audit trail, newest first, with the acting staff embedded.
   * Undefined filters are ignored by Prisma, so an empty filter returns the whole
   * trail. `total` is the count IGNORING the page, for the caller's pager.
   */
  async list(filter: AuditFilter): Promise<AuditListResponse> {
    const where: Prisma.AdminAuditLogWhereInput = {
      staffUserId: filter.staffUserId,
      targetUserId: filter.targetUserId,
      action: filter.action,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        include: {
          staffUser: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
      }),
    ]);
    return {
      total,
      limit: filter.limit,
      offset: filter.offset,
      entries: rows.map(toAuditEntry),
    };
  }
}
