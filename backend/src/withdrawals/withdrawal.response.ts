import type { PayoutMethod, User, Withdrawal } from '@prisma/client';
import { maskAccount, maskUpi } from './withdrawal.constants';

/**
 * Wire shapes for withdrawals. Money is integer paise as a decimal STRING (JSON
 * has no BigInt) and dates are ISO strings — the same convention as the rest of
 * the API. A payout destination is only ever echoed MASKED.
 */

export interface PayoutMethodResponse {
  id: string;
  type: 'UPI' | 'BANK';
  label: string; // masked, still recognizable to its owner
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
}

export function toPayoutMethodResponse(m: PayoutMethod): PayoutMethodResponse {
  const label =
    m.type === 'UPI'
      ? maskUpi(m.upiId ?? '')
      : `${m.accountName ?? ''} · ${maskAccount(m.bankAccount ?? '')} · ${m.ifsc ?? ''}`;
  return {
    id: m.id,
    type: m.type,
    label,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  };
}

export interface WithdrawalResponse {
  id: string;
  amountPaise: string;
  status: string;
  utr: string | null;
  failureReason: string | null;
  payoutMethodId: string;
  requestedAt: string;
  decidedAt: string | null;
}

export function toWithdrawalResponse(w: Withdrawal): WithdrawalResponse {
  return {
    id: w.id,
    amountPaise: w.amountPaise.toString(),
    status: w.status,
    utr: w.utr,
    failureReason: w.failureReason,
    payoutMethodId: w.payoutMethodId,
    requestedAt: w.requestedAt.toISOString(),
    decidedAt: w.decidedAt ? w.decidedAt.toISOString() : null,
  };
}

/**
 * WHERE THE MONEY BEING CASHED OUT CAME FROM.
 *
 * A withdrawal has a user, a payout method and an amount, and no link to a task
 * or a campaign anywhere in the schema — so `amountPaise` on its own is a figure
 * with nothing behind it. That is how ₹100.00 on a queue card, beside a ₹938.00
 * order, got read as the refund. It never was: it is a request to move ₹100.00
 * out of a wallet, and on the practice account it is ₹100.00 because the demo
 * seed asks for exactly MIN_WITHDRAWAL_PAISE.
 *
 * NONE OF THIS DECIDES ANYTHING. It is read off the ledger for the person
 * deciding, and no gate reads it back.
 */
export interface WithdrawalBasisResponse {
  /** What the account holds right now. Integer paise as a decimal string. */
  walletBalancePaise: string;
  /** How much of it arrived as refunds, and over how many of them. */
  refundsPaise: string;
  howManyRefunds: number;
}

/** Staff queue row: the withdrawal plus who raised it and where it pays out. */
export interface WithdrawalWithContextResponse extends WithdrawalResponse {
  user: { id: string; displayId: string; mobile: string };
  payoutMethod: PayoutMethodResponse;
  /**
   * WHAT THIS CASH-OUT IS DRAWN FROM. Absent only where it was not looked up.
   * See WithdrawalBasisResponse for why the queue needed it.
   */
  basis?: WithdrawalBasisResponse;
}

export function toWithdrawalWithContext(
  w: Withdrawal & { user: User; payoutMethod: PayoutMethod },
  basis?: { walletBalancePaise: bigint; refundsPaise: bigint; howManyRefunds: number },
): WithdrawalWithContextResponse {
  return {
    ...toWithdrawalResponse(w),
    user: { id: w.user.id, displayId: w.user.displayId, mobile: w.user.mobile },
    payoutMethod: toPayoutMethodResponse(w.payoutMethod),
    ...(basis == null ? {} : {
      basis: {
        walletBalancePaise: basis.walletBalancePaise.toString(),
        refundsPaise: basis.refundsPaise.toString(),
        howManyRefunds: basis.howManyRefunds,
      },
    }),
  };
}
