import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketService } from '../tickets/ticket.service';
import { WalletService } from '../wallet/wallet.service';
import { AssistantError } from './assistant.types';
import {
  buildJourney,
  type JourneyFacts,
  type JourneySnapshot,
} from './journey';

/**
 * How far back each record is read. Bounded on purpose: a snapshot is meant to be
 * read by a person in a few seconds, and an account with four years of history
 * must not make asking a question slow.
 */
const RECENT_ROWS = 20;
const RECENT_TASKS = 10;
const EVENTS_PER_TASK = 8;

/**
 * READING WHAT THE APP ALREADY KNOWS.
 *
 * The thin half of the journey: it reads the records that already exist and hands
 * them to the pure builder next door, which turns them into sentences. Nothing
 * here records anything new — every table it touches was already being written
 * before any of this existed.
 *
 * WHAT IT DOES NOT READ, deliberately: the mobile number, the PAN, the bank or UPI
 * details. A snapshot is stored on a question and read by staff, and the surest way
 * for personal detail never to end up in one is for this code never to fetch any.
 *
 * Balances come from the services that own them — TicketService and WalletService —
 * so there is never a second opinion about what somebody's balance is. The rows
 * behind the steps are read here with a limit, because those two services return
 * a whole history and a snapshot only needs the end of it.
 */
@Injectable()
export class UserJourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly wallet: WalletService,
  ) {}

  async factsFor(userId: string): Promise<JourneyFacts> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, setupDoneAt: true },
    });
    if (!user) throw new AssistantError('that account does not exist');

    const [
      ticketBalance,
      ticketEntries,
      walletBalance,
      walletEntries,
      tasks,
      withdrawals,
      proofs,
      supportQuestions,
      assistantQuestions,
    ] = await Promise.all([
      this.tickets.getBalance(userId),
      this.prisma.ticketEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ROWS,
        select: { createdAt: true, delta: true, reason: true },
      }),
      this.wallet.getUserBalance(userId),
      this.prisma.walletEntry.findMany({
        where: { account: { userId, kind: 'USER' } },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ROWS,
        select: {
          createdAt: true,
          amountPaise: true,
          transaction: { select: { kind: true, memo: true } },
        },
      }),
      this.prisma.task.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_TASKS,
        select: {
          id: true,
          state: true,
          platform: true,
          closedAt: true,
          closeReason: true,
          blocker: true,
          blockerReason: true,
          claimExpiresAt: true,
          windowEndsAt: true,
          campaign: { select: { title: true, productName: true } },
          events: {
            orderBy: { createdAt: 'desc' },
            take: EVENTS_PER_TASK,
            select: {
              createdAt: true,
              type: true,
              fromState: true,
              toState: true,
              reason: true,
            },
          },
        },
      }),
      this.prisma.withdrawal.findMany({
        where: { userId },
        orderBy: { requestedAt: 'desc' },
        take: RECENT_ROWS,
        select: {
          requestedAt: true,
          decidedAt: true,
          amountPaise: true,
          status: true,
        },
      }),
      this.prisma.screenshotUpload.findMany({
        where: { userId },
        orderBy: { uploadedAt: 'desc' },
        take: RECENT_ROWS,
        select: {
          uploadedAt: true,
          kind: true,
          task: { select: { campaign: { select: { title: true } } } },
        },
      }),
      this.prisma.supportQuestion.count({ where: { userId } }),
      this.prisma.assistantQuestion.count({ where: { userId } }),
    ]);

    return {
      takenAt: new Date(),
      account: { joinedAt: user.createdAt, setupDoneAt: user.setupDoneAt },
      tickets: {
        balance: ticketBalance,
        entries: ticketEntries.map((t) => ({
          at: t.createdAt,
          delta: t.delta,
          reason: t.reason,
        })),
      },
      wallet: {
        balancePaise: walletBalance,
        entries: walletEntries.map((w) => ({
          at: w.createdAt,
          amountPaise: w.amountPaise,
          kind: w.transaction.kind,
          memo: w.transaction.memo,
        })),
      },
      tasks: tasks.map((t) => ({
        id: t.id,
        // The offer's own title is what the person saw on the feed. The product
        // name is the fallback, because a campaign always has one.
        offer: t.campaign?.title || t.campaign?.productName || '',
        platform: t.platform,
        state: t.state,
        closedAt: t.closedAt,
        closeReason: t.closeReason,
        blocker: t.blocker,
        blockerReason: t.blockerReason,
        claimExpiresAt: t.claimExpiresAt,
        windowEndsAt: t.windowEndsAt,
        events: t.events.map((e) => ({
          at: e.createdAt,
          type: e.type,
          fromState: e.fromState,
          toState: e.toState,
          reason: e.reason,
        })),
      })),
      withdrawals: withdrawals.map((w) => ({
        // A payout has two moments, and the one that matters is the one the status
        // is about: still waiting means the day it was asked for, anything else
        // means the day somebody decided.
        at:
          w.status === 'REQUESTED'
            ? w.requestedAt
            : (w.decidedAt ?? w.requestedAt),
        amountPaise: w.amountPaise,
        status: w.status,
      })),
      proofs: proofs.map((p) => ({
        at: p.uploadedAt,
        kind: p.kind,
        offer: p.task?.campaign?.title ?? null,
      })),
      // Either kind of writing in counts: somebody who has already asked once is
      // not a first-timer, whichever door they came through.
      questionsWrittenBefore: supportQuestions + assistantQuestions,
    };
  }

  async snapshotFor(userId: string): Promise<JourneySnapshot> {
    return buildJourney(await this.factsFor(userId));
  }
}
