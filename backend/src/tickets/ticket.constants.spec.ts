import { TICKETS, ticketKey } from './ticket.constants';

/**
 * Pure unit tests for the ticket constants + idempotency-key builders — no DB.
 * The ledger behavior itself (locking, non-negative floor, idempotency, the DB
 * triggers) is proven against a real Postgres in test/ticket.ledger.e2e-spec.ts.
 */
describe('ticket constants', () => {
  it('matches the product ground truth', () => {
    expect(TICKETS.SIGNUP_GRANT).toBe(15);
    expect(TICKETS.DEFAULT_CLAIM_COST).toBe(5);
    expect(TICKETS.COMPLETION_GRANT).toBe(10);
  });

  it('a completed task nets +5 tickets (claim −5, completion +10)', () => {
    expect(TICKETS.COMPLETION_GRANT - TICKETS.DEFAULT_CLAIM_COST).toBe(5);
  });
});

describe('ticketKey', () => {
  it('keys the signup grant per user', () => {
    expect(ticketKey.signup('u1')).toBe('ticket:signup:u1');
    expect(ticketKey.signup('u1')).not.toBe(ticketKey.signup('u2'));
  });

  it('keys the per-task lifecycle events distinctly', () => {
    const taskId = 't1';
    const keys = [
      ticketKey.claim(taskId),
      ticketKey.expiry(taskId),
      ticketKey.completion(taskId),
    ];
    // All three are distinct, so they never collide on the unique index.
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual([
      'ticket:claim:t1',
      'ticket:expiry:t1',
      'ticket:completion:t1',
    ]);
  });
});
