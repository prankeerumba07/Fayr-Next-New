/**
 * The ticket economy, as fixed by the product ground truth (CLAUDE.md):
 *   - start with 15 tickets
 *   - 5 deducted per claim (a campaign may override its own cost)
 *   - returned on expiry if no purchase was made
 *   - consumed permanently once purchase is confirmed (no entry — the −5 stays)
 *   - 10 returned after full completion + withdrawal
 *
 * Tickets are COUNTS, not money, so they live in their own append-only ledger
 * (ticket_entries), separate from the paise wallet. A balance is SUM(delta).
 */
export const TICKETS = {
  /** Granted once, on registration. */
  SIGNUP_GRANT: 15,
  /** Default claim cost; a campaign may set its own `ticketCost`. */
  DEFAULT_CLAIM_COST: 5,
  /** Granted after a task is fully completed + withdrawn. */
  COMPLETION_GRANT: 10,
} as const;

/**
 * Stable idempotency keys for each lifecycle posting. One key per (event, task) —
 * or per user for the signup grant — so a replay is a no-op at the database's
 * unique index, never a double-post.
 */
export const ticketKey = {
  signup: (userId: string): string => `ticket:signup:${userId}`,
  claim: (taskId: string): string => `ticket:claim:${taskId}`,
  expiry: (taskId: string): string => `ticket:expiry:${taskId}`,
  completion: (taskId: string): string => `ticket:completion:${taskId}`,
} as const;
