import { Injectable } from '@nestjs/common';
import type { Campaign, Task } from '@prisma/client';
import { rupeesOf } from '../common/rupees';
import { PrismaService } from '../prisma/prisma.service';
import { ReportService, funnelOf } from '../reports/report.service';
import { WAITING_NOTE_AFTER_MS } from '../chat/chat-words';
import { computeRefundPaise } from '../tasks/engine/money';
import { resolveChargedPaise } from '../tasks/engine/charged-amount';
import { toEngineTask } from '../tasks/task.mapper';
import type {
  CheckRunResponse,
  HowItIsRunningResponse,
  HeldReasonResponse,
  JourneyStepResponse,
  MoneyLine,
  SourceGroupResponse,
} from './running.response';
import {
  addsUpWords,
  counted,
  countedMoney,
  countOrderSources,
  dayWords,
  daysAgo,
  disagreementWords,
  dropBetween,
  factsOf,
  notAStep,
  holdOf,
  noMoneyYet,
  nothingYet,
  notWatching,
  OPEN_STATES,
  readAtWords,
  sameFunnel,
  tallyHeld,
  type JourneyRow,
  type MoneyReading,
  type Reading,
} from './running.rules';
import {
  DO_NOT_KNOW,
  EXPIRED,
  HELD,
  HOW_ORDERS,
  JOURNEY,
  MACHINE,
  MONEY,
  NOBODY_CAN_CLEAR_THIS_ONE,
  NOBODY_CAN_CLEAR_WARNING,
  NOTHING_YET,
  NOT_REAL_YET,
  NOT_WATCHING,
  OFFERS,
  ORDER_SOURCE_GROUPS,
  PAGE,
  STEPS,
  WAITING,
  alsoWaitingWords,
  lastLookedWords,
  moneyHasLeftWords,
} from './running.words';

/** Named so the figure can be traced back to the code that produced it. */
const REFUND_FUNCTION = 'computeRefundPaise, in tasks/engine/money.ts';

type TaskWithCampaign = Task & { campaign: Campaign };

/**
 * THE PAGE THAT MEASURES FAYR ITSELF, read out of the record on open.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
 *
 * It does not count the funnel. funnelOf in report.service.ts counts the funnel,
 * and this calls it, so the page and the spreadsheet cannot drift apart. It does
 * not work out a refund either: computeRefundPaise does that, and it is the same
 * call a real release makes.
 *
 * It does not run either offer check. Both already exist and both record their
 * runs, so this reads the last recorded run. A page that re-ran a check to fill
 * itself in would show a fresh answer and hide the fact that nobody had looked.
 *
 * And it writes nothing at all.
 */
