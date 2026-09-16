import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PayoutMethod, type Withdrawal } from '@prisma/client';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import { rupeesOf } from '../common/rupees';
import { PrismaService } from '../prisma/prisma.service';
import { TicketService } from '../tickets/ticket.service';
import { WalletService } from '../wallet/wallet.service';
import {
  ACCOUNT_REGEX,
  IFSC_REGEX,
  MIN_WITHDRAWAL_PAISE,
  PAN_REGEX,
  UPI_REGEX,
  normalizeAccount,
  normalizeIfsc,
  normalizePan,
  normalizeUpi,
  withdrawalKey,
} from './withdrawal.constants';

/** Input for adding a payout destination (already shape-validated by the DTO). */
export interface AddPayoutMethodInput {
  type: 'UPI' | 'BANK';
  pan: string;
  upiId?: string;
  bankAccount?: string;
  ifsc?: string;
  accountName?: string;
}

/** The validated, normalized instrument columns for a payout method row. */
type InstrumentData =
  | { type: 'UPI'; upiId: string }
  | { type: 'BANK'; bankAccount: string; ifsc: string; accountName: string };

/**
 * The withdrawal / cash-out domain.
 *
 * Money leaves the user's wallet at REQUEST time (reserve: USER → PAYOUT), so an
 * available balance can never be withdrawn twice; a REJECTED/FAILED withdrawal
 * reverses that leg. PAID confirms the external disbursement (records the UTR)
 * and grants the +10 completion tickets for every fully-completed task. Fraud
 * loophole 1 is enforced here: one PAN per user (anchor) and cross-user UPI/bank
 * dedup.
 */
