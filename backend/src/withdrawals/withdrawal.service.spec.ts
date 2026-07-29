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

function build() {
  const prisma = makePrisma();
  const wallet = makeWallet();
  const tickets = makeTickets();
  const service = new WithdrawalService(
    prisma as never,
    wallet as never,
    tickets as never,
  );
  return { service, prisma, wallet, tickets };
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
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: 'w-1',
        status: 'REQUESTED',
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
      });
      await expect(
        service.markPaid(STAFF, 'w-1', 'UTR'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
