import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaskService } from '../tasks/task.service';
import { TicketService } from '../tickets/ticket.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminAuditService } from './admin-audit.service';
import { AUDIT_ACTIONS } from './admin.constants';
import {
  toUserSummary,
  toUserView,
  type UserSummaryResponse,
  type UserViewResponse,
} from './user-view.response';

/**
 * The staff unified user view (2.2). Read-only: it AGGREGATES a user's data from
 * the domain services (never mutating any ledger), and records an audit row for
 * every access — this is financial + PII data, so who looked at whom is logged.
 *
 * The one lookup input is a MOBILE number (enforced E.164 at the DTO). Drilling
 * into the full view uses the opaque internal id returned by the search — the
 * human never types the Fayr display id.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly wallet: WalletService,
    private readonly tasks: TaskService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Exact search by mobile. Audits the attempt (hit or miss); 404 on a miss. */
  async searchByMobile(
    staffUserId: string,
    mobile: string,
  ): Promise<UserSummaryResponse> {
    const user = await this.prisma.user.findUnique({ where: { mobile } });

    await this.audit.record({
      staffUserId,
      action: AUDIT_ACTIONS.USER_SEARCH,
      targetUserId: user?.id,
      metadata: { mobile, found: user !== null },
    });

    if (!user) throw new NotFoundException('No user with that mobile number');

    const [ticketBalance, walletBalancePaise, taskCount] = await Promise.all([
      this.tickets.getBalance(user.id),
      this.wallet.getUserBalance(user.id),
      this.prisma.task.count({ where: { userId: user.id } }),
    ]);
    return toUserSummary(user, ticketBalance, walletBalancePaise, taskCount);
  }

  /** The full unified view for a user id (from search). Audits the access; 404 if gone. */
  async getUserView(
    staffUserId: string,
    userId: string,
  ): Promise<UserViewResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    await this.audit.record({
      staffUserId,
      action: AUDIT_ACTIONS.USER_VIEW,
      targetUserId: userId,
      metadata: { found: user !== null },
    });

    if (!user) throw new NotFoundException('User not found');

    const [ticketBalance, ticketEntries, statement, tasks] = await Promise.all([
      this.tickets.getBalance(userId),
      this.tickets.listEntries(userId),
      this.wallet.getUserStatement(userId),
      this.tasks.listForUser(userId),
    ]);
    return toUserView({ user, ticketBalance, ticketEntries, statement, tasks });
  }
}
