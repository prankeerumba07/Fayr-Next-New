import type { LedgerTransaction, TicketEntry, User } from '@prisma/client';
import type {
  UserWalletEntry,
  UserWalletStatement,
} from '../wallet/wallet.service';
import {
  toUserProfile,
  toUserSummary,
  toUserView,
} from './user-view.response';

/**
 * Pure unit tests for the user-view shapers. They pin the wire contract: money
 * is always a decimal STRING (never a number), dates are ISO, and withdrawals
 * are exactly the WITHDRAWAL-kind wallet legs.
 */

const user = {
  id: 'u1',
  displayId: 'FAYR-100001',
  mobile: '+919876543210',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
} as unknown as User;

function walletEntry(
  id: string,
  amountPaise: bigint,
  kind: LedgerTransaction['kind'],
): UserWalletEntry {
  return {
    id,
    amountPaise,
    accountId: 'acct-1',
    transactionId: `txn-${id}`,
    createdAt: new Date('2026-02-03T00:00:00.000Z'),
    transaction: {
      kind,
      memo: null,
      referenceType: 'task',
      referenceId: 't1',
    },
  } as unknown as UserWalletEntry;
}

describe('toUserSummary', () => {
  it('renders money as a string and carries the display id', () => {
    const s = toUserSummary(user, 10, 79900n, 3);
    expect(s.walletBalancePaise).toBe('79900');
    expect(typeof s.walletBalancePaise).toBe('string');
    expect(s.ticketBalance).toBe(10);
    expect(s.taskCount).toBe(3);
    expect(s.displayId).toBe('FAYR-100001');
    expect(s.createdAt).toBe('2026-01-02T03:04:05.000Z');
  });
});

describe('toUserView', () => {
  const ticketEntries = [
    {
      id: 'te1',
      delta: 15,
      reason: 'SIGNUP_GRANT',
      balanceAfter: 15,
      taskId: null,
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    },
    {
      id: 'te2',
      delta: -5,
      reason: 'CLAIM',
      balanceAfter: 10,
      taskId: 't1',
      createdAt: new Date('2026-01-03T03:04:05.000Z'),
    },
  ] as unknown as TicketEntry[];

  const statement: UserWalletStatement = {
    accountId: 'acct-1',
    balancePaise: 79900n,
    entries: [
      walletEntry('we1', 129900n, 'REFUND'),
      walletEntry('we2', -50000n, 'WITHDRAWAL'),
    ],
  };

  it('aggregates ledgers with string money and filters withdrawals', () => {
    const v = toUserView({
      user,
      ticketBalance: 10,
      ticketEntries,
      statement,
      tasks: [],
      questions: [],
    });

    expect(v.profile.mobile).toBe('+919876543210');
    expect(v.tickets.balance).toBe(10);
    expect(v.tickets.entries).toHaveLength(2);
    expect(v.tickets.entries[0].reason).toBe('SIGNUP_GRANT');

    expect(v.wallet.balancePaise).toBe('79900');
    expect(v.wallet.entries).toHaveLength(2);
    expect(v.wallet.entries[0].amountPaise).toBe('129900');
    expect(v.wallet.entries[0].kind).toBe('REFUND');

    // Withdrawals are the WITHDRAWAL-kind subset only.
    expect(v.withdrawals).toHaveLength(1);
    expect(v.withdrawals[0].amountPaise).toBe('-50000');
    expect(v.withdrawals[0].kind).toBe('WITHDRAWAL');
  });
});

describe('the name, which most people do not have', () => {
  // ── WHY THIS IS ITS OWN DESCRIBE ────────────────────────────────────────
  //
  // A support agent reads the top of this response aloud to confirm who they
  // are speaking to. The failure worth preventing is not a crash: it is the
  // panel being handed something that LOOKS like a name and reading it back.
  // So the only two answers this shaper may give are the name they gave, and
  // nothing.
  const named = { ...user, name: 'Asha Kumari' } as unknown as User;

  it('returns the name when there is one', () => {
    expect(toUserProfile(named).name).toBe('Asha Kumari');
    expect(toUserView({
      user: named, ticketBalance: 0, ticketEntries: [],
      statement: { balancePaise: 0n, entries: [] } as unknown as UserWalletStatement,
      tasks: [], questions: [],
    }).profile.name).toBe('Asha Kumari');
  });

  it('is NULL and never an empty string when they gave none', () => {
    // The ordinary case. `name` is optional on the model, setup can be finished
    // without giving one, and the practice data creates none at all.
    expect(toUserProfile(user).name).toBeNull();
    expect(toUserSummary(user, 0, 0n, 0).name).toBeNull();
  });

  it('collapses blank and whitespace to null rather than passing it on', () => {
    // A screen cannot tell "no name" from "a name that is one space", and
    // guessing is how a blank line ends up where a name should be.
    for (const blank of ['', '   ', '\t\n']) {
      const u = { ...user, name: blank } as unknown as User;
      expect(toUserProfile(u).name).toBeNull();
    }
  });

  it('trims a real name rather than letting spacing decide how it is drawn', () => {
    const u = { ...user, name: '  Asha Kumari  ' } as unknown as User;
    expect(toUserProfile(u).name).toBe('Asha Kumari');
  });

  it('invents no placeholder — no Unknown, no dash, nothing readable back', () => {
    const drawn = JSON.stringify(toUserProfile(user));
    expect(drawn).toContain('"name":null');
    expect(drawn).not.toMatch(/Unknown|N\/A|Anonymous|"name":"-"/i);
  });
});
