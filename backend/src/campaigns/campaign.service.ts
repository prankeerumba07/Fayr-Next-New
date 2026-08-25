import { Injectable, NotFoundException } from '@nestjs/common';
import type { Campaign, Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { claimedSeatsByCampaign } from './seats';

/**
 * Read access to campaigns. Phase 1 is read-only (campaigns are seeded); admin
 * CRUD is a later phase. Listing shows only ACTIVE campaigns — the ones a user
 * can currently claim — while getById returns a campaign in ANY status, so a
 * task detail can still show its (possibly now-paused) campaign.
 */
@Injectable()
export class CampaignService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active campaigns, newest first, optionally filtered by marketplace. */
  listActive(platform?: Platform): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({
      where: { status: 'ACTIVE', ...(platform ? { platform } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Seats taken, per campaign, in one query — through the same predicate the
   * claim gate uses (seats.ts). Exposed here rather than reached for directly so
   * every caller counts a seat the one way.
   */
  claimedSeats(campaignIds: string[]): Promise<Map<string, number>> {
    return claimedSeatsByCampaign(this.prisma, campaignIds);
  }

  /** A single campaign by id, in any status. 404 if it doesn't exist. */
  async getById(id: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }
}
