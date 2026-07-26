import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AUDIT_ACTIONS, normalizeEmail } from './admin.constants';
import type { AuthenticatedStaff, StaffSession } from './staff.types';
import { StaffTokenService } from './staff-token.service';

/**
 * Staff login (email + password) and principal reads.
 *
 * Every rejection path — unknown email, wrong password, disabled account —
 * returns ONE generic 401, so the endpoint can't be used to enumerate which
 * staff emails exist or which are disabled. A successful login stamps
 * lastLoginAt and writes a STAFF_LOGIN audit row.
 */
@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: StaffTokenService,
    private readonly audit: AdminAuditService,
  ) {}

  async login(email: string, password: string): Promise<StaffSession> {
    const invalid = (): never => {
      throw new UnauthorizedException('Invalid credentials');
    };

    const staff = await this.prisma.staffUser.findUnique({
      where: { email: normalizeEmail(email) },
    });
    // Verify against a real hash whether or not the account exists, so response
    // timing doesn't reveal which emails are registered.
    const hash = staff?.passwordHash ?? DUMMY_ARGON2_HASH;
    const ok = await argon2.verify(hash, password).catch(() => false);

    if (!staff || !ok || staff.status !== 'ACTIVE') return invalid();

    await this.prisma.staffUser.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.STAFF_LOGIN,
    });

    this.logger.log(`staff login succeeded for ${staff.email}`);
    return this.tokens.issueSession(staff);
  }

  /** Fresh read of the authenticated staff member (reflects current status). */
  async getMe(staffId: string): Promise<AuthenticatedStaff> {
    const staff = await this.prisma.staffUser.findUnique({
      where: { id: staffId },
    });
    if (!staff || staff.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }
    return { id: staff.id, email: staff.email, role: staff.role };
  }
}

/**
 * A fixed argon2 hash of a random string, used to spend the same verification
 * cost on unknown emails as on real ones (timing-attack mitigation). It never
 * matches any real password.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$DncsjtvdpL2imQvH+SW9YQ$Vkgtm6HSrptTy/MCIjeg/eqBLisC23BGZXHnH4Reaok';
