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

/** Staff queue row: the withdrawal plus who raised it and where it pays out. */
export interface WithdrawalWithContextResponse extends WithdrawalResponse {
  user: { id: string; displayId: string; mobile: string };
  payoutMethod: PayoutMethodResponse;
}

export function toWithdrawalWithContext(
  w: Withdrawal & { user: User; payoutMethod: PayoutMethod },
): WithdrawalWithContextResponse {
  return {
    ...toWithdrawalResponse(w),
    user: { id: w.user.id, displayId: w.user.displayId, mobile: w.user.mobile },
    payoutMethod: toPayoutMethodResponse(w.payoutMethod),
  };
}
