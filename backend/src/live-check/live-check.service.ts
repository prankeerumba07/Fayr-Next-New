import { Injectable, Logger } from '@nestjs/common';
import type { LivePageCheckRun, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { claimedSeatsByCampaign, seatsLeft } from '../campaigns/seats';
import {
  countByState,
  isLiveState,
  offerAvailability,
  plainStateSentence,
  type LiveState,
  type OfferAvailability,
} from './live-page.rules';

/** One offer for somebody to open this morning. */
export interface OfferToCheck {
  campaignId: string;
  title: string;
  productName: string;
  platform: string;
  /** The shop page to open. Null means there is nothing to open. */
  productUrl: string | null;
}

/** What the phone reports back for one offer. */
export interface LiveResultInput {
  campaignId: string;
  state: string;
  /** What the shop's own page answered, when it answered. */
  httpStatus?: number | null;
  /** The words on the page that decided it. Kept so nobody has to trust the label. */
  evidence?: string | null;
}

export interface LiveFinding {
  campaignId: string;
  title: string;
  platform: string;
  state: LiveState;
  says: string;
  httpStatus: number | null;
  evidence: string | null;
  greyedOutInTheApp: boolean;
}

export interface LiveCheckReport {
  ranAt: Date;
  checked: number;
  counts: Record<LiveState, number>;
  findings: LiveFinding[];
}

/**
 * THE LIVE PAGE CHECK.
 *
 * Started by hand, every morning, by a person with a real phone and a real
 * signed-in shop session — because that is the only way to see what a shopper
 * sees. This service does not open anything: the phone does the opening and posts
 * back what it found, and this records it, projects it onto the offers, and hands
 * it to the staff screen.
 *
 * IT ONLY EVER RECORDS WHAT IT WAS TOLD. It does not retry, it does not guess, and
 * a state it does not recognise is refused rather than stored — a seventh state
 * would silently leave an offer on the feed with nothing to say why.
 */
@Injectable()
export class LiveCheckService {
  private readonly log = new Logger(LiveCheckService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Every live offer, and the page to open for it. */
  async offersToCheck(): Promise<OfferToCheck[]> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ platform: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        title: true,
        productName: true,
        platform: true,
        productUrl: true,
      },
    });
    return campaigns.map((c) => ({
      campaignId: c.id,
      title: c.title,
      productName: c.productName,
      platform: c.platform,
      productUrl: c.productUrl,
    }));
  }

  /**
   * Record one morning's run.
   *
   * Everything in one transaction: either the run and every offer it touched are
   * written, or none of them are. A half-written run would leave some offers greyed
   * out on this morning's evidence and the rest on last week's, with no way to tell
   * which from looking.
   */
  async record(
    startedByStaffId: string,
    results: LiveResultInput[],
  ): Promise<LiveCheckReport> {
    const known = new Map(
      (await this.offersToCheck()).map((o) => [o.campaignId, o]),
    );

    const usable: {
      offer: OfferToCheck;
      result: LiveResultInput;
      state: LiveState;
    }[] = [];
    for (const result of results) {
      const offer = known.get(result.campaignId);
      if (!offer) {
        // An offer that is no longer live. Not an error — a run takes minutes and
        // an operator can pause an offer in the middle of one.
        this.log.warn(
          `live check reported on ${result.campaignId}, which is not a live offer`,
        );
        continue;
      }
      if (!isLiveState(result.state)) {
        this.log.warn(
          `live check reported state "${String(result.state)}" for ${result.campaignId}, which is not a state`,
        );
        continue;
      }
      usable.push({ offer, result, state: result.state });
    }

    const ranAt = new Date();
    const counts = countByState(usable.map((u) => ({ state: u.state })));
    const seats = await this.seatsFor(usable.map((u) => u.offer.campaignId));

    const findings: LiveFinding[] = usable.map(({ offer, result, state }) => ({
      campaignId: offer.campaignId,
      title: offer.title,
      platform: offer.platform,
      state,
      says: plainStateSentence(state),
      httpStatus:
        typeof result.httpStatus === 'number' ? result.httpStatus : null,
      evidence:
        typeof result.evidence === 'string' && result.evidence.trim() !== ''
          ? result.evidence.trim().slice(0, 300)
          : null,
      greyedOutInTheApp: offerAvailability({
        seatsLeft: seats.get(offer.campaignId) ?? null,
        liveState: state,
        liveCheckedAt: ranAt,
        now: ranAt,
      }).greyedOut,
    }));

    await this.prisma.$transaction([
      ...usable.map(({ offer, state }) =>
        this.prisma.campaign.update({
          where: { id: offer.campaignId },
          data: { liveState: state, liveCheckedAt: ranAt },
        }),
      ),
      this.prisma.livePageCheckRun.create({
        data: {
          ranAt,
          startedByStaffId,
          checked: usable.length,
          opened: counts.opened,
          expired: counts.expired,
          soldOut: counts['sold-out'],
          unavailable: counts.unavailable,
          couldNotOpen: counts['could-not-open'],
          noLink: counts['no-link'],
          findings: findings as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    return { ranAt, checked: usable.length, counts, findings };
  }

  /** The most recent run, or null before anybody has done one. */
  latestRun(): Promise<LivePageCheckRun | null> {
    return this.prisma.livePageCheckRun.findFirst({
      orderBy: { ranAt: 'desc' },
    });
  }

  /** The last few runs, so the screen can show whether this is happening daily. */
  recentRuns(limit = 14): Promise<LivePageCheckRun[]> {
    return this.prisma.livePageCheckRun.findMany({
      orderBy: { ranAt: 'desc' },
      take: Math.min(60, Math.max(1, limit)),
    });
  }

  /** What the app would show for one offer right now. */
  async availabilityFor(campaignId: string): Promise<OfferAvailability> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        totalSlots: true,
        liveState: true,
        liveCheckedAt: true,
      },
    });
    if (!campaign) {
      return { greyedOut: false, label: null, reason: null };
    }
    const seats = await this.seatsFor([campaignId]);
    return offerAvailability({
      seatsLeft: seats.get(campaignId) ?? null,
      liveState: campaign.liveState,
      liveCheckedAt: campaign.liveCheckedAt,
      now: new Date(),
    });
  }

  /** Seats left per campaign, using the same count the claim gate uses. */
  private async seatsFor(ids: string[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (ids.length === 0) return out;
    const campaigns = await this.prisma.campaign.findMany({
      where: { id: { in: ids } },
      select: { id: true, totalSlots: true },
    });
    const claimed = await claimedSeatsByCampaign(this.prisma, ids);
    for (const c of campaigns) {
      out.set(c.id, seatsLeft(c.totalSlots, claimed.get(c.id) ?? 0));
    }
    return out;
  }
}
