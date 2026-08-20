// THE ALL-TIME EARNINGS FIGURE, PINNED.
//
// This number has no server endpoint. It is derived on the device from three
// others, and it is only correct because of one invariant nothing enforces:
// requesting a withdrawal immediately moves the money OUT of the wallet balance
// via a USER→PAYOUT reserve leg.
//
// These tests exist so that whoever changes withdrawal accounting — in
// particular whoever reconciles the PAYOUT account, which does not currently
// post a leg on mark-paid — is told by a failing test rather than by a user
// reading a number that is too big and believing it.

import { allTimeEarningsPaise, ON_THE_WAY, SETTLED } from './wallet.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const wallet = (paise) => ({ walletBalancePaise: String(paise) });
const w = (status, amountPaise) => ({ id: status + amountPaise, status, amountPaise: String(amountPaise) });

console.log('=== 1. the three parts add up to everything ever credited ===');
{
  ok(allTimeEarningsPaise({ wallet: wallet(50000), withdrawals: [] }) === 50000,
    'nothing withdrawn: all time earnings is just the balance');
  ok(allTimeEarningsPaise({ wallet: wallet(0), withdrawals: [w('PAID', 50000)] }) === 50000,
    'all withdrawn and paid: the balance is empty but the earnings are not');
  ok(allTimeEarningsPaise({ wallet: wallet(20000), withdrawals: [w('PAID', 30000)] }) === 50000,
    'some paid, some left');
  ok(allTimeEarningsPaise({ wallet: wallet(0), withdrawals: [w('REQUESTED', 50000)] }) === 50000,
    'reserved but not yet paid still counts — the user earned it');
  ok(allTimeEarningsPaise({ wallet: wallet(0), withdrawals: [w('APPROVED', 50000)] }) === 50000,
    'approved and about to be paid, likewise');
}

console.log('\n=== 2. a reversed withdrawal is NOT counted — it is back in the balance ===');
{
  // The reserve leg is reversed on reject/fail, so the money is in the balance
  // again. Counting the withdrawal as well would count the same rupee twice.
  ok(allTimeEarningsPaise({ wallet: wallet(50000), withdrawals: [w('REJECTED', 50000)] }) === 50000,
    'a REJECTED withdrawal is excluded, not added to the balance it was returned to');
  ok(allTimeEarningsPaise({ wallet: wallet(50000), withdrawals: [w('FAILED', 50000)] }) === 50000,
    'a FAILED withdrawal likewise');
  ok(!ON_THE_WAY.includes('REJECTED') && !ON_THE_WAY.includes('FAILED'),
    'and neither status is treated as on its way');
  ok(!SETTLED.includes('REJECTED'), 'nor as settled');
}

console.log('\n=== 3. a full history reconciles to the total credited ===');
{
  // Everything that ever happened to one user, in one go. Total credited was
  // ₹1,500: ₹400 paid out, ₹300 on its way, ₹500 rejected and returned, leaving
  // ₹800 in the wallet (1500 - 400 - 300).
  const view = {
    wallet: wallet(80000),
    withdrawals: [
      w('PAID', 40000),
      w('REQUESTED', 30000),
      w('REJECTED', 50000),
      w('FAILED', 20000),
    ],
  };
  ok(allTimeEarningsPaise(view) === 150000, 'reconciles to ₹1,500 credited, once each');
}

console.log('\n=== 4. WHY THIS CAN DRIFT — read this before changing the expectation ===');
{
  // ── If you are here because this failed, do not "fix" the number. ──────────
  // This figure is correct ONLY while requesting a withdrawal immediately removes
  // the money from the wallet balance (the USER→PAYOUT reserve leg in
  // backend/src/withdrawals/withdrawal.service.ts).
  //
  // Reconciling the PAYOUT account — which today posts NO ledger entry on
  // mark-paid, so PAYOUT only ever grows — is the change most likely to move
  // where that deduction happens. If money starts leaving the balance at PAID
  // time instead, then a REQUESTED withdrawal is still IN the balance, and this
  // function adds it a second time.
  //
  // The assertion below is what that mistake looks like, stated as a number, so
  // it is impossible to make it accidentally.
  const balanceStillHoldingTheRequest = 50000; // the wrong world: nothing deducted yet
  const doubleCounted = allTimeEarningsPaise({
    wallet: wallet(balanceStillHoldingTheRequest),
    withdrawals: [w('REQUESTED', 50000)],
  });
  ok(doubleCounted === 100000,
    'a balance that still holds a requested withdrawal reports DOUBLE — which is '
    + 'why the reserve leg must stay at request time, or this figure must move to the server');
  ok(allTimeEarningsPaise({ wallet: wallet(0), withdrawals: [w('REQUESTED', 50000)] }) === 50000,
    'and with the reserve leg in place, the same history reports the truth');
}

console.log('\n=== 5. it never throws on a shape the server has not sent yet ===');
{
  ok(allTimeEarningsPaise(null) === 0, 'null input');
  ok(allTimeEarningsPaise({}) === 0, 'no wallet, no withdrawals');
  ok(allTimeEarningsPaise({ wallet: null, withdrawals: null }) === 0, 'both null');
  ok(allTimeEarningsPaise({ wallet: wallet(1), withdrawals: [null, undefined] }) === 1,
    'holes in the list are skipped');
  ok(allTimeEarningsPaise({ wallet: wallet(1), withdrawals: [w('SOMETHING_NEW', 999)] }) === 1,
    'a status this version has never heard of is NOT counted — an unknown state '
    + 'must not silently inflate the headline figure');
}

console.log('\n=== 6. ONE definition, not one per screen ===');
{
  // ON_THE_WAY and this total were declared three times — in wallet.js and again,
  // independently, in EarningsScreen and ProfileScreen. Three copies of a fact
  // that feeds a money figure is the same shape of defect as a price shown by one
  // route and paid by another: they agree until one of them is edited.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(import.meta.dirname, '..');
  for (const screen of ['EarningsScreen.js', 'ProfileScreen.js']) {
    const src = fs.readFileSync(path.join(dir, screen), 'utf8');
    ok(!/const ON_THE_WAY\s*=/.test(src),
      `${screen} does not declare its own ON_THE_WAY`);
    ok(/allTimeEarningsPaise/.test(src),
      `${screen} takes the all-time total from the shared function`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
