import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildFunnel, worstDrop, rate, type FunnelStep } from './funnel';

/** How far back a dashboard is looking. */
export interface Window {
  from: Date;
  to: Date;
}

/** What the sign-in and session numbers come back as. */
export interface SessionNumbers {
  /** Sessions that ran out without ever being renewed. */
  expiredUnused: number;
  /** People who signed in again after one of theirs had run out. */
  cameBack: number;
  /** Share of those people who came back. Null when none ran out. */
  cameBackRate: number | null;
  /** People who signed out on purpose. */
  signedOut: number;
  /** How many days a session lasts before it needs a new sign-in. */
  sessionDays: number;
}

/** Everything one dashboard read hands back. */
export interface Insights {
  window: { from: string; to: string; days: number };
  funnel: FunnelStep[];
  worst: { key: string; label: string; dropped: number } | null;
  codesRequested: number;
  codesVerified: number;
  /** Requested against verified. The number that catches SMS failing. */
  codeDeliveryRate: number | null;
  sessions: SessionNumbers;
}

/**
 * THE NUMBERS, READ FROM WHAT FAYR ALREADY WROTE DOWN.
 *
 * Read-only. Nothing in this file writes anything, and nothing in it is allowed
 * to: a dashboard that changes what it is measuring is not a dashboard.
 *
 * ── WHERE EACH FIGURE COMES FROM, AND WHY IT IS NOT ALL ONE TABLE ─────────
 *
 * Most of this funnel has been recorded since the day Fayr was built, in tables
 * that were written for other reasons — every code request is a row in
 * otp_challenges, every account is a row in users, every first claim is a task.
 * Those are used directly. They are the truth, they go back to the beginning,
 * and re-deriving them from a new events table would throw away every month of
 * history we already have.
 *
 * user_events fills the gap in front of those: opening the app, reading
 * onboarding, reaching the phone screen. The server never sees any of that, so
 * nothing else could know it.
 *
 * The seam is deliberate and the comment on each query says which side it is on.
 */