@Injectable()
export class WithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly tickets: TicketService,
    private readonly audit: AdminAuditService,
  ) {}

  // ── Payout methods ─────────────────────────────────────────────────────────

  async addPayoutMethod(
    userId: string,
    input: AddPayoutMethodInput,
  ): Promise<PayoutMethod> {
    const pan = normalizePan(input.pan);
    if (!PAN_REGEX.test(pan)) throw new BadRequestException('Invalid PAN');

    // PAN anchoring (fraud loophole 1): a PAN belongs to exactly one account, and
    // a user can't switch the PAN once anchored.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.pan && user.pan !== pan) {
      throw new ConflictException(
        'A different PAN is already linked to this account',
      );
    }
    const panOwner = await this.prisma.user.findUnique({ where: { pan } });
    if (panOwner && panOwner.id !== userId) {
      throw new ConflictException(
        'This PAN is already linked to another account',
      );
    }

    const data = await this.buildInstrument(userId, input);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Anchor the PAN (idempotent; the unique index is the hard backstop).
        await tx.user.update({ where: { id: userId }, data: { pan } });
        return tx.payoutMethod.create({ data: { userId, ...data } });
      });
    } catch (err) {
      // Lost the race to anchor this PAN to another account.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'This PAN is already linked to another account',
        );
      }
      throw err;
    }
  }

  /** Validate the instrument and enforce cross-user dedup for its identifier. */
  private async buildInstrument(
    userId: string,
    input: AddPayoutMethodInput,
  ): Promise<InstrumentData> {
    if (input.type === 'UPI') {
      const upiId = normalizeUpi(input.upiId ?? '');
      if (!UPI_REGEX.test(upiId))
        throw new BadRequestException('Invalid UPI ID');
      const clash = await this.prisma.payoutMethod.findFirst({
        where: { upiId, status: 'ACTIVE', userId: { not: userId } },
      });
      if (clash) throw new ConflictException('This UPI ID is already in use');
      return { type: 'UPI', upiId };
    }

    const bankAccount = normalizeAccount(input.bankAccount ?? '');
    const ifsc = normalizeIfsc(input.ifsc ?? '');
    const accountName = (input.accountName ?? '').trim();
    if (!ACCOUNT_REGEX.test(bankAccount)) {
      throw new BadRequestException('Invalid bank account number');
    }
    if (!IFSC_REGEX.test(ifsc)) throw new BadRequestException('Invalid IFSC');
    if (!accountName) {
      throw new BadRequestException('Account holder name is required');
    }
    const clash = await this.prisma.payoutMethod.findFirst({
      where: { bankAccount, ifsc, status: 'ACTIVE', userId: { not: userId } },
    });
    if (clash)
      throw new ConflictException('This bank account is already in use');
    return { type: 'BANK', bankAccount, ifsc, accountName };
  }

  listPayoutMethods(userId: string): Promise<PayoutMethod[]> {
    return this.prisma.payoutMethod.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Withdrawals (user) ───────────────────────────────────────────────────────

  async requestWithdrawal(
    userId: string,
    amountPaise: bigint,
    payoutMethodId: string,
  ): Promise<Withdrawal> {
    if (amountPaise <= 0n) {
      throw new BadRequestException('Enter an amount to withdraw.');
    }
    if (amountPaise < MIN_WITHDRAWAL_PAISE) {
      // In RUPEES. This read "Minimum withdrawal is 10000 paise" — a first-time
      // user does not think in paise and cannot tell 10000 paise from ₹10,000.
      // Every figure the ledger holds is paise; every figure a person reads is
      // rupees, and the conversion belongs at the boundary, here.
      throw new BadRequestException(
        `You need at least ${rupeesOf(MIN_WITHDRAWAL_PAISE)} in your wallet to withdraw.`,
      );
    }
    const method = await this.prisma.payoutMethod.findFirst({
      where: { id: payoutMethodId, userId, status: 'ACTIVE' },
    });
    if (!method) throw new NotFoundException('Payout method not found');

    return this.prisma.$transaction(async (tx) => {
      // Serialize this user's withdrawals so two concurrent requests can't both
      // pass the balance check and overdraw the wallet.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;

      const balance = await this.wallet.getUserBalance(userId, tx);
      if (balance < amountPaise) {
        throw new ConflictException(
          `You have ${rupeesOf(balance)} in your wallet, so ${rupeesOf(amountPaise)} cannot be withdrawn.`,
        );
      }

      const w = await tx.withdrawal.create({
        data: { userId, payoutMethodId, amountPaise, status: 'REQUESTED' },
      });
      const reserve = await this.wallet.postWithdrawal(
        {
          userId,
          amountPaise,
          idempotencyKey: withdrawalKey.reserve(w.id),
          referenceType: 'withdrawal',
          referenceId: w.id,
          memo: 'withdrawal reserve',
        },
        tx,
      );
      return tx.withdrawal.update({
        where: { id: w.id },
        data: { reserveTxnId: reserve.id },
      });
    });
  }

  listForUser(userId: string): Promise<Withdrawal[]> {
    return this.prisma.withdrawal.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async getForUser(userId: string, id: string): Promise<Withdrawal> {
    const w = await this.prisma.withdrawal.findFirst({ where: { id, userId } });
    if (!w) throw new NotFoundException('Withdrawal not found');
    return w;
  }

  // ── Withdrawals (staff) ──────────────────────────────────────────────────────

  listAll(status?: Withdrawal['status']) {
    return this.prisma.withdrawal.findMany({
      where: status ? { status } : {},
      include: { user: true, payoutMethod: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * WHAT A CASH-OUT IS DRAWN FROM, for the staff member deciding it.
   *
   * ── WHY THE QUEUE NEEDED THIS ────────────────────────────────────────────
   *
   * A withdrawal row has a userId, a payout method and an amount, and no link to
   * a task or a campaign anywhere in the schema. So the queue could show the
   * amount and nothing behind it, and a figure with nothing behind it invites
   * being read as something it is not — the owner read ₹100.00 on a queue card
   * beside a ₹938.00 order and took it for the refund. It is not: it is a
   * request to move ₹100.00 out of a wallet, and on the practice account it is
   * ₹100.00 because the demo seed asks for exactly the minimum
   * (MIN_WITHDRAWAL_PAISE, demo-seed.ts) and for no other reason.
   *
   * SO THE BASIS IS THE WALLET, because the wallet is what a withdrawal is
   * actually drawn from. The balance now, and how much of it arrived as refunds.
   *
   * READ-ONLY, AND IT DECIDES NOTHING. Nothing here reserves, approves, posts or
   * changes a single ledger entry — requestWithdrawal already holds the only
   * rule about whether there is enough, and it still holds it. This is the queue
   * being able to say where the money came from.
   */
  async basisFor(userId: string): Promise<{
    walletBalancePaise: bigint;
    refundsPaise: bigint;
    howManyRefunds: number;
  }> {
    const statement = await this.wallet.getUserStatement(userId);
    // ── REFUNDS ONLY, AND THE KIND IS WHAT DOES THE WORK ──────────────────
    //
    // A withdrawal's own legs sit on this same account and are negative.
    // Counting them would net a paid-out refund back towards nothing and tell a
    // staff member the money had never been there — which is precisely the
    // question they are looking at this card to answer.
    //
    // AND NO SIGN TEST BESIDE IT, deliberately. A first writing filtered
    // `amountPaise > 0n` as well; it is unreachable, because postRefund is the
    // only thing in Fayr that writes a REFUND transaction, it asserts a positive
    // amount, and it credits the user while debiting HOUSE
    // (wallet.service.ts:166-186). Worse, it would be WRONG the day a clawback
    // exists — CLAUDE.md's own fraud model contemplates one — because a
    // reclaimed refund genuinely belongs in this total as a subtraction. Dead
    // today and wrong tomorrow is not a guard.
    const refunds = statement.entries.filter(
      (e) => e.transaction.kind === 'REFUND',
    );
    return {
      walletBalancePaise: statement.balancePaise,
      refundsPaise: refunds.reduce((sum, e) => sum + e.amountPaise, 0n),
      howManyRefunds: refunds.length,
    };
  }

  async getByIdWithContext(id: string) {
    const w = await this.prisma.withdrawal.findUnique({
      where: { id },
      include: { user: true, payoutMethod: true },
    });
    if (!w) throw new NotFoundException('Withdrawal not found');
    return w;
  }

  async approve(staffId: string, id: string): Promise<Withdrawal> {
    const w = await this.getById(id);
    if (w.status !== 'REQUESTED') {
      throw new ConflictException(
        'Only a requested withdrawal can be approved',
      );
    }
    // One transaction for the status change AND its audit row. The other staff
    // actions record after the fact, best-effort; a payout decision should not be
    // able to land without its trail, because the trail is the only place the
    // decision is explained. A failed audit insert rolls the approval back, which
    // leaves the withdrawal REQUESTED and the retry perfectly safe.
    return this.prisma.$transaction(async (tx) => {
      const approved = await tx.withdrawal.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedByStaffId: staffId,
          decidedAt: new Date(),
        },
      });
      await this.recordDecision(
        tx,
        staffId,
        w,
        AUDIT_ACTIONS.WITHDRAWAL_APPROVE,
        {},
      );
      return approved;
    });
  }

  async reject(
    staffId: string,
    id: string,
    reason: string,
  ): Promise<Withdrawal> {
    const w = await this.getById(id);
    if (w.status !== 'REQUESTED' && w.status !== 'APPROVED') {
      throw new ConflictException('This withdrawal can no longer be rejected');
    }
    return this.reverseAndClose(staffId, w, 'REJECTED', reason);
  }

  async markFailed(
    staffId: string,
    id: string,
    reason: string,
  ): Promise<Withdrawal> {
    const w = await this.getById(id);
    if (w.status !== 'APPROVED') {
      throw new ConflictException(
        'Only an approved withdrawal can be marked failed',
      );
    }
    return this.reverseAndClose(staffId, w, 'FAILED', reason);
  }

  async markPaid(
    staffId: string,
    id: string,
    utr: string,
  ): Promise<Withdrawal> {
    const w = await this.getById(id);
    if (w.status !== 'APPROVED') {
      throw new ConflictException(
        'Only an approved withdrawal can be marked paid',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const paid = await tx.withdrawal.update({
        where: { id },
        data: {
          status: 'PAID',
          utr,
          decidedByStaffId: staffId,
          decidedAt: new Date(),
        },
      });
      await this.recordDecision(
        tx,
        staffId,
        w,
        AUDIT_ACTIONS.WITHDRAWAL_MARK_PAID,
        // The UTR is the ONLY link between a row in this database and money that
        // actually left a bank. It goes in the trail, not just on the row it
        // overwrites.
        { utr },
      );
      // The +10 completion grant: once the user has cashed out, every fully-
      // completed (REFUNDED) task earns its completion tickets. grantCompletion is
      // idempotent per task, so this lands exactly once per task across withdrawals.
      const refunded = await tx.task.findMany({
        where: { userId: w.userId, state: 'REFUNDED' },
        select: { id: true },
      });
      for (const t of refunded) {
        await this.tickets.grantCompletion(w.userId, t.id, tx);
      }
      return paid;
    });
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /**
   * The audit row for one payout decision.
   *
   * Every decision records the same four things — WHICH withdrawal, HOW MUCH,
   * what it moved FROM, and (where there is one) the UTR — because "who approved
   * this" is unanswerable without them. `previousStatus` is what makes a decision
   * legible months later: APPROVED→FAILED and REQUESTED→REJECTED are different
   * events, and only the withdrawal's CURRENT status survives on the row.
   *
   * amountPaise is a STRING: paise are bigint everywhere in this system, and a
   * bigint in JSON metadata does not store a wrong number, it throws at the Prisma
   * boundary and 500s the whole decision. The figure is copied from the same row
   * the decision was made against — an audit row records what was true when the
   * person acted, which is the one place a snapshot is the right answer.
   */
  private async recordDecision(
    tx: Prisma.TransactionClient,
    staffId: string,
    w: Withdrawal,
    action: string,
    extra: Record<string, string | null>,
  ): Promise<void> {
    await this.audit.record(
      {
        staffUserId: staffId,
        action,
        targetUserId: w.userId,
        metadata: {
          withdrawalId: w.id,
          amountPaise: w.amountPaise.toString(),
          previousStatus: w.status,
          ...extra,
        },
      },
      tx,
    );
  }

  private async getById(id: string): Promise<Withdrawal> {
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('Withdrawal not found');
    return w;
  }

  private async reverseAndClose(
    staffId: string,
    w: Withdrawal,
    status: 'REJECTED' | 'FAILED',
    reason: string,
  ): Promise<Withdrawal> {
    return this.prisma.$transaction(async (tx) => {
      await this.wallet.postWithdrawalReversal(
        {
          userId: w.userId,
          amountPaise: w.amountPaise,
          idempotencyKey: withdrawalKey.reversal(w.id),
          referenceType: 'withdrawal',
          referenceId: w.id,
          memo: `withdrawal ${status.toLowerCase()}`,
        },
        tx,
      );
      const reversal = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey: withdrawalKey.reversal(w.id) },
        select: { id: true },
      });
      await this.recordDecision(
        tx,
        staffId,
        w,
        status === 'REJECTED'
          ? AUDIT_ACTIONS.WITHDRAWAL_REJECT
          : AUDIT_ACTIONS.WITHDRAWAL_MARK_FAILED,
        // reversalTxnId names the ledger movement that put the money back, so the
        // trail and the ledger can be read against each other rather than taken on
        // trust separately.
        { reason, reversalTxnId: reversal?.id ?? null },
      );
      return tx.withdrawal.update({
        where: { id: w.id },
        data: {
          status,
          failureReason: reason,
          reversalTxnId: reversal?.id,
          decidedByStaffId: staffId,
          decidedAt: new Date(),
        },
      });
    });
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
