// The displayed refund and the paid refund must be one number.
//
// Written after finding two defects of this exact shape on this exact figure:
// the backend computing the display from a listed price while paying the charged
// one, and the Task screen applying the percentage without the cap. Each of
// these cases is one of those going wrong again.

import { displayRefundPaise } from './refund.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== 1. the backend\'s own number always wins ===');
{
  ok(displayRefundPaise({
    authoritativePaise: '32800', chargedPaise: 36700, percent: 100, capPaise: null,
  }) === 32800, 'the authoritative figure beats a local calculation that disagrees');
  ok(displayRefundPaise({ authoritativePaise: 0, chargedPaise: 36700, percent: 100 }) === 0,
    'a genuine ZERO from the backend is honoured, not treated as absent');
  ok(displayRefundPaise({ authoritativePaise: '0' }) === 0, 'as a string too');
}

console.log('\n=== 2. the fallback follows the backend arithmetic exactly ===');
{
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 100 }) === 129900, '100% of the charged amount');
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 90 }) === 116910, '90%');
  // The backend floors: (itemPaise * pct) / 100n in bigint maths.
  ok(displayRefundPaise({ chargedPaise: 333, percent: 90 }) === 299,
    'the division FLOORS, matching the backend — 299, never 300');
}

console.log('\n=== 3. THE CAP — the defect this file was written for ===');
{
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 100, capPaise: 50000 }) === 50000,
    'a cap below the percentage wins, exactly as min(base, cap) does backend-side');
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 100, capPaise: '50000' }) === 50000,
    'a cap arriving as a paise STRING is still a cap');
  ok(displayRefundPaise({ chargedPaise: 40000, percent: 100, capPaise: 50000 }) === 40000,
    'a cap above the percentage changes nothing');
  // The zero-cap trap: typing 0 in the admin cap field stores a REAL zero cap,
  // so the backend pays nothing. The screen must say so rather than promise the
  // full percentage of an order that would pay ₹0.00.
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 100, capPaise: 0 }) === 0,
    'a cap of ZERO is a real cap and the screen shows what would actually be paid');
}

console.log('\n=== 4. nothing is shown when nothing can honestly be shown ===');
{
  ok(displayRefundPaise({ chargedPaise: null, percent: 100 }) === null,
    'no charged amount (the quantity hold) -> no number, so the screen says a person will check');
  ok(displayRefundPaise({ chargedPaise: 1000, percent: null }) === null, 'no percentage');
  ok(displayRefundPaise({ chargedPaise: 1000, percent: 101 }) === null, 'an impossible percentage');
  ok(displayRefundPaise({}) === null, 'nothing at all');
  ok(displayRefundPaise(null) === null, 'null options');
  ok(displayRefundPaise({ authoritativePaise: 'not-a-number', chargedPaise: 1000, percent: 100 }) === 1000,
    'a malformed authoritative value falls back rather than showing garbage');
  ok(displayRefundPaise({ authoritativePaise: -5, chargedPaise: 1000, percent: 100 }) === 1000,
    'so does a negative one — money is never negative here');
  ok(displayRefundPaise({ chargedPaise: 1000.5, percent: 100 }) === null, 'a fractional paise amount');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
