import { BadRequestException, Injectable } from '@nestjs/common';
import type { TaskState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ReportRangeQuery } from './dto/report-range.query';
import type {
  ActivityReport,
  CampaignPerfReport,
  CampaignPerfRow,
  PayoutsReport,
  ReportRange,
  UserGrowthReport,
} from './report.types';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Task states that mean the purchase happened (everything past CLAIMED). */
const PURCHASED_SET: TaskState[] = [
  'PURCHASED',
  'DELIVERED',
  'REVIEWED',
  'HOLDING',
  'REFUNDED',
];
const DELIVERED_SET: TaskState[] = [
  'DELIVERED',
  'REVIEWED',
  'HOLDING',
  'REFUNDED',
];
const REVIEWED_SET: TaskState[] = ['REVIEWED', 'HOLDING', 'REFUNDED'];
const HOLDING_SET: TaskState[] = ['HOLDING', 'REFUNDED'];

const WITHDRAWAL_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'PAID',
  'REJECTED',
  'FAILED',
] as const;

/** A resolved, validated range plus the bucketing for its time series. */
interface ResolvedRange {
  start: Date;
  end: Date;
  range: ReportRange;
  keys: string[];
  keyOf: (d: Date) => string;
}

const bigToStr = (b: bigint | null | undefined): string => (b ?? 0n).toString();
const pct = (num: number, den: number): number =>
  den > 0 ? Math.round((num / den) * 100) : 0;

/**
 * Read-only analytics over the domain tables (tasks, campaigns, withdrawals,
 * wallet + ticket ledgers, users). Every method takes the raw query, resolves
 * the range once, and returns a JSON-safe report (money as decimal-string paise).
 * Nothing here mutates a ledger — it only aggregates. The controller layer adds
 * RBAC, the Excel rendering, and the download audit.
 */
