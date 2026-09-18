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
  /**
   * THE NAME THEY GAVE, OR NULL — AND MOST PEOPLE HAVE NONE.
   *
   * `name` is optional on the model, first-run setup can be finished without
   * giving one, and the practice data creates none at all. So null is the
   * ordinary case here rather than the exception, and every screen that reads
   * this has to be built for it.
   *
   * IT IS NEVER AN EMPTY STRING AND NEVER A PLACEHOLDER. No "Unknown", no dash,
   * nothing that could be read back to somebody as if it were their name. What
   * to draw in place of a missing name is the panel's decision, and it can only
   * make it honestly if the absence arrives as an absence.
   */
  name: string | null;
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

/**
 * A NAME, OR NOTHING AT ALL.
 *
 * Blank and whitespace-only collapse to null with a genuinely absent name,
 * because a screen asked to tell "no name" from "a name that is one space" will
 * get it wrong, and the one place to settle that is here. Trimmed, so a stray
 * space around a real name cannot decide how it is drawn.
 */
function nameOrNull(name: string | null | undefined): string | null {
  const trimmed = String(name ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function toUserProfile(u: User): UserProfile {
  return {
    id: u.id,
    displayId: u.displayId,
    name: nameOrNull(u.name),
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
