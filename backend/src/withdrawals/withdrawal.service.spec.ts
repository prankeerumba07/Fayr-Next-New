import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { WithdrawalService } from './withdrawal.service';

/**
 * Unit tests with Prisma, WalletService, and TicketService mocked. The mock
 * Prisma object doubles as the interactive-transaction client, so `$transaction`
 * just runs the callback against it.
 */

const USER = 'user-1';
const STAFF = 'staff-1';
const PAN = 'ABCDE1234F';

function makePrisma() {
  const prisma: any = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    payoutMethod: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    withdrawal: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    task: { findMany: jest.fn() },
    ledgerTransaction: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  // The callback form: run it against the same mock (acts as the tx client).
  prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  return prisma;
}

function makeWallet() {
  return {
    getUserBalance: jest.fn(),
    postWithdrawal: jest.fn().mockResolvedValue({ id: 'reserve-txn' }),
    postWithdrawalReversal: jest.fn().mockResolvedValue({ id: 'reversal-txn' }),
  };
}

function makeTickets() {
  return { grantCompletion: jest.fn().mockResolvedValue({}) };
}

function makeAudit() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

function build() {
  const prisma = makePrisma();
  const wallet = makeWallet();
  const tickets = makeTickets();
  const audit = makeAudit();
  const service = new WithdrawalService(
    prisma as never,
    wallet as never,
    tickets as never,
    audit as never,
  );
  return { service, prisma, wallet, tickets, audit };
}

