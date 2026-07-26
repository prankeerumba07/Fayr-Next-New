import type {
  LedgerKind,
  SupportQuestion,
  SupportReply,
  TicketEntry,
  TicketReason,
  User,
  UserStatus,
} from '@prisma/client';
import {
  toQuestionResponse,
  type QuestionResponse,
} from '../support/support.response';
import type { TaskResponse } from '../tasks/task.response';
import type {
  UserWalletEntry,
  UserWalletStatement,
} from '../wallet/wallet.service';

/**
 * Response shapes for the staff unified user view (2.2). Money is integer paise
 * as decimal STRINGS (JSON has no BigInt) and dates are ISO strings — the same
 * convention as the user-facing responses. The `displayId` (FAYR-…) is shown
 * here for staff to read back to the user, but it is NEVER a lookup input.
 */

export interface UserProfile {
  id: string;
  displayId: string;
  mobile: string;
  status: UserStatus;
  createdAt: string;
}

/** Compact result of a mobile search — enough to confirm identity and drill in. */
export interface UserSummaryResponse extends UserProfile {
  ticketBalance: number;
  walletBalancePaise: string;
  taskCount: number;
}

export interface TicketEntryResponse {
  id: string;
  delta: number;
  reason: TicketReason;
  balanceAfter: number;
  taskId: string | null;
  createdAt: string;
}

export interface WalletEntryResponse {
  id: string;
  amountPaise: string;
  kind: LedgerKind;
  memo: string | null;
  referenceType: string | null;
  referenceId: string | null;
  transactionId: string;
  createdAt: string;
}

/** The full unified view: profile + ledgers + task history + withdrawals + questions. */
export interface UserViewResponse {
  profile: UserProfile;
  tickets: { balance: number; entries: TicketEntryResponse[] };
  wallet: { balancePaise: string; entries: WalletEntryResponse[] };
  withdrawals: WalletEntryResponse[];
  tasks: TaskResponse[];
  questions: QuestionResponse[];
}

export function toUserProfile(u: User): UserProfile {
  return {
    id: u.id,
    displayId: u.displayId,
    mobile: u.mobile,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
  };
}

export function toUserSummary(
  u: User,
  ticketBalance: number,
  walletBalancePaise: bigint,
  taskCount: number,
): UserSummaryResponse {
  return {
    ...toUserProfile(u),
    ticketBalance,
    walletBalancePaise: walletBalancePaise.toString(),
    taskCount,
  };
}

function toTicketEntry(e: TicketEntry): TicketEntryResponse {
  return {
    id: e.id,
    delta: e.delta,
    reason: e.reason,
    balanceAfter: e.balanceAfter,
    taskId: e.taskId,
    createdAt: e.createdAt.toISOString(),
  };
}

function toWalletEntry(e: UserWalletEntry): WalletEntryResponse {
  return {
    id: e.id,
    amountPaise: e.amountPaise.toString(),
    kind: e.transaction.kind,
    memo: e.transaction.memo,
    referenceType: e.transaction.referenceType,
    referenceId: e.transaction.referenceId,
    transactionId: e.transactionId,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toUserView(input: {
  user: User;
  ticketBalance: number;
  ticketEntries: TicketEntry[];
  statement: UserWalletStatement;
  tasks: TaskResponse[];
  questions: (SupportQuestion & { replies: SupportReply[] })[];
}): UserViewResponse {
  const walletEntries = input.statement.entries.map(toWalletEntry);
  return {
    profile: toUserProfile(input.user),
    tickets: {
      balance: input.ticketBalance,
      entries: input.ticketEntries.map(toTicketEntry),
    },
    wallet: {
      balancePaise: input.statement.balancePaise.toString(),
      entries: walletEntries,
    },
    // Withdrawals are simply the WITHDRAWAL-kind legs on the user's account —
    // surfaced as their own section. Empty until the withdrawal flow lands.
    withdrawals: walletEntries.filter((e) => e.kind === 'WITHDRAWAL'),
    tasks: input.tasks,
    questions: input.questions.map(toQuestionResponse),
  };
}
