import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import { PrismaService } from '../prisma/prisma.service';
import {
  daysBetween,
  fromChatHandover,
  fromChatMessage,
  fromLapsedSession,
  fromQuestion,
  fromScreenshot,
  fromShopSignIn,
  fromTaskEvent,
  fromUserEvent,
  fromWithdrawalDecision,
  fromWithdrawalRequest,
  sortAndTrim,
  whereSetupStopped,
  type ActivityRow,
  type ActivitySummary,
  type Timeline,
} from './activity';

/** Everything one trail read hands back. */
export interface UserActivity {
  window: { from: string; to: string; days: number };
  summary: ActivitySummary;
  timeline: Timeline;
}

/**
 * SEARCH A PERSON AND SEE EVERYTHING THEY DID, AND WHEN.
 *
 * READ-ONLY, with one deliberate exception: the audit row. Nothing else in this
 * file writes, and nothing else in it ever should — a trail that changes what it
 * is showing is not a trail.
 *
 * ── THE AUDIT ROW IS NOT OPTIONAL AND IS NOT BEST-EFFORT ──────────────────
 *
 * It is written BEFORE the reads, and a failure to write it fails the request.
 * Looking at somebody's entire behaviour is itself an act worth recording, and a
 * trail read that quietly succeeded while its audit row was lost would be the
 * one case where "who looked at whom" has no answer. It goes through
 * AdminAuditService like every other staff act; there is no second mechanism.
 *
 * It is also written for a MISS, with found:false. A staff member probing ids
 * that do not exist is exactly the pattern an audit trail is for, and a 404 that
 * left no trace would hide it.
 *
 * ── WHY EIGHT QUERIES AND NOT ONE VIEW ────────────────────────────────────
 *
 * Every row here was written for another reason by a part of Fayr that does not
 * know this screen exists. That is the point: the trail is a READING of records
 * already kept, so nothing had to be instrumented for it and nothing can drift
 * out of step with the thing it describes. A database view would have to be
 * migrated every time any of the eight changed shape.
 *
 * They run together, and the ordering is imposed afterwards by sortAndTrim
 * rather than by the database, because eight queries cannot be ordered against
 * each other in SQL without a union that would have to know all eight shapes.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async forUser(
    staffUserId: string,
    userId: string,
    days: number,
    limit: number,
    now: Date = new Date(),
  ): Promise<UserActivity> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, createdAt: true, setupDoneAt: true },
    });

    await this.audit.record({
      staffUserId,
      action: AUDIT_ACTIONS.USER_ACTIVITY_VIEW,
      targetUserId: user?.id,
      // Ids and numbers. No mobile number, and nothing a person typed: the audit
      // trail is read by more people than this endpoint is.
      metadata: { days, limit, found: user !== null },
    });

    if (!user) throw new NotFoundException('User not found');

    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const within = { gte: from, lte: now };

    const [
      events,
      taskEvents,
      messages,
      handedOver,
      questions,
      withdrawals,
      shops,
      screenshots,
      lapsed,
      totalScreens,
      totalTasks,
      stepRows,
      earliestEvent,
      latestEvent,
    ] = await Promise.all([
      // user_events — what they saw, and where they got to signing up.
      this.prisma.userEvent.findMany({
        where: { userId, at: within },
        select: { id: true, type: true, at: true, payload: true },
      }),
      // task_events — every state change on every offer, with its reason.
      this.prisma.taskEvent.findMany({
        where: { task: { userId }, createdAt: within },
        select: {
          id: true,
          type: true,
          fromState: true,
          toState: true,
          reason: true,
          createdAt: true,
          // The offer's ID as well as its title. The title was already read for
          // the sentence; the id costs nothing beside it and is what lets the
          // screen put one offer's entries together instead of scattering them
          // through a chronological list.
          task: { select: { campaign: { select: { id: true, title: true } } } },
        },
      }),
      // chat_messages — when they wrote in and who answered. Never the body.
      this.prisma.chatMessage.findMany({
        where: { chat: { userId }, sentAt: within },
        select: { id: true, author: true, language: true, sentAt: true },
      }),
      // chats — the moment one was handed to a person.
      this.prisma.chat.findMany({
        where: { userId, handedOverAt: within },
        select: { id: true, handedOverAt: true },
      }),
      // assistant_questions — what they asked about, and whether it landed.
      this.prisma.assistantQuestion.findMany({
        where: { userId, askedAt: within },
        select: {
          id: true,
          askedAt: true,
          answerOrigin: true,
          topic: true,
          helpful: true,
        },
      }),
      // withdrawals — asked for, and decided. Both moments, because the gap
      // between them is what somebody writes in about. A request made before the
      // window but decided inside it still shows its decision.
      this.prisma.withdrawal.findMany({
        where: { userId, OR: [{ requestedAt: within }, { decidedAt: within }] },
        select: {
          id: true,
          amountPaise: true,
          status: true,
          failureReason: true,
          requestedAt: true,
          decidedAt: true,
        },
      }),
      // shop_sign_ins — which marketplace they connected, written down once.
      this.prisma.shopSignIn.findMany({
        where: { userId, firstAt: within },
        select: { id: true, platform: true, firstAt: true, howWeKnew: true },
      }),
      // screenshot_uploads — THAT they sent one. The select is the guarantee:
      // storageKey, sha256, mimetype and sizeBytes are never read here at all.
      //
      // The offer it was sent FOR is read, and only that: a screenshot hangs off
      // a task and a task off exactly one campaign, so which offer it belongs to
      // is on the record rather than inferred. It is the offer's id and title —
      // a product, not a person — and nothing about the image itself.
      this.prisma.screenshotUpload.findMany({
        where: { userId, uploadedAt: within },
        select: {
          id: true,
          kind: true,
          uploadedAt: true,
          task: {
            select: { campaignId: true, campaign: { select: { title: true } } },
          },
        },
      }),
      // refresh_tokens — sessions that reached their expiry un-revoked, which is
      // insights.service.ts's own definition of a session nobody came back to.
      this.prisma.refreshToken.findMany({
        where: { userId, expiresAt: within, revokedAt: null },
        select: { id: true, expiresAt: true },
      }),
      // ── the summary is about the PERSON, not the window ──────────────────
      // A number that changed meaning with a query parameter would be read off
      // the screen as a lifetime total by everybody who did not notice the
      // parameter. Only the timeline is windowed.
      this.prisma.userEvent.count({ where: { userId, type: 'SCREEN_VIEWED' } }),
      this.prisma.task.count({ where: { userId } }),
      this.prisma.userEvent.findMany({
        where: { userId, type: 'SETUP_STEP_DONE' },
        select: { payload: true },
      }),
      this.prisma.userEvent.findFirst({
        where: { userId },
        orderBy: { at: 'asc' },
        select: { at: true },
      }),
      this.prisma.userEvent.findFirst({
        where: { userId },
        orderBy: { at: 'desc' },
        select: { at: true },
      }),
    ]);

    const rows: ActivityRow[] = [
      ...events.map(fromUserEvent),
      ...taskEvents.map((e) =>
        fromTaskEvent({
          ...e,
          offer: e.task.campaign?.title ?? null,
          campaignId: e.task.campaign?.id ?? null,
        }),
      ),
      ...messages.map(fromChatMessage),
      ...handedOver.flatMap((c) =>
        c.handedOverAt ? [fromChatHandover({ id: c.id, handedOverAt: c.handedOverAt })] : [],
      ),
      ...questions.map(fromQuestion),
      ...withdrawals.flatMap((w) => {
        const out: ActivityRow[] = [];
        if (w.requestedAt >= from && w.requestedAt <= now) {
          out.push(fromWithdrawalRequest(w));
        }
        if (w.decidedAt && w.decidedAt >= from && w.decidedAt <= now) {
          out.push(fromWithdrawalDecision({ ...w, decidedAt: w.decidedAt }));
        }
        return out;
      }),
      ...shops.map(fromShopSignIn),
      ...screenshots.map((s) =>
        fromScreenshot({
          ...s,
          campaignId: s.task?.campaignId ?? null,
          campaignTitle: s.task?.campaign?.title ?? null,
        }),
      ),
      ...lapsed.map(fromLapsedSession),
    ];

    // The account being made is the earliest thing there is, and it predates
    // user_events on every account older than that table.
    const firstSeen =
      earliestEvent && earliestEvent.at < user.createdAt
        ? earliestEvent.at
        : user.createdAt;
    const lastSeen = latestEvent?.at ?? user.createdAt;

    const stepsDone = stepRows
      .map((r) => (r.payload as { step?: unknown } | null)?.step)
      .filter((s): s is number => typeof s === 'number');

    const summary: ActivitySummary = {
      firstSeen: firstSeen.toISOString(),
      lastSeen: lastSeen.toISOString(),
      daysQuiet: daysBetween(lastSeen, now),
      totalScreens,
      totalTasks,
      setupFinished: user.setupDoneAt !== null,
      setupStoppedAt: whereSetupStopped(stepsDone, user.setupDoneAt !== null),
    };

    return {
      window: { from: from.toISOString(), to: now.toISOString(), days },
      summary,
      timeline: sortAndTrim(rows, limit),
    };
  }
}