describe('WithdrawalService', () => {
  describe('addPayoutMethod', () => {
    it('adds a UPI method and anchors the PAN', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: USER, pan: null }) // by id
        .mockResolvedValueOnce(null); // by pan (unowned)
      prisma.payoutMethod.findFirst.mockResolvedValue(null); // no UPI clash
      prisma.payoutMethod.create.mockResolvedValue({ id: 'pm-1' });

      const res = await service.addPayoutMethod(USER, {
        type: 'UPI',
        pan: 'abcde1234f',
        upiId: 'Ravi@OKAXIS',
      });

      expect(res).toEqual({ id: 'pm-1' });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: { pan: PAN },
      });
      // UPI is normalized (lowercased) before storage.
      expect(prisma.payoutMethod.create).toHaveBeenCalledWith({
        data: { userId: USER, type: 'UPI', upiId: 'ravi@okaxis' },
      });
    });

    it('rejects an invalid PAN', async () => {
      const { service } = build();
      await expect(
        service.addPayoutMethod(USER, {
          type: 'UPI',
          pan: 'BAD',
          upiId: 'a@b',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a PAN already anchored to another user', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: USER, pan: null })
        .mockResolvedValueOnce({ id: 'someone-else' }); // pan owned elsewhere
      await expect(
        service.addPayoutMethod(USER, {
          type: 'UPI',
          pan: PAN,
          upiId: 'ravi@okaxis',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a UPI id already in use by another user', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: USER, pan: null })
        .mockResolvedValueOnce(null);
      prisma.payoutMethod.findFirst.mockResolvedValue({ id: 'other-pm' }); // clash
      await expect(
        service.addPayoutMethod(USER, {
          type: 'UPI',
          pan: PAN,
          upiId: 'ravi@okaxis',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('validates bank fields (bad IFSC)', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: USER, pan: null })
        .mockResolvedValueOnce(null);
      await expect(
        service.addPayoutMethod(USER, {
          type: 'BANK',
          pan: PAN,
          bankAccount: '123456789',
          ifsc: 'nope',
          accountName: 'Ravi Kumar',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('requestWithdrawal', () => {
    const METHOD = 'pm-1';

    it('rejects an amount below the minimum', async () => {
      const { service } = build();
      await expect(
        service.requestWithdrawal(USER, 5_000n, METHOD),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when the payout method is not the user’s active one', async () => {
      const { service, prisma } = build();
      prisma.payoutMethod.findFirst.mockResolvedValue(null);
      await expect(
        service.requestWithdrawal(USER, 50_000n, METHOD),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects when the balance is insufficient', async () => {
      const { service, prisma, wallet } = build();
      prisma.payoutMethod.findFirst.mockResolvedValue({ id: METHOD });
      wallet.getUserBalance.mockResolvedValue(1_000n); // < amount
      await expect(
        service.requestWithdrawal(USER, 50_000n, METHOD),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(wallet.postWithdrawal).not.toHaveBeenCalled();
    });

    it('reserves funds (USER→PAYOUT) and links the reserve txn', async () => {
      const { service, prisma, wallet } = build();
      prisma.payoutMethod.findFirst.mockResolvedValue({ id: METHOD });
      wallet.getUserBalance.mockResolvedValue(200_000n);
      prisma.withdrawal.create.mockResolvedValue({
        id: 'w-1',
        status: 'REQUESTED',
      });
      prisma.withdrawal.update.mockResolvedValue({
        id: 'w-1',
        status: 'REQUESTED',
        reserveTxnId: 'reserve-txn',
      });

      const res = await service.requestWithdrawal(USER, 50_000n, METHOD);

      expect(wallet.postWithdrawal).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          amountPaise: 50_000n,
          idempotencyKey: 'withdrawal:reserve:w-1',
        }),
        prisma,
      );
      expect(prisma.withdrawal.update).toHaveBeenCalledWith({
        where: { id: 'w-1' },
        data: { reserveTxnId: 'reserve-txn' },
      });
      expect(res.reserveTxnId).toBe('reserve-txn');
    });
  });

  describe('staff transitions', () => {
    it('approve: REQUESTED → APPROVED', async () => {
      const { service, prisma } = build();
      // amountPaise and userId are NOT NULL columns — a mock without them is a
      // row the database could never hold.
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-1',
        status: 'REQUESTED',
        userId: USER,
        amountPaise: 50_000n,
      });
      prisma.withdrawal.update.mockResolvedValue({
        id: 'w-1',
        status: 'APPROVED',
      });
      await service.approve(STAFF, 'w-1');
      expect(prisma.withdrawal.update).toHaveBeenCalledWith({
        where: { id: 'w-1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          decidedByStaffId: STAFF,
        }),
      });
    });

    it('approve: refuses a non-REQUESTED withdrawal', async () => {
      const { service, prisma } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-1',
        status: 'PAID',
        userId: USER,
        amountPaise: 50_000n,
      });
      await expect(service.approve(STAFF, 'w-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('reject: reverses the reserve and marks REJECTED', async () => {
      const { service, prisma, wallet } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-1',
        status: 'REQUESTED',
        userId: USER,
        amountPaise: 50_000n,
      });
      prisma.ledgerTransaction.findUnique.mockResolvedValue({
        id: 'reversal-txn',
      });
      prisma.withdrawal.update.mockResolvedValue({
        id: 'w-1',
        status: 'REJECTED',
      });

      await service.reject(STAFF, 'w-1', 'suspicious');

      expect(wallet.postWithdrawalReversal).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          amountPaise: 50_000n,
          idempotencyKey: 'withdrawal:reversal:w-1',
        }),
        prisma,
      );
      expect(prisma.withdrawal.update).toHaveBeenCalledWith({
        where: { id: 'w-1' },
        data: expect.objectContaining({
          status: 'REJECTED',
          failureReason: 'suspicious',
          reversalTxnId: 'reversal-txn',
        }),
      });
    });

    it('markPaid: APPROVED → PAID and grants +10 per REFUNDED task', async () => {
      const { service, prisma, tickets } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-1',
        status: 'APPROVED',
        userId: USER,
        amountPaise: 50_000n,
      });
      prisma.withdrawal.update.mockResolvedValue({ id: 'w-1', status: 'PAID' });
      prisma.task.findMany.mockResolvedValue([{ id: 't-1' }, { id: 't-2' }]);

      await service.markPaid(STAFF, 'w-1', 'UTR123');

      expect(prisma.withdrawal.update).toHaveBeenCalledWith({
        where: { id: 'w-1' },
        data: expect.objectContaining({ status: 'PAID', utr: 'UTR123' }),
      });
      expect(tickets.grantCompletion).toHaveBeenCalledTimes(2);
      expect(tickets.grantCompletion).toHaveBeenCalledWith(USER, 't-1', prisma);
      expect(tickets.grantCompletion).toHaveBeenCalledWith(USER, 't-2', prisma);
    });

    it('markPaid: refuses a withdrawal that is not APPROVED', async () => {
      const { service, prisma } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-1',
        status: 'REQUESTED',
        userId: USER,
        amountPaise: 50_000n,
      });
      await expect(
        service.markPaid(STAFF, 'w-1', 'UTR'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
  /**
   * THE ONE ACTION THAT MOVES MONEY OUT WAS THE ONE NOT IN THE TRAIL.
   *
   * Approving, rejecting, marking paid and marking failed each wrote the staff id
   * and the UTR onto the withdrawal row and NOTHING to the audit log — while staff
   * *viewing a screenshot* and staff *logging in* both wrote one. So the trail
   * held every look at the money and no decision about it.
   *
   * These tests are the trail, asserted per decision: the withdrawal, the amount,
   * the status it moved FROM, and the UTR where there is one.
   */
  describe('the audit trail', () => {
    it('approve: records the decision, the amount and the status it moved from', async () => {
      const { service, prisma, audit } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-1',
        status: 'REQUESTED',
        userId: USER,
        amountPaise: 59_040n,
      });
      prisma.withdrawal.update.mockResolvedValue({
        id: 'w-1',
        status: 'APPROVED',
      });

      await service.approve(STAFF, 'w-1');

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        {
          staffUserId: STAFF,
          action: 'WITHDRAWAL_APPROVE',
          targetUserId: USER,
          metadata: {
            withdrawalId: 'w-1',
            amountPaise: '59040',
            previousStatus: 'REQUESTED',
          },
        },
        // The SAME client the status change went through, so the row and the
        // decision land together or not at all.
        prisma,
      );
    });

    it('markPaid: leaves a row in the same trail as everything else', async () => {
      const { service, prisma, audit } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-2',
        status: 'APPROVED',
        userId: USER,
        amountPaise: 29_520n,
      });
      prisma.withdrawal.update.mockResolvedValue({ id: 'w-2', status: 'PAID' });
      prisma.task.findMany.mockResolvedValue([]);

      await service.markPaid(STAFF, 'w-2', 'AXISR52026082512345');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          staffUserId: STAFF,
          action: 'WITHDRAWAL_MARK_PAID',
          targetUserId: USER,
          metadata: {
            withdrawalId: 'w-2',
            amountPaise: '29520',
            previousStatus: 'APPROVED',
            // The UTR is the only link between a row in our database and money
            // that actually left a bank. It belongs in the trail, not only on the
            // withdrawal it overwrites.
            utr: 'AXISR52026082512345',
          },
        }),
        prisma,
      );
    });

    it('reject: records the reason and the ledger entry that gave the money back', async () => {
      const { service, prisma, audit } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-3',
        status: 'REQUESTED',
        userId: USER,
        amountPaise: 50_000n,
      });
      prisma.ledgerTransaction.findUnique.mockResolvedValue({
        id: 'reversal-txn',
      });
      prisma.withdrawal.update.mockResolvedValue({
        id: 'w-3',
        status: 'REJECTED',
      });

      await service.reject(STAFF, 'w-3', 'PAN does not match the account name');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAWAL_REJECT',
          metadata: {
            withdrawalId: 'w-3',
            amountPaise: '50000',
            previousStatus: 'REQUESTED',
            reason: 'PAN does not match the account name',
            // Names the movement that put the money back, so the trail and the
            // ledger can be read against each other.
            reversalTxnId: 'reversal-txn',
          },
        }),
        prisma,
      );
    });

    it('markFailed: records that it moved from APPROVED, not from REQUESTED', async () => {
      const { service, prisma, audit } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-4',
        status: 'APPROVED',
        userId: USER,
        amountPaise: 12_345n,
      });
      prisma.ledgerTransaction.findUnique.mockResolvedValue({
        id: 'reversal-txn',
      });
      prisma.withdrawal.update.mockResolvedValue({
        id: 'w-4',
        status: 'FAILED',
      });

      await service.markFailed(STAFF, 'w-4', 'bank returned the transfer');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAWAL_MARK_FAILED',
          metadata: expect.objectContaining({
            withdrawalId: 'w-4',
            previousStatus: 'APPROVED',
            reason: 'bank returned the transfer',
          }),
        }),
        prisma,
      );
    });

    it('sends the amount as a STRING, never as a bigint', async () => {
      // Not pedantry: JSON.stringify throws on a bigint, so a bigint here does not
      // write a wrong number — it makes the whole decision 500 at the Prisma
      // boundary. Every other money figure in the trail is a paise string.
      const { service, prisma, audit } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-5',
        status: 'REQUESTED',
        userId: USER,
        amountPaise: 100_000n,
      });
      prisma.withdrawal.update.mockResolvedValue({ id: 'w-5' });

      await service.approve(STAFF, 'w-5');

      const meta = audit.record.mock.calls[0][0].metadata;
      expect(typeof meta.amountPaise).toBe('string');
      expect(() => JSON.stringify(meta)).not.toThrow();
    });

    it('writes NOTHING when the decision is refused', async () => {
      // A 409 is not a decision. An audit row for an attempt that changed nothing
      // would make the trail unreadable exactly where it matters most.
      const { service, prisma, audit } = build();
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-6',
        status: 'PAID',
        userId: USER,
        amountPaise: 1n,
      });
      await expect(service.approve(STAFF, 'w-6')).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(
        service.markPaid(STAFF, 'w-6', 'UTR'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
