import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PayoutMethod, type Withdrawal } from '@prisma/client';
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
    return this.prisma.withdrawal.update({
      where: { id },
      data: {
        status: 'APPROVED',
        decidedByStaffId: staffId,
        decidedAt: new Date(),
      },
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
