import type { WalletAccountKind } from '@prisma/client';

/**
 * The two system accounts are singletons with FIXED, well-known ids, so they can
 * be upserted idempotently by primary key (which sidesteps upserting on a
 * null-userId compound unique). The NULLS NOT DISTINCT index on wallet_accounts
 * is the hard backstop that stops a second system account of the same kind.
 *
 *   HOUSE  — the funding side of a refund (debited when a user is credited).
 *   PAYOUT — the clearing side of a withdrawal (credited when a user is debited).
 */
export const SYSTEM_ACCOUNT_IDS = {
  HOUSE: '00000000-0000-0000-0000-000000000001',
  PAYOUT: '00000000-0000-0000-0000-000000000002',
} as const satisfies Record<'HOUSE' | 'PAYOUT', string>;

export type SystemAccountKind = keyof typeof SYSTEM_ACCOUNT_IDS;

// Compile-time assurance that the system-account keys are valid account kinds.
const _kindCheck: Record<SystemAccountKind, WalletAccountKind> = {
  HOUSE: 'HOUSE',
  PAYOUT: 'PAYOUT',
};
void _kindCheck;
