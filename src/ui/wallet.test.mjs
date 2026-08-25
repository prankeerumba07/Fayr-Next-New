// Regression tests for the wallet view.
//
// The case that drives this file: requesting a withdrawal posts a USER→PAYOUT
// reserve leg immediately, so GET /me/wallet returns 0 straight after the tap.
// A screen showing only that number tells the user their ₹295.20 disappeared.
// `totalPaise` is the guard — it must be identical before and after a request.

import {
  walletView,
  statusTone,
  statusLabel,
  MIN_WITHDRAWAL_PAISE,
  ON_THE_WAY,
} from './wallet.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const UPI = { id: 'pm1', type: 'UPI', label: 'pra***@upi', status: 'ACTIVE' };
const paid = { walletBalancePaise: '29520' };

console.log('=== 1. the real first payout: ₹295.20 sitting in the wallet ===');
{
  const v = walletView({ wallet: paid, withdrawals: [], payoutMethods: [UPI] });
  ok(v.availablePaise === 29520, 'available reads the real balance');
  ok(v.onTheWayPaise === 0, 'nothing on its way yet');
  ok(v.totalPaise === 29520, 'total equals the balance');
  ok(v.canWithdraw === true, '₹295.20 clears the ₹100 minimum with a method on file');
  ok(v.withdrawAmountPaise === 29520, 'the request is for the FULL balance');
  ok(v.blockedReason === null, 'nothing to explain');
}

console.log('\n=== 2. THE INVARIANT: requesting must not look like the money vanished ===');
{
  const before = walletView({ wallet: paid, withdrawals: [], payoutMethods: [UPI] });
  // The state one tap later: balance reserved away, request sitting in the list.
  const after = walletView({
    wallet: { walletBalancePaise: '0' },
    withdrawals: [{ id: 'w1', amountPaise: '29520', status: 'REQUESTED', requestedAt: 'x' }],
    payoutMethods: [UPI],
  });
  ok(after.availablePaise === 0, 'available is genuinely zero — the reserve is real');
  ok(after.onTheWayPaise === 29520, 'and the same money is reported as on its way');
  ok(after.totalPaise === before.totalPaise, 'TOTAL IS UNCHANGED — the money never appears to vanish');
  ok(after.canWithdraw === false, 'no second withdrawal of money already reserved');
  ok(
    after.blockedReason === '₹295.20 is already on its way to you',
    'and it says where the money went, not "you need ₹100"',
  );
}

console.log('\n=== 3. an APPROVED withdrawal is still on its way, not yet paid ===');
{
  const v = walletView({
    wallet: { walletBalancePaise: '0' },
    withdrawals: [{ id: 'w1', amountPaise: '29520', status: 'APPROVED' }],
    payoutMethods: [UPI],
  });
  ok(v.onTheWayPaise === 29520, 'APPROVED counts as on its way');
  ok(v.totalPaise === 29520, 'so the total still shows the money');
  ok(ON_THE_WAY.length === 2, 'only REQUESTED and APPROVED are in flight');
}

console.log('\n=== 4. settled withdrawals are NOT counted again ===');
{
  const v = walletView({
    wallet: { walletBalancePaise: '0' },
    withdrawals: [
      { id: 'w1', amountPaise: '29520', status: 'PAID', utr: 'UTR123' },
      { id: 'w2', amountPaise: '50000', status: 'REJECTED', failureReason: 'name mismatch' },
      { id: 'w3', amountPaise: '10000', status: 'FAILED', failureReason: 'bad IFSC' },
    ],
    payoutMethods: [UPI],
  });
  ok(v.onTheWayPaise === 0, 'PAID is gone, REJECTED and FAILED were reversed into the balance');
  ok(v.totalPaise === 0, 'so nothing is double-counted');
  ok(v.blockedReason === 'Your wallet is empty', 'and an empty wallet says so plainly');
  ok(v.history[0].utr === 'UTR123', 'a paid row carries its UTR');
  ok(v.history[1].failureReason === 'name mismatch', 'a rejected row carries its reason');
}

console.log('\n=== 5. blocked for the right reason, in the right order ===');
{
  const noMethod = walletView({ wallet: paid, withdrawals: [], payoutMethods: [] });
  ok(noMethod.canWithdraw === false && noMethod.blockedReason === 'Add a UPI ID or bank account to withdraw',
    'enough money but nowhere to send it');

  const disabled = walletView({
    wallet: paid, withdrawals: [],
    payoutMethods: [{ id: 'pm0', type: 'UPI', status: 'DISABLED' }],
  });
  ok(disabled.hasPayoutMethod === false, 'a DISABLED destination does not count — the service would reject it');

  const tooSmall = walletView({
    wallet: { walletBalancePaise: '5000' }, withdrawals: [], payoutMethods: [UPI],
  });
  ok(tooSmall.canWithdraw === false, '₹50 is under the minimum');
  ok(tooSmall.blockedReason === 'You need ₹100.00 to withdraw — you have ₹50.00',
    'and the reason names both numbers');
  ok(MIN_WITHDRAWAL_PAISE === 10000, 'the minimum mirrors the backend constant');
}

console.log('\n=== 6. bad input never crashes the screen ===');
{
  const v = walletView(null);
  ok(v.availablePaise === 0 && v.onTheWayPaise === 0, 'no data reads as zero, not NaN');
  ok(v.canWithdraw === false && v.blockedReason === 'Your wallet is empty', 'and is honestly blocked');
  ok(walletView({ wallet: { walletBalancePaise: 'nonsense' } }).availablePaise === 0,
    'an unparseable balance is 0, never NaN — NaN would render as "₹NaN"');
  ok(walletView({ wallet: paid, withdrawals: null, payoutMethods: null }).history.length === 0,
    'null lists are empty lists');
}

console.log('\n=== 7. status labels and tones ===');
{
  ok(statusLabel('REQUESTED') === 'Awaiting review', 'REQUESTED is jargon; the label is not');
  ok(statusTone('PAID') === 'ok' && statusTone('FAILED') === 'bad' && statusTone('REQUESTED') === 'warn',
    'tones separate done, broken and waiting');
  ok(statusLabel('WAT') === 'WAT', 'an unknown status falls through rather than being hidden');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
