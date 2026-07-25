/** A ticket-ledger rule violation (unknown user, bad cost, etc.). */
export class TicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TicketError';
  }
}

/**
 * A deduction was refused because it would drive the balance below zero. Carries
 * the numbers so the caller (e.g. the claim endpoint) can tell the user exactly
 * how many tickets they have vs. need.
 */
export class InsufficientTicketsError extends TicketError {
  constructor(
    readonly available: number,
    readonly required: number,
  ) {
    super(`insufficient tickets: have ${available}, need ${required}`);
    this.name = 'InsufficientTicketsError';
  }
}
