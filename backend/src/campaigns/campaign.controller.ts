import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { Env } from '../config/env.validation';
import { CampaignService } from './campaign.service';
import { toCampaignResponse, type CampaignResponse } from './campaign.response';
import { claimedFor } from './seats';
import { ListCampaignsQuery } from './dto/list-campaigns.query';
import { NO_READER, orderFeedFor, type FeedReader } from './feed-order';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { ShopSignInService } from '../shops/shop-sign-in.service';
import { UserEventService } from '../events/user-event.service';

/**
 * Read-only campaign endpoints. Authenticated only — a user must be logged in to
 * browse the campaigns they can claim (participation also requires a connected
 * marketplace account, enforced on-device). Money crosses the wire as strings
 * (see CampaignResponse).
 */
@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignController {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly signIns: ShopSignInService,
    private readonly events: UserEventService,
  ) {}

  /**
   * The operator's claim window in MINUTES, read from the one setting the claim
   * itself uses.
   * Read per request rather than cached so an operator changing it does not need a
   * redeploy to stop the app quoting the old number.
   */
  private get claimWindowMinutes(): number {
    return this.config.get('CLAIM_TTL_MINUTES', { infer: true });
  }

  /**
   * List active campaigns, optionally filtered by ?platform=.
   *
   * ORDERED FOR THE PERSON ASKING. Same campaigns, same count, different order —
   * see feed-order.ts for the three rules and why it never removes anything.
   *
   * IF WE CANNOT WORK OUT WHO THEY ARE, THEY GET THE OLD ORDER. Reading the two
   * facts the ranking needs is two more queries, and a feed that fails to load
   * because one of them was slow would be a straight downgrade on a feed that
   * was merely in a less clever order. So the read is guarded and falls back.
   */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCampaignsQuery,
  ): Promise<CampaignResponse[]> {
    const rows = await this.campaigns.listActive(query.platform);
    // ONE count query for the whole feed, not one per card.
    const taken = await this.campaigns.claimedSeats(rows.map((c) => c.id));
    const ordered = orderFeedFor(rows, await this.readerFor(user.id));

    // WHAT THEY WERE SHOWN, not that they opened a screen. The app cannot report
    // this one for itself — only the server knows how many campaigns came back.
    await this.events.record({
      type: 'FEED_OPENED',
      userId: user.id,
      payload: { size: ordered.length, ...(query.platform ? { platform: query.platform } : {}) },
    });

    return ordered.map((c) =>
      toCampaignResponse(c, {
        claimWindowMinutes: this.claimWindowMinutes,
        claimedCount: claimedFor(taken, c.id),
      }),
    );
  }

  /** The two facts the ordering needs, or nothing at all if either read fails. */
  private async readerFor(userId: string): Promise<FeedReader> {
    try {
      const [connected, profile] = await Promise.all([
        this.signIns.platformsConnected(userId),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { categories: true },
        }),
      ]);
      return { connected, categories: profile?.categories ?? [] };
    } catch {
      return NO_READER;
    }
  }

  /** Fetch one campaign by id (any status). 400 if malformed, 404 if missing. */
  @Get(':id')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignResponse> {
    const campaign = await this.campaigns.getById(id);
    const taken = await this.campaigns.claimedSeats([campaign.id]);
    return toCampaignResponse(campaign, {
      claimWindowMinutes: this.claimWindowMinutes,
      claimedCount: claimedFor(taken, campaign.id),
    });
  }
}