@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The default look-back, when nobody says. */
  static readonly DEFAULT_DAYS = 30;

  windowOf(days: number, now: Date = new Date()): Window {
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { from, to: now };
  }

  async read(days: number, now: Date = new Date()): Promise<Insights> {
    const w = this.windowOf(days, now);
    const within = { gte: w.from, lte: w.to };

    // ── in front of the account: only user_events knows ────────────────────
    const [opened, onboarded, reachedPhone] = await Promise.all([
      this.countDistinct('APP_OPENED', w),
      this.countDistinct('ONBOARDING_DONE', w),
      this.countDistinct('PHONE_ENTRY_SEEN', w),
    ]);

    // ── from the code onward: the original tables, which go back further ────
    //
    // Distinct on the NUMBER, not on rows: somebody who asks three times because
    // the first two never arrived is one person trying to get in, and counting
    // them three times would make delivery look better the worse it got.
    const requestedRows = await this.prisma.otpChallenge.findMany({
      where: { createdAt: within },
      select: { mobile: true, consumedAt: true },
    });
    const askedNumbers = new Set(requestedRows.map((r) => r.mobile));
    const verifiedNumbers = new Set(
      requestedRows.filter((r) => r.consumedAt !== null).map((r) => r.mobile),
    );

    const [accountsMade, setupFinished, everClaimed] = await Promise.all([
      this.prisma.user.count({ where: { createdAt: within } }),
      this.prisma.user.count({ where: { setupDoneAt: within } }),
      this.prisma.user
        .findMany({
          where: { createdAt: within, tasks: { some: {} } },
          select: { id: true },
        })
        .then((rows) => rows.length),
    ]);

    const funnel = buildFunnel([
      { key: 'opened', label: 'Opened the app', count: opened },
      { key: 'onboarded', label: 'Finished onboarding', count: onboarded },
      { key: 'phone', label: 'Reached the phone screen', count: reachedPhone },
      { key: 'asked', label: 'Asked for a code', count: askedNumbers.size },
      { key: 'verified', label: 'Entered a correct code', count: verifiedNumbers.size },
      { key: 'account', label: 'Account created', count: accountsMade },
      { key: 'setup', label: 'Finished setup', count: setupFinished },
      { key: 'claimed', label: 'Claimed a campaign', count: everClaimed },
    ]);

    const worst = worstDrop(funnel);

    return {
      window: { from: w.from.toISOString(), to: w.to.toISOString(), days },
      funnel,
      worst: worst
        ? { key: worst.key, label: worst.label, dropped: worst.dropped }
        : null,
      codesRequested: askedNumbers.size,
      codesVerified: verifiedNumbers.size,
      codeDeliveryRate: rate(verifiedNumbers.size, askedNumbers.size),
      sessions: await this.sessions(w),
    };
  }

  /**
   * HOW MANY PEOPLE, not how many rows.
   *
   * A person who opens the app nine times in a week is one person in a funnel.
   * Before there is an account that identity is the app's own anonymous id, so
   * that is what gets counted; a row with neither id is real data about a step
   * being reached and is counted as one, which is the honest reading of
   * "somebody did this and we do not know who".
   */
  private async countDistinct(
    type: 'APP_OPENED' | 'ONBOARDING_DONE' | 'PHONE_ENTRY_SEEN' | 'FEED_OPENED',
    w: Window,
  ): Promise<number> {
    const rows = await this.prisma.userEvent.findMany({
      where: { type, at: { gte: w.from, lte: w.to } },
      select: { userId: true, anonymousId: true },
    });
    const seen = new Set<string>();
    let unknown = 0;
    for (const r of rows) {
      const who = r.userId ?? r.anonymousId;
      if (who) seen.add(who);
      else unknown += 1;
    }
    return seen.size + unknown;
  }

  /**
   * SESSIONS THAT RAN OUT, AND WHO CAME BACK AFTERWARDS.
   *
   * "Ran out unused" is a token that reached its expiry without being revoked.
   * Revoked means it was rotated — somebody opened the app and it renewed — or
   * they signed out, and both of those are people we did not lose to a timer.
   *
   * "Came back" is deliberately NOT "has a newer session". A person can end up
   * with a newer session for reasons that are not them choosing to return. It is
   * a verified code AFTER the moment theirs ran out, which is the actual act of
   * a person being asked to sign in again and doing it.
   */
  private async sessions(w: Window): Promise<SessionNumbers> {
    const expired = await this.prisma.refreshToken.findMany({
      where: { expiresAt: { gte: w.from, lte: w.to }, revokedAt: null },
      select: { userId: true, expiresAt: true },
    });

    const firstExpiry = new Map<string, Date>();
    for (const t of expired) {
      const seen = firstExpiry.get(t.userId);
      if (!seen || t.expiresAt < seen) firstExpiry.set(t.userId, t.expiresAt);
    }

    let cameBack = 0;
    if (firstExpiry.size > 0) {
      const returns = await this.prisma.otpChallenge.findMany({
        where: {
          userId: { in: [...firstExpiry.keys()] },
          consumedAt: { not: null },
        },
        select: { userId: true, consumedAt: true },
      });
      const backBy = new Set<string>();
      for (const r of returns) {
        if (!r.userId || !r.consumedAt) continue;
        const ranOut = firstExpiry.get(r.userId);
        if (ranOut && r.consumedAt > ranOut) backBy.add(r.userId);
      }
      cameBack = backBy.size;
    }

    const signedOut = await this.prisma.userEvent.count({
      where: { type: 'LOGGED_OUT', at: { gte: w.from, lte: w.to } },
    });

    return {
      expiredUnused: firstExpiry.size,
      cameBack,
      cameBackRate: rate(cameBack, firstExpiry.size),
      signedOut,
      sessionDays: 0, // filled by the controller, which holds the config
    };
  }
}