@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve from/to into inclusive UTC day boundaries (default: last 30 days),
   * pick the bucket granularity, and precompute the ordered bucket keys + a
   * date→bucket mapper so empty buckets still appear as zero in a series.
   */
  resolveRange(q: ReportRangeQuery): ResolvedRange {
    const now = new Date();
    const end = q.to ? new Date(q.to) : now;
    end.setUTCHours(23, 59, 59, 999);
    const start = q.from
      ? new Date(q.from)
      : new Date(end.getTime() - 29 * DAY);
    start.setUTCHours(0, 0, 0, 0);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    if (start > end) {
      throw new BadRequestException('`from` must be on or before `to`');
    }

    const spanDays = (end.getTime() - start.getTime()) / DAY;
    const granularity = q.granularity ?? (spanDays > 45 ? 'week' : 'day');

    const step = granularity === 'week' ? WEEK : DAY;
    const startMs = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    );
    const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
    const keys: string[] = [];
    for (let t = startMs; t <= end.getTime(); t += step) {
      keys.push(dayKey(new Date(t)));
    }
    if (keys.length === 0) keys.push(dayKey(new Date(startMs)));
    const keyOf = (d: Date): string => {
      const idx = Math.floor((d.getTime() - startMs) / step);
      return keys[Math.max(0, Math.min(idx, keys.length - 1))];
    };

    return {
      start,
      end,
      range: { from: start.toISOString(), to: end.toISOString(), granularity },
      keys,
      keyOf,
    };
  }

  // ── Report 1: campaign / offers performance ───────────────────────────────
  async campaignPerformance(q: ReportRangeQuery): Promise<CampaignPerfReport> {
    const { start, end, range } = this.resolveRange(q);
    const where = { createdAt: { gte: start, lte: end } };

    const [byState, expired] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['campaignId', 'state'],
        where,
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['campaignId'],
        where: { ...where, closeReason: 'expired' },
        _count: { _all: true },
      }),
    ]);

    const stateCounts = new Map<string, Map<TaskState, number>>();
    for (const g of byState) {
      const m = stateCounts.get(g.campaignId) ?? new Map<TaskState, number>();
      m.set(g.state, g._count._all);
      stateCounts.set(g.campaignId, m);
    }
    const expiredById = new Map<string, number>(
      expired.map((g) => [g.campaignId, g._count._all]),
    );

    const ids = [...stateCounts.keys()];
    const campaigns = await this.prisma.campaign.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        platform: true,
        status: true,
        totalSlots: true,
      },
    });
    const meta = new Map(campaigns.map((c) => [c.id, c]));

    const sumIn = (m: Map<TaskState, number>, states: TaskState[]): number =>
      states.reduce((n, s) => n + (m.get(s) ?? 0), 0);

    const rows: CampaignPerfRow[] = ids.map((id) => {
      const m = stateCounts.get(id) ?? new Map<TaskState, number>();
      const claims = [...m.values()].reduce((a, b) => a + b, 0);
      const purchases = sumIn(m, PURCHASED_SET);
      const reviews = sumIn(m, REVIEWED_SET);
      const refunds = m.get('REFUNDED') ?? 0;
      const c = meta.get(id);
      return {
        campaignId: id,
        title: c?.title ?? '(deleted campaign)',
        platform: c?.platform ?? '—',
        status: c?.status ?? '—',
        totalSlots: c?.totalSlots ?? null,
        claims,
        purchases,
        reviews,
        refunds,
        expired: expiredById.get(id) ?? 0,
        purchaseConversionPct: pct(purchases, claims),
        refundConversionPct: pct(refunds, claims),
        fillRatePct: c?.totalSlots ? pct(claims, c.totalSlots) : null,
      };
    });
    rows.sort((a, b) => b.claims - a.claims);

    return {
      range,
      totals: {
        campaigns: rows.length,
        claims: rows.reduce((n, r) => n + r.claims, 0),
        purchases: rows.reduce((n, r) => n + r.purchases, 0),
        reviews: rows.reduce((n, r) => n + r.reviews, 0),
        refunds: rows.reduce((n, r) => n + r.refunds, 0),
      },
      rows,
    };
  }

  // ── Report 2: payouts / financial ─────────────────────────────────────────
  async payouts(q: ReportRangeQuery): Promise<PayoutsReport> {
    const { start, end, range, keys, keyOf } = this.resolveRange(q);
    const inRange = { gte: start, lte: end };

    const [refundAgg, byStatus, paidAgg, compAgg, refundLegs, paidRows] =
      await Promise.all([
        this.prisma.walletEntry.aggregate({
          _sum: { amountPaise: true },
          _count: { _all: true },
          where: {
            amountPaise: { gt: 0 },
            transaction: { kind: 'REFUND', createdAt: inRange },
          },
        }),
        this.prisma.withdrawal.groupBy({
          by: ['status'],
          where: { requestedAt: inRange },
          _count: { _all: true },
          _sum: { amountPaise: true },
        }),
        this.prisma.withdrawal.aggregate({
          _sum: { amountPaise: true },
          _count: { _all: true },
          where: { status: 'PAID', decidedAt: inRange },
        }),
        this.prisma.ticketEntry.aggregate({
          _count: { _all: true },
          _sum: { delta: true },
          where: { reason: 'COMPLETION_RETURN', createdAt: inRange },
        }),
        this.prisma.walletEntry.findMany({
          where: {
            amountPaise: { gt: 0 },
            transaction: { kind: 'REFUND', createdAt: inRange },
          },
          select: {
            amountPaise: true,
            transaction: { select: { createdAt: true } },
          },
        }),
        this.prisma.withdrawal.findMany({
          where: { status: 'PAID', decidedAt: inRange },
          select: { amountPaise: true, decidedAt: true },
        }),
      ]);

    const statusMap = new Map(byStatus.map((g) => [g.status, g]));
    const withdrawalsByStatus = WITHDRAWAL_STATUSES.map((status) => {
      const g = statusMap.get(status);
      return {
        status,
        count: g?._count._all ?? 0,
        totalPaise: bigToStr(g?._sum.amountPaise ?? 0n),
      };
    });

    // Time series: refunds credited (by txn date) + paid out (by decision date).
    const refundBucket = new Map<string, bigint>(keys.map((k) => [k, 0n]));
    for (const e of refundLegs) {
      const k = keyOf(e.transaction.createdAt);
      refundBucket.set(k, (refundBucket.get(k) ?? 0n) + e.amountPaise);
    }
    const paidBucket = new Map<string, bigint>(keys.map((k) => [k, 0n]));
    for (const w of paidRows) {
      if (!w.decidedAt) continue;
      const k = keyOf(w.decidedAt);
      paidBucket.set(k, (paidBucket.get(k) ?? 0n) + w.amountPaise);
    }
    const series = keys.map((k) => ({
      bucket: k,
      refundsPaise: bigToStr(refundBucket.get(k) ?? 0n),
      paidOutPaise: bigToStr(paidBucket.get(k) ?? 0n),
    }));

    return {
      range,
      refundsCreditedPaise: bigToStr(refundAgg._sum.amountPaise),
      refundsCreditedCount: refundAgg._count._all,
      withdrawalsByStatus,
      paidOutPaise: bigToStr(paidAgg._sum.amountPaise),
      paidOutCount: paidAgg._count._all,
      completionGrants: compAgg._count._all,
      completionTicketsTotal: compAgg._sum.delta ?? 0,
      series,
    };
  }

  // ── Report 3: activity funnel over time ───────────────────────────────────
  async activity(q: ReportRangeQuery): Promise<ActivityReport> {
    const { start, end, range, keys, keyOf } = this.resolveRange(q);
    const inRange = { gte: start, lte: end };

    const [created, refundedInPeriod] = await Promise.all([
      this.prisma.task.findMany({
        where: { createdAt: inRange },
        select: { createdAt: true, state: true, closeReason: true },
      }),
      this.prisma.task.findMany({
        where: { state: 'REFUNDED', closedAt: inRange },
        select: { closedAt: true },
      }),
    ]);

    const reached = (state: TaskState, set: TaskState[]): boolean =>
      set.includes(state);
    const funnel = {
      claimed: created.length,
      purchased: created.filter((t) => reached(t.state, PURCHASED_SET)).length,
      delivered: created.filter((t) => reached(t.state, DELIVERED_SET)).length,
      reviewed: created.filter((t) => reached(t.state, REVIEWED_SET)).length,
      holding: created.filter((t) => reached(t.state, HOLDING_SET)).length,
      refunded: created.filter((t) => t.state === 'REFUNDED').length,
      expired: created.filter((t) => t.closeReason === 'expired').length,
    };

    const claimsBucket = new Map<string, number>(keys.map((k) => [k, 0]));
    for (const t of created) {
      const k = keyOf(t.createdAt);
      claimsBucket.set(k, (claimsBucket.get(k) ?? 0) + 1);
    }
    const refundsBucket = new Map<string, number>(keys.map((k) => [k, 0]));
    for (const t of refundedInPeriod) {
      if (!t.closedAt) continue;
      const k = keyOf(t.closedAt);
      refundsBucket.set(k, (refundsBucket.get(k) ?? 0) + 1);
    }
    const series = keys.map((k) => ({
      bucket: k,
      claims: claimsBucket.get(k) ?? 0,
      refunds: refundsBucket.get(k) ?? 0,
    }));

    return { range, funnel, series };
  }

  // ── Report 4: user growth ─────────────────────────────────────────────────
  async userGrowth(q: ReportRangeQuery): Promise<UserGrowthReport> {
    const { start, end, range, keys, keyOf } = this.resolveRange(q);
    const inRange = { gte: start, lte: end };

    const [signups, claimers, baseline] = await Promise.all([
      this.prisma.user.findMany({
        where: { createdAt: inRange },
        select: { createdAt: true },
      }),
      this.prisma.task.findMany({
        where: { createdAt: inRange },
        select: { createdAt: true, userId: true },
      }),
      this.prisma.user.count({ where: { createdAt: { lt: start } } }),
    ]);

    const signupBucket = new Map<string, number>(keys.map((k) => [k, 0]));
    for (const u of signups) {
      const k = keyOf(u.createdAt);
      signupBucket.set(k, (signupBucket.get(k) ?? 0) + 1);
    }
    const claimerBucket = new Map<string, Set<string>>(
      keys.map((k) => [k, new Set<string>()]),
    );
    for (const t of claimers) {
      claimerBucket.get(keyOf(t.createdAt))?.add(t.userId);
    }
    const activeClaimers = new Set(claimers.map((t) => t.userId)).size;

    let running = baseline;
    const series = keys.map((k) => {
      running += signupBucket.get(k) ?? 0;
      return {
        bucket: k,
        signups: signupBucket.get(k) ?? 0,
        activeClaimers: claimerBucket.get(k)?.size ?? 0,
        cumulative: running,
      };
    });

    return {
      range,
      newSignups: signups.length,
      activeClaimers,
      cumulativeUsers: baseline + signups.length,
      series,
    };
  }
}
