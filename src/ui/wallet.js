// What the wallet screen shows — pure, so it can be tested without React Native
// (the same reason src/ui/timeline.js exists).
//
// THE INVARIANT THIS FILE EXISTS FOR: requesting a withdrawal immediately posts
// a USER→PAYOUT reserve leg (backend withdrawal.service.ts), so the balance
// returned by GET /me/wallet drops to zero the moment the user taps Withdraw.
// A screen that renders only that number tells the user their money has
// vanished. So `walletView` ALWAYS returns `availablePaise` and `onTheWayPaise`
// together, plus `totalPaise` — the figure that must not move when money is
// merely reserved. Anything rendering a balance must render all three.

/** Mirrors MIN_WITHDRAWAL_PAISE in backend/src/withdrawals/withdrawal.constants.ts. */
export const MIN_WITHDRAWAL_PAISE = 10000; // ₹100

/**
 * Statuses where the money has LEFT the available balance but has not reached
 * the user: REQUESTED (reserved) and APPROVED (staff said yes, not yet paid).
 * PAID is gone for good; REJECTED and FAILED have been reversed back into the
 * balance, so counting either would double-count.
 */
export const ON_THE_WAY = ['REQUESTED', 'APPROVED'];

const toPaise = (v) => {
  const n = v == null ? 0 : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const rupees = (paise) => {
  const whole = Math.floor(Math.abs(paise) / 100);
  const p = String(Math.abs(paise) % 100).padStart(2, '0');
  return `₹${whole}.${p}`;
};

/** Chip tone per withdrawal status — the screen stays free of status logic. */
export function statusTone(status) {
  if (status === 'PAID') return 'ok';
  if (status === 'REJECTED' || status === 'FAILED') return 'bad';
  if (status === 'APPROVED') return 'info';
  return 'warn'; // REQUESTED — waiting on a person
}

/** Human label per status. "REQUESTED" is jargon; "Requested" is not enough. */
export function statusLabel(status) {
  switch (status) {
    case 'REQUESTED': return 'Awaiting review';
    case 'APPROVED': return 'Approved, paying out';
    case 'PAID': return 'Paid';
    case 'REJECTED': return 'Rejected';
    case 'FAILED': return 'Payment failed';
    default: return status || 'Unknown';
  }
}

/**
 * @param {{wallet: {walletBalancePaise?: string|number}|null,
 *          withdrawals: Array<object>|null,
 *          payoutMethods: Array<object>|null}} input
 */
export function walletView(input) {
  const i = input || {};
  const availablePaise = toPaise(i.wallet && i.wallet.walletBalancePaise);
  const list = Array.isArray(i.withdrawals) ? i.withdrawals : [];
  const methods = (Array.isArray(i.payoutMethods) ? i.payoutMethods : []).filter(
    // A DISABLED destination cannot back a new request (the service rejects it),
    // so it must not count towards "you have somewhere to be paid".
    (m) => m && m.status !== 'DISABLED',
  );

  const pending = list.filter((w) => w && ON_THE_WAY.includes(w.status));
  const onTheWayPaise = pending.reduce((sum, w) => sum + toPaise(w.amountPaise), 0);

  const history = list.map((w) => ({
    id: w.id,
    amountPaise: toPaise(w.amountPaise),
    status: w.status,
    label: statusLabel(w.status),
    tone: statusTone(w.status),
    requestedAt: w.requestedAt || null,
    // Shown on the row it belongs to: a UTR proves the transfer, a failure
    // reason explains a reversal. Neither should need a second screen.
    utr: w.utr || null,
    failureReason: w.failureReason || null,
  }));

  const hasPayoutMethod = methods.length > 0;
  let canWithdraw = false;
  let blockedReason = null;

  if (availablePaise >= MIN_WITHDRAWAL_PAISE && hasPayoutMethod) {
    canWithdraw = true;
  } else if (availablePaise >= MIN_WITHDRAWAL_PAISE) {
    blockedReason = 'Add a UPI ID or bank account to withdraw';
  } else if (onTheWayPaise > 0) {
    // Report the reserve, never "you need ₹100" — the money is not missing and
    // saying so would be the vanishing-balance lie in sentence form.
    blockedReason = `${rupees(onTheWayPaise)} is already on its way to you`;
  } else if (availablePaise > 0) {
    blockedReason = `You need ${rupees(MIN_WITHDRAWAL_PAISE)} to withdraw — you have ${rupees(availablePaise)}`;
  } else {
    blockedReason = 'Your wallet is empty';
  }

  return {
    availablePaise,
    onTheWayPaise,
    // The number that must NOT change when a withdrawal is merely reserved.
    totalPaise: availablePaise + onTheWayPaise,
    hasPayoutMethod,
    methods,
    canWithdraw,
    blockedReason,
    // Full balance only — no amount input in this version, so the screen has one
    // less thing to validate and can never request more than is available.
    withdrawAmountPaise: canWithdraw ? availablePaise : null,
    history,
  };
}
