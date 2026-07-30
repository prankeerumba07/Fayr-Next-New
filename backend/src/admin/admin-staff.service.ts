import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AUDIT_ACTIONS, normalizeEmail } from './admin.constants';
import type { CreateStaffDto } from './dto/create-staff.dto';
import type { UpdateStaffDto } from './dto/update-staff.dto';
import { toStaffResponse, type StaffResponse } from './staff.response';

/**
 * Staff-account management (ADMIN only). Creates accounts, lists them, and
 * changes role/status — this is how the new FINANCE/OPERATIONS roles get
 * assigned. Every write is audited. A guard rail prevents removing the last
 * active ADMIN, so the back office can never be locked out of itself.
 */
@Injectable()
export class AdminStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  /** All staff accounts, oldest first. Never includes the password hash. */
  async list(): Promise<StaffResponse[]> {
    const rows = await this.prisma.staffUser.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toStaffResponse);
  }

  async create(
    actingStaffId: string,
    dto: CreateStaffDto,
  ): Promise<StaffResponse> {
    const email = normalizeEmail(dto.email);
    const passwordHash = await argon2.hash(dto.password);
    try {
      const staff = await this.prisma.staffUser.create({
        data: { email, name: dto.name.trim(), role: dto.role, passwordHash },
      });
      await this.audit.record({
        staffUserId: actingStaffId,
        action: AUDIT_ACTIONS.STAFF_CREATE,
        metadata: { staffUserId: staff.id, email, role: dto.role },
      });
      return toStaffResponse(staff);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'A staff account with that email already exists',
        );
      }
      throw err;
    }
  }

  async update(
    actingStaffId: string,
    id: string,
    dto: UpdateStaffDto,
  ): Promise<StaffResponse> {
    if (dto.role === undefined && dto.status === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    const target = await this.prisma.staffUser.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Staff account not found');

    // Guard rail: never let a change strip away the last active ADMIN (which
    // would lock everyone out of the back office). Covers both demoting an admin
    // to a lesser role and disabling an admin — including yourself.
    const losesAdmin =
      target.role === 'ADMIN' &&
      ((dto.role !== undefined && dto.role !== 'ADMIN') ||
        dto.status === 'DISABLED');
    if (losesAdmin) {
      const activeAdmins = await this.prisma.staffUser.count({
        where: { role: 'ADMIN', status: 'ACTIVE' },
      });
      if (activeAdmins <= 1) {
        throw new ConflictException('Cannot remove the last active admin');
      }
    }

    const updated = await this.prisma.staffUser.update({
      where: { id },
      data: { role: dto.role, status: dto.status },
    });
    await this.audit.record({
      staffUserId: actingStaffId,
      action: AUDIT_ACTIONS.STAFF_UPDATE,
      metadata: {
        staffUserId: id,
        role: dto.role ?? null,
        status: dto.status ?? null,
      },
    });
    return toStaffResponse(updated);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