@Injectable()
export class RunningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportService,
  ) {}

  /** Overridable in a check, so a page stamped with a time can be pinned. */
  protected now(): Date {
    return new Date();
  }

  async read(): Promise<HowItIsRunningResponse> {
    const now = this.now();
    // The SAME window the existing report uses by default, taken from the report
    // rather than worked out again. A cohort boundary computed twice is a
    // boundary that will differ by a day at a month end.
    const { start, end } = this.reports.resolveRange({});

    const [tasks, markReviewed, activity, paidWithdrawals] = await Promise.all([
      this.prisma.task.findMany({ include: { campaign: true } }),
      this.prisma.taskEvent.groupBy({
        by: ['taskId'],
        where: { type: 'MARK_REVIEWED' },
        _count: { _all: true },
      }),
      this.reports.activity({}),
      this.prisma.withdrawal.count({ where: { status: 'PAID' } }),
    ]);

    const reviewEvents = new Map(
      markReviewed.map((g) => [g.taskId, g._count._all]),
    );
    const rowOf = (t: TaskWithCampaign): JourneyRow => ({
      state: t.state,
      closeReason: t.closeReason,
      orderId: t.orderId,
      deliveredAt: t.deliveredAt,
      reviewPublished: t.reviewPublished,
      windowEndsAt: t.windowEndsAt,
      orderConfirmed: toEngineTask(t, []).orderConfirmed,
      markReviewedEvents: reviewEvents.get(t.id) ?? 0,
    });

    const inCohort = tasks.filter(
      (t) => t.createdAt >= start && t.createdAt <= end,
    );
    const allRows = tasks.map(rowOf);
    const cohortRows = inCohort.map(rowOf);

    return {
      title: PAGE.title,
      lead: PAGE.lead,
      leadTwo: PAGE.leadTwo,
      leadThree: PAGE.leadThree,
      readAt: readAtWords(now),
      readAtIso: now.toISOString(),
      says: { nothingYet: NOTHING_YET, notWatching: NOT_WATCHING },
      journey: this.journey(
        allRows,
        cohortRows,
        activity.funnel,
        now,
        paidWithdrawals,
      ),
      // Section A's own count of established orders is handed to Section B so the
      // two can be compared rather than assumed equal.
      howOrders: this.howOrders(tasks, factsOf(allRows, now).orderEstablished),
      money: await this.money(tasks, paidWithdrawals),
      machine: await this.machine(tasks, now),
      offers: await this.offers(now),
      notRealYet: {
        title: NOT_REAL_YET.title,
        lead: NOT_REAL_YET.lead,
        items: [...NOT_REAL_YET.items],
      },
    };
  }

  // ── Section A ──────────────────────────────────────────────────────────────

  private journey(
    allRows: readonly JourneyRow[],
    cohortRows: readonly JourneyRow[],
    reportFunnel: ReturnType<typeof funnelOf>,
    now: Date,
    paidWithdrawals: number,
  ): HowItIsRunningResponse['journey'] {
    const all = factsOf(allRows, now);
    const cohort = factsOf(cohortRows, now);
    const allFunnel = funnelOf(allRows);
    const cohortFunnel = funnelOf(cohortRows);

    const step = (
      words: { step: string; meaning: string; whatItWouldTake?: string },
      soFar: Reading,
      thirty: Reading,
      disagreement: string | null = null,
      onThePath = true,
    ): JourneyStepResponse => ({
      step: words.step,
      meaning: words.meaning,
      whatItWouldTake: words.whatItWouldTake ?? null,
      everythingSoFar: soFar,
      lastThirtyDays: thirty,
      onThePath,
      dropSoFar: null,
      dropLastThirtyDays: null,
      disagreement,
    });

    const steps: JourneyStepResponse[] = [
      step(STEPS.tookAPlace, counted(all.tookAPlace), counted(cohort.tookAPlace)),
      step(
        STEPS.wentToTheShop,
        notWatching(STEPS.wentToTheShop.whatItWouldTake),
        notWatching(STEPS.wentToTheShop.whatItWouldTake),
      ),
      step(
        STEPS.signedInAtTheShop,
        notWatching(STEPS.signedInAtTheShop.whatItWouldTake),
        notWatching(STEPS.signedInAtTheShop.whatItWouldTake),
      ),
      step(
        STEPS.gaveUsTheirOrder,
        counted(all.gaveUsTheirOrder),
        counted(cohort.gaveUsTheirOrder),
        null,
        false,
      ),
      step(
        STEPS.orderEstablished,
        counted(all.orderEstablished),
        counted(cohort.orderEstablished),
        // The state-based count of the same step, named rather than merged.
        disagreementWords(
          all.orderEstablished,
          allFunnel.purchased,
          JOURNEY.bySittingStep,
        ),
      ),
      step(
        STEPS.productArrived,
        counted(all.productArrived),
        counted(cohort.productArrived),
        disagreementWords(
          all.productArrived,
          allFunnel.delivered,
          JOURNEY.bySittingStep,
        ),
      ),
      step(
        STEPS.reviewFoundLive,
        counted(all.reviewFoundLive),
        counted(cohort.reviewFoundLive),
        disagreementWords(
          all.reviewFoundLive,
          all.reviewStepReached,
          JOURNEY.byReviewStep,
        ),
      ),
      step(
        STEPS.returnTimeFinished,
        counted(all.returnTimeFinished),
        counted(cohort.returnTimeFinished),
      ),
      step(
        STEPS.refundReleased,
        counted(allFunnel.refunded),
        counted(cohortFunnel.refunded),
      ),
      step(
        STEPS.moneyTakenOut,
        counted(paidWithdrawals),
        counted(paidWithdrawals),
      ),
    ];

    // The drop, worked out down the list once it is built. A step compares itself
    // with the last step that is ON THE WAY above it, so a step off the path
    // neither shows a drop nor breaks the chain for the step below it.
    let lastOnThePath: JourneyStepResponse | null = null;
    for (const one of steps) {
      if (!one.onThePath) {
        one.dropSoFar = notAStep(JOURNEY.notAStepOnTheWay);
        one.dropLastThirtyDays = notAStep(JOURNEY.notAStepOnTheWay);
        continue;
      }
      if (lastOnThePath != null) {
        one.dropSoFar = dropBetween(
          lastOnThePath.everythingSoFar,
          one.everythingSoFar,
        );
        one.dropLastThirtyDays = dropBetween(
          lastOnThePath.lastThirtyDays,
          one.lastThirtyDays,
        );
      }
      lastOnThePath = one;
    }

    const sameToday =
      all.tookAPlace === cohort.tookAPlace && all.tookAPlace > 0;
    // Proof, not a promise. Both sides come from funnelOf, so this is true by
    // construction, and it is checked anyway: a page that claims to agree with
    // the report should be able to show that it looked.
    const agrees = sameFunnel(cohortFunnel, reportFunnel);

    return {
      title: JOURNEY.title,
      lead: JOURNEY.lead,
      everythingSoFarLabel: JOURNEY.everythingSoFar,
      everythingSoFarMeaning: JOURNEY.everythingSoFarMeaning,
      lastThirtyDaysLabel: JOURNEY.lastThirtyDays,
      lastThirtyDaysMeaning: JOURNEY.lastThirtyDaysMeaning,
      bothMatchToday: sameToday ? JOURNEY.bothMatchToday : null,
      whereTheyAreNow: JOURNEY.whereTheyAreNow,
      canGoBackwards: JOURNEY.canGoBackwards,
      stepHeading: JOURNEY.stepHeading,
      dropHeading: JOURNEY.dropHeading,
      steps,
      expired: {
        step: EXPIRED.step,
        meaning: EXPIRED.meaning,
        everythingSoFar: counted(allFunnel.expired),
        lastThirtyDays: counted(cohortFunnel.expired),
      },
      disagreesWithTheReports: agrees ? null : JOURNEY.disagreesWithTheReports,
      agreesWithActivityReport: agrees,
    };
  }

  // ── Section B ──────────────────────────────────────────────────────────────

  private howOrders(
    tasks: readonly TaskWithCampaign[],
    establishedInTheJourney: number,
  ): HowItIsRunningResponse['howOrders'] {
    // ONE entry per place WITH AN ORDER, and nothing else. A place with no order
    // is not an established order, and letting one in here would break the
    // adding-up rule in the one direction nobody would notice.
    const sources = tasks
      .filter((t) => t.orderId != null)
      .map((t) => toEngineTask(t, []).order?.source ?? null);
    const tally = countOrderSources(sources, establishedInTheJourney);
    const byKey = new Map(tally.groups.map((g) => [g.key, g.count]));

    const groups: SourceGroupResponse[] = ORDER_SOURCE_GROUPS.map((g) => ({
      heading: g.heading,
      meaning: g.meaning,
      names: [...g.names],
      count: counted(byKey.get(g.key) ?? 0),
    }));

    return {
      title: HOW_ORDERS.title,
      lead: HOW_ORDERS.lead,
      groups,
      doNotKnow: {
        heading: DO_NOT_KNOW.heading,
        meaning: DO_NOT_KNOW.meaning,
        names: [],
        count: counted(tally.doNotKnow),
      },
      established: counted(tally.established),
      addsUp: tally.addsUp,
      addsUpConfirmed: HOW_ORDERS.addsUp,
      addsUpProblem: addsUpWords(tally),
      establishedLabel: HOW_ORDERS.establishedLabel,
      countHeading: HOW_ORDERS.countHeading,
      namesHeading: HOW_ORDERS.namesHeading,
      unmappedHeading: HOW_ORDERS.unmappedHeading,
      unmappedNames: tally.unmappedNames,
      candidatesNote: HOW_ORDERS.candidatesNote,
    };
  }

  // ── Section C ──────────────────────────────────────────────────────────────

  private async money(
    tasks: readonly TaskWithCampaign[],
    paidCount: number,
  ): Promise<HowItIsRunningResponse['money']> {
    // The refunds figure comes from the payouts report, over the whole of Fayr's
    // life rather than a window. The earliest thing on record is read out of the
    // record too, so nobody has to hard-write a date that becomes wrong.
    const earliest = await this.earliestMoneyMoment();
    const payouts =
      earliest == null
        ? null
        : await this.reports.payouts({ from: earliest.toISOString().slice(0, 10) });

    const [userPaise, payoutPaise] = await Promise.all([
      this.sumOfAccounts('USER'),
      this.sumOfAccounts('PAYOUT'),
    ]);

    const lines: MoneyLine[] = [
      {
        label: MONEY.refundsReleased,
        meaning: MONEY.refundsReleasedMeaning,
        amount:
          payouts == null
            ? noMoneyYet()
            : ({
                kind: 'counted',
                paise: payouts.refundsCreditedPaise,
              } as MoneyReading),
      },
      {
        label: MONEY.sittingInWallets,
        meaning: MONEY.sittingInWalletsMeaning,
        amount: countedMoney(userPaise),
      },
      {
        label: MONEY.inHoldingAccount,
        meaning: MONEY.inHoldingAccountMeaning,
        amount: countedMoney(payoutPaise),
      },
    ];

    // ── waiting, and held. Two different things, counted apart. ─────────────
    const open = tasks.filter((t) => OPEN_STATES.includes(t.state));
    const heldReasons: string[] = [];
    const heldIds = new Set<string>();
    for (const t of open) {
      const reason = holdOf(toEngineTask(t, []).order);
      if (reason != null) {
        heldReasons.push(reason);
        heldIds.add(t.id);
      }
    }
    const held = tallyHeld(heldReasons);

    const waitingTasks = tasks.filter((t) => t.state === 'HOLDING');
    let wouldPay = 0n;
    let cannotWorkOut = 0;
    for (const t of waitingTasks) {
      const order = toEngineTask(t, []).order;
      const charged = resolveChargedPaise(order);
      if (charged.paise == null) {
        cannotWorkOut += 1;
        continue;
      }
      // The SAME call a real release makes. A second sum here would be the fifth
      // money defect from a number reached by a second route.
      wouldPay += computeRefundPaise(
        charged.paise,
        t.campaign.payoutPercent,
        t.campaign.payoutCapPaise,
      );
    }
    const bothWaitingAndHeld = waitingTasks.filter((t) =>
      heldIds.has(t.id),
    ).length;
    const nobodyCanClearCount = held.rows.filter(
      (r) => r.nobodyCanClearIt && r.count > 0,
    ).length;

    const reasons: HeldReasonResponse[] = held.rows.map((r) => ({
      explanation: r.explanation,
      reason: r.reason,
      count: counted(r.count),
      nobodyCanClearIt: r.nobodyCanClearIt,
      nobodyCanClearThisOne:
        r.nobodyCanClearIt && r.count > 0 ? NOBODY_CAN_CLEAR_THIS_ONE : null,
    }));

    return {
      title: MONEY.title,
      lead: MONEY.lead,
      lines,
      hasLeftFayr: {
        label: MONEY.hasLeftFayr,
        // NOT a hole to be filled in later. The money book records no movement
        // out, and it is right: Fayr cannot send money. Writing an entry when a
        // payout is marked paid would make the book say money left when it did
        // not, which is the one change this page must never cause.
        amount: countedMoney(0n),
        words: moneyHasLeftWords(paidCount, rupeesOf(payoutPaise)),
      },
      waiting: {
        title: WAITING.title,
        lead: WAITING.lead,
        countLabel: WAITING.count,
        count: counted(waitingTasks.length),
        wouldPayLabel: WAITING.wouldPay,
        wouldPayMeaning: WAITING.wouldPayMeaning,
        workedOutBy: REFUND_FUNCTION,
        wouldPay:
          waitingTasks.length === 0 ? noMoneyYet() : countedMoney(wouldPay),
        cannotWorkOutLabel: WAITING.cannotWorkOut,
        cannotWorkOutMeaning: WAITING.cannotWorkOutMeaning,
        cannotWorkOut: counted(cannotWorkOut),
      },
      held: {
        title: HELD.title,
        leadOne: HELD.leadOne,
        leadTwo: HELD.leadTwo,
        theRule: HELD.theRule,
        allSix: HELD.allSix,
        reasonHeading: HELD.reasonHeading,
        countHeading: HELD.countHeading,
        reasons,
        total: counted(held.total),
        alsoWaiting: alsoWaitingWords(bothWaitingAndHeld),
        nobodyCanClearWarning:
          nobodyCanClearCount > 0 ? NOBODY_CAN_CLEAR_WARNING : null,
      },
    };
  }

  /** The whole of one system account, in integer paise. */
  private async sumOfAccounts(kind: 'USER' | 'PAYOUT'): Promise<bigint> {
    const agg = await this.prisma.walletEntry.aggregate({
      _sum: { amountPaise: true },
      where: { account: { kind } },
    });
    return agg._sum.amountPaise ?? 0n;
  }

  /** The first moment money moved at all, or null when it never has. */
  private async earliestMoneyMoment(): Promise<Date | null> {
    const [txn, withdrawal] = await Promise.all([
      this.prisma.ledgerTransaction.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.withdrawal.findFirst({
        orderBy: { requestedAt: 'asc' },
        select: { requestedAt: true },
      }),
    ]);
    const dates = [txn?.createdAt, withdrawal?.requestedAt].filter(
      (d): d is Date => d != null,
    );
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a < b ? a : b));
  }

  // ── Section D ──────────────────────────────────────────────────────────────

  private async machine(
    tasks: readonly TaskWithCampaign[],
    now: Date,
  ): Promise<HowItIsRunningResponse['machine']> {
    // Both deadlines are ones Fayr set itself. Nothing here is a number somebody
    // chose for this page: a place carries its own deadline from the moment it is
    // taken, and a wait carries the shop's own return time.
    const overdueClaims = tasks.filter(
      (t) =>
        t.state === 'CLAIMED'
        && t.closeReason == null
        && t.claimExpiresAt != null
        && t.claimExpiresAt.getTime() < now.getTime(),
    ).length;
    const overdueHolds = tasks.filter(
      (t) =>
        t.state === 'HOLDING'
        && t.windowEndsAt != null
        && t.windowEndsAt.getTime() < now.getTime(),
    ).length;

    // Two minutes, because that is what Fayr already tells the person waiting.
    //
    // Counted from handedOverAt, NOT from startedAt. A conversation can begin at
    // nine, run with the assistant for an hour, and only then be handed to a
    // person: from startedAt that reads as an hour of waiting when nobody has
    // waited at all. The database's own rule that a waiting chat must carry a
    // handedOverAt is what caught this while the check was being written.
    const tooLate = new Date(now.getTime() - WAITING_NOTE_AFTER_MS);
    const [slowChats, failedPayouts] = await Promise.all([
      this.prisma.chat.count({
        where: { state: 'WAITING_FOR_PERSON', handedOverAt: { lt: tooLate } },
      }),
      this.prisma.withdrawal.count({ where: { status: 'FAILED' } }),
    ]);

    return {
      title: MACHINE.title,
      lead: MACHINE.lead,
      rows: [
        {
          label: MACHINE.overdueClaims,
          meaning: MACHINE.overdueClaimsMeaning,
          reading: counted(overdueClaims),
        },
        {
          label: MACHINE.overdueHolds,
          meaning: MACHINE.overdueHoldsMeaning,
          reading: counted(overdueHolds),
        },
        {
          label: MACHINE.slowChats,
          meaning: MACHINE.slowChatsMeaning,
          reading: counted(slowChats),
        },
        {
          label: MACHINE.failedPayouts,
          meaning: MACHINE.failedPayoutsMeaning,
          reading: counted(failedPayouts),
        },
        {
          label: MACHINE.unreadableOffers,
          meaning: MACHINE.unreadableOffersMeaning,
          reading: notWatching(MACHINE.unreadableOffersWouldTake),
        },
        {
          label: MACHINE.brokenOrderReading,
          meaning: MACHINE.brokenOrderReadingMeaning,
          reading: notWatching(MACHINE.brokenOrderReadingWouldTake),
        },
        {
          label: MACHINE.failedMessages,
          meaning: MACHINE.failedMessagesMeaning,
          reading: notWatching(MACHINE.failedMessagesWouldTake),
        },
      ],
    };
  }

  // ── Section E ──────────────────────────────────────────────────────────────

  private async offers(now: Date): Promise<HowItIsRunningResponse['offers']> {
    const [nightly, livePage] = await Promise.all([
      this.prisma.campaignCheckRun.findFirst({ orderBy: { ranAt: 'desc' } }),
      this.prisma.livePageCheckRun.findFirst({ orderBy: { ranAt: 'desc' } }),
    ]);

    const nightlyRun: CheckRunResponse = {
      label: OFFERS.nightly,
      meaning: OFFERS.nightlyMeaning,
      lastLooked:
        nightly == null
          ? null
          : lastLookedWords(dayWords(nightly.ranAt), daysAgo(nightly.ranAt, now)),
      neverRun: nightly == null ? OFFERS.neverRun : null,
      howItStarted:
        nightly == null
          ? null
          : nightly.trigger === 'MANUAL'
            ? OFFERS.byHand
            : OFFERS.byTheClock,
      counts:
        nightly == null
          ? [
              { label: OFFERS.checked, reading: nothingYet() },
              { label: OFFERS.blocking, reading: nothingYet() },
              { label: OFFERS.attention, reading: nothingYet() },
              { label: OFFERS.unchecked, reading: nothingYet() },
            ]
          : [
              { label: OFFERS.checked, reading: counted(nightly.checked) },
              { label: OFFERS.blocking, reading: counted(nightly.blocking) },
              { label: OFFERS.attention, reading: counted(nightly.attention) },
              { label: OFFERS.unchecked, reading: counted(nightly.unchecked) },
            ],
    };

    const livePageRun: CheckRunResponse = {
      label: OFFERS.livePages,
      meaning: OFFERS.livePagesMeaning,
      lastLooked:
        livePage == null
          ? null
          : lastLookedWords(
              dayWords(livePage.ranAt),
              daysAgo(livePage.ranAt, now),
            ),
      neverRun: livePage == null ? OFFERS.neverRun : null,
      howItStarted: livePage == null ? null : OFFERS.byHand,
      counts:
        livePage == null
          ? [
              { label: OFFERS.checked, reading: nothingYet() },
              { label: OFFERS.unchecked, reading: nothingYet() },
            ]
          : [
              { label: OFFERS.checked, reading: counted(livePage.checked) },
              {
                label: OFFERS.unchecked,
                reading: counted(livePage.couldNotOpen),
              },
            ],
    };

    return {
      title: OFFERS.title,
      lead: OFFERS.lead,
      runs: [nightlyRun, livePageRun],
    };
  }
}
